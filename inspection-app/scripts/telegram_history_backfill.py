#!/usr/bin/env python3
"""
Pull a Telegram group's FULL history into the car-photo archive.

WHY THIS EXISTS
---------------
The Telegram Bot API cannot read history. A bot only ever receives messages from
the moment it is added to a group, and getUpdates holds ~24h of pending updates.
So everything posted before the bot joined is invisible to api/telegram.js and is
missing from wa_inbound_messages / the car-history bucket.

MTProto (the protocol a real Telegram *client* speaks) has no such limit. Logging
in as a human member of the group gives access to the whole backlog. That's what
this does — once, as a backfill. The bot stays the live path.

WHAT IT WRITES
--------------
For every photo it can tie to a car:
  1. the image -> car-history/<vin6>/<sha256>.<ext>   (same path convention as
     the bot, so content-hash dedup makes re-runs free)
  2. a row in wa_inbound_messages, keyed tg_<chat_id>_<message_id>

Backfilled rows are deliberately shaped exactly like bot rows: they ARE the same
thing, just recovered late. vehicle_photos() then surfaces them with no special
casing, and re-running can never double-insert.

SAFETY
------
Dry-run by default. Nothing is written until you pass --commit.

SETUP
-----
  python3 -m venv .venv && source .venv/bin/activate
  pip install telethon supabase

  # from https://my.telegram.org -> API development tools
  export TELEGRAM_API_ID=...
  export TELEGRAM_API_HASH=...
  # Supabase: the SERVICE key, not the anon key — this writes storage + tables
  export SUPABASE_URL=https://<project>.supabase.co
  export SUPABASE_SERVICE_KEY=...

USAGE
-----
  # 1. find the group (first run asks for your phone, an SMS code, and 2FA)
  python3 scripts/telegram_history_backfill.py --list-groups

  # 2. see what it WOULD do — reads history, matches VINs, writes nothing
  python3 scripts/telegram_history_backfill.py --group -1001234567890

  # 3. do it
  python3 scripts/telegram_history_backfill.py --group -1001234567890 --commit

  # resume / top up later — idempotent, but --min-id skips re-reading
  python3 scripts/telegram_history_backfill.py --group -1001234567890 --commit --min-id 48210
"""

import argparse
import asyncio
import hashlib
import os
import re
import sys
from datetime import timezone

try:
    from telethon import TelegramClient
    from telethon.tl.types import MessageMediaPhoto, MessageMediaDocument
except ImportError:
    sys.exit("Missing telethon.  pip install telethon supabase")

try:
    from supabase import create_client
except ImportError:
    sys.exit("Missing supabase.  pip install telethon supabase")


# ---------------------------------------------------------------- VIN parsing
# Ported verbatim from api/_lib/parse.js. It MUST stay in step with the bot: if
# this matched VINs differently, backfilled photos would attach to different cars
# than live ones, which is worse than not backfilling at all.

EXCLUDE_WORDS = {
    'DETAIL', 'PEELED', 'CLOSED', 'TRYING', 'WORKS', 'BRING', 'OSAMA', 'JORGE',
    'TODAY', 'PLEASE', 'BUMPER', 'PAINT', 'DOESNT', 'TOUCH', 'FINISH', 'ALREADY',
    'PULLED', 'PHOTOS', 'BLACK', 'AYHAM', 'GLUED', 'LISTED', 'READY', 'FRONT',
}

TOKEN_RE = re.compile(r'\b[A-Z0-9]{5,17}\b')


def normalize_vin6(raw: str) -> str:
    v = raw.upper()
    return v[-6:] if len(v) >= 6 else v.rjust(6, '0')


def vin_candidates(text: str):
    # 5-8 (last-6 / last-8) or 15-17 (a full VIN pasted from a run list). The
    # 9-14 band is skipped so phone and order numbers can't pose as VINs.
    return [t for t in TOKEN_RE.findall((text or '').upper())
            if len(t) <= 8 or len(t) >= 15]


def extract_all_vin6(text: str):
    out, seen = [], set()
    for cand in vin_candidates(text):
        if not any(c.isdigit() for c in cand):
            continue
        if cand in EXCLUDE_WORDS:
            continue
        v = normalize_vin6(cand)
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


# ---------------------------------------------------------------- storage

def bucket_for_station(station: str) -> str:
    # Mirrors api/_lib/photos.js. body_shop / mechanic / transport photos are
    # backend reference only and must NEVER reach the marketplace.
    return 'wa-photos' if station in ('ready', 'seller') else 'car-history'


EXT_BY_MIME = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}


def store_photo(db, bucket: str, vin6: str, blob: bytes, mime: str) -> str:
    ext = EXT_BY_MIME.get(mime, 'jpg')
    digest = hashlib.sha256(blob).hexdigest()
    path = f"{vin6}/{digest}.{ext}"
    # upsert=True + content-hash path => re-running this script is a no-op.
    db.storage.from_(bucket).upload(
        path, blob, {"content-type": mime, "upsert": "true"})
    return path


# ---------------------------------------------------------------- main

async def run(args):
    api_id = os.environ.get('TELEGRAM_API_ID')
    api_hash = os.environ.get('TELEGRAM_API_HASH')
    if not api_id or not api_hash:
        sys.exit("Set TELEGRAM_API_ID and TELEGRAM_API_HASH (my.telegram.org)")

    client = TelegramClient('carzinc_backfill', int(api_id), api_hash)
    await client.start()   # prompts for phone + code + 2FA on first run only

    if args.list_groups:
        print(f"{'chat_id':>16}  title")
        async for dialog in client.iter_dialogs():
            if dialog.is_group or dialog.is_channel:
                print(f"{dialog.id:>16}  {dialog.name}")
        await client.disconnect()
        return

    if not args.group:
        sys.exit("Pass --group <chat_id>, or --list-groups to find it")

    db = None
    if args.commit:
        url = os.environ.get('SUPABASE_URL')
        key = os.environ.get('SUPABASE_SERVICE_KEY')
        if not url or not key:
            sys.exit("--commit needs SUPABASE_URL and SUPABASE_SERVICE_KEY "
                     "(the SERVICE key — this writes storage and tables)")
        db = create_client(url, key)

    chat_id = int(args.group)
    station = args.station
    bucket = bucket_for_station(station)

    # Photo -> car binding, same rules the webhook uses:
    #   1. a VIN in the photo's own caption
    #   2. an album sibling's VIN (photos sent together share grouped_id)
    #   3. the sender's last VIN, within a time window (sender+time binding)
    # Reading oldest -> newest means the VIN message is normally already seen by
    # the time its photos arrive, which is the common case the bot has to race.
    session_vin = {}      # sender_id -> (vin6, message_datetime)
    album_vin = {}        # grouped_id -> vin6
    window = args.window * 60

    stats = dict(messages=0, with_vin=0, photos=0, matched=0, orphan=0,
                 stored=0, skipped=0, failed=0)
    vins_seen = set()
    orphan_examples = []

    print(f"Reading history of {chat_id} (station={station}, bucket={bucket})…")
    print("DRY RUN — nothing will be written.\n" if not args.commit
          else "COMMITTING.\n")

    async for msg in client.iter_messages(
            chat_id, reverse=True, min_id=args.min_id or 0):
        stats['messages'] += 1
        text = msg.message or ''
        sender = msg.sender_id
        when = msg.date.astimezone(timezone.utc) if msg.date else None

        vins = extract_all_vin6(text)
        if vins:
            stats['with_vin'] += 1
            vins_seen.update(vins)
            if sender is not None and when is not None:
                session_vin[sender] = (vins[0], when)
            if msg.grouped_id:
                album_vin[msg.grouped_id] = vins[0]

        photo = None
        mime = 'image/jpeg'
        if isinstance(msg.media, MessageMediaPhoto):
            photo = msg.media
        elif isinstance(msg.media, MessageMediaDocument):
            doc_mime = getattr(msg.media.document, 'mime_type', '') or ''
            if doc_mime.startswith('image/'):      # sent "as file"
                photo, mime = msg.media, doc_mime
        if photo is None:
            continue

        stats['photos'] += 1

        vin6 = vins[0] if vins else None
        if not vin6 and msg.grouped_id:
            vin6 = album_vin.get(msg.grouped_id)
        if not vin6 and sender is not None and when is not None:
            prev = session_vin.get(sender)
            # Only bind inside the window — an hours-old VIN from the same person
            # is a different car, and a wrong binding is worse than none.
            if prev and (when - prev[1]).total_seconds() <= window:
                vin6 = prev[0]

        if not vin6:
            stats['orphan'] += 1
            if len(orphan_examples) < 5:
                orphan_examples.append(
                    f"    msg {msg.id} {when:%Y-%m-%d} {text[:40]!r}")
            continue

        stats['matched'] += 1
        if not args.commit:
            continue

        try:
            blob = await client.download_media(msg, file=bytes)
            if not blob:
                stats['skipped'] += 1
                continue
            path = store_photo(db, bucket, vin6, blob, mime)
            db.table('wa_inbound_messages').upsert({
                'message_id': f'tg_{chat_id}_{msg.id}',
                'wa_from': f'tg:{sender}' if sender is not None else 'tg:unknown',
                'phone_number_id': str(chat_id),
                'station': station,
                'msg_type': 'image',
                'body': text[:500],
                'vin6': vin6,
                'media_path': path,
                'media_group_id': str(msg.grouped_id) if msg.grouped_id else None,
                'received_at': when.isoformat() if when else None,
                'processed': True,
            }, on_conflict='message_id').execute()
            stats['stored'] += 1
        except Exception as exc:                      # noqa: BLE001
            stats['failed'] += 1
            print(f"  ! msg {msg.id}: {exc}")

        if stats['stored'] and stats['stored'] % 50 == 0:
            print(f"  … {stats['stored']} photos stored")
            await asyncio.sleep(1)                    # be kind to both APIs

    await client.disconnect()

    print(f"""
─────────────────────────────────────────────
messages read        {stats['messages']}
  carrying a VIN     {stats['with_vin']}
distinct cars seen   {len(vins_seen)}
photos found         {stats['photos']}
  matched to a car   {stats['matched']}
  no VIN (skipped)   {stats['orphan']}
photos stored        {stats['stored']}
  failed             {stats['failed']}
─────────────────────────────────────────────""")
    if orphan_examples:
        print("\nunmatched photo examples (no VIN in caption, album, or window):")
        print('\n'.join(orphan_examples))
    if not args.commit:
        print("\nDry run. Re-run with --commit to write.")


def main():
    p = argparse.ArgumentParser(
        description="Backfill a Telegram group's photo history into the car archive.")
    p.add_argument('--group', help='chat_id (negative for supergroups)')
    p.add_argument('--list-groups', action='store_true',
                   help='print every group/channel you are in, with chat_ids')
    p.add_argument('--station', default='body_shop',
                   choices=['body_shop', 'mechanic', 'transport', 'ready', 'seller'],
                   help='which station this group is (decides the bucket)')
    p.add_argument('--commit', action='store_true',
                   help='actually write; without this it is a dry run')
    p.add_argument('--min-id', type=int, default=0,
                   help='skip messages at or below this id (resume)')
    p.add_argument('--window', type=int, default=10,
                   help='minutes a VIN stays bound to its sender (default 10, '
                        'matching the webhook session TTL)')
    asyncio.run(run(p.parse_args()))


if __name__ == '__main__':
    main()
