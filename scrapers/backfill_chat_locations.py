#!/usr/bin/env python3
"""
Backfill vehicle_locations from the CARZ INC iMessage group chat (chat 7760).

Each message = a key-tag photo + caption like "Drop city auto" / "Back pro".
Pipeline per message:
  1. OCR the attached photo via macOS Vision (handwriting-capable, local, free).
  2. Find the 6-char VIN last-6 in the OCR output.
  3. Parse the caption for verb (Drop / Back / bare) + location.
  4. Match last-6 against Frazer inventory via `inventory_stocks_by_vins`.
  5. Upsert `vehicle_locations` with `location_updated_at` = message sent time.

Only touches cars still in active Frazer inventory. Sold cars are skipped.

Usage:
  python3 backfill_chat_locations.py --dry-run   # preview everything
  python3 backfill_chat_locations.py             # commit to Supabase
  python3 backfill_chat_locations.py --since 2026-04-01
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

MESSAGES_DB = os.path.expanduser("~/Library/Messages/chat.db")
VISION_SCRIPT = "/tmp/ocr.swift"
STATE_DIR = os.path.expanduser("~/Library/Application Support/CarzInc")
STATE_FILE = os.path.join(STATE_DIR, "chat_locations_state.json")

# Each source is either:
#   mode='photo' — photo+caption pair; OCR the key tag, parse caption for Drop/Back
#   mode='text'  — plain text; each message's first last-6 VIN-alphabet token is the
#                  car, and the chat itself implies the location
CHAT_SOURCES = [
    {'chat_id': 7760, 'name': 'CARZ INC',       'mode': 'photo'},
    # Seller Group: 7690 is the active chat (daily inspections). 6675/7384 are dead.
    {'chat_id': 7690, 'name': 'Seller Group',   'mode': 'text', 'location': 'on_lot'},
    # Mechanics: 7213 active, 7628 archived.
    {'chat_id': 7213, 'name': 'Mechanics',      'mode': 'text', 'location': 'mechanic_section'},
    {'chat_id': 7628, 'name': 'Mechanics (old)','mode': 'text', 'location': 'mechanic_section'},
    # Body shop: 7653 is the CURRENT active chat; 7640 is the older one with
    # 700 historical messages; 7665 is a third archive. All three resolve to
    # the same physical location, so we ingest all three.
    {'chat_id': 7653, 'name': 'Body shop',      'mode': 'text', 'location': 'body_shop'},
    {'chat_id': 7640, 'name': 'Body shop (old)','mode': 'text', 'location': 'body_shop'},
    {'chat_id': 7665, 'name': 'Body shop (v2)', 'mode': 'text', 'location': 'body_shop'},
]

# Frazer location code M/J/Z/X/A stays in Frazer. This module only sets
# vehicle_locations.physical_location — the app's location overlay.
LOC_SHORTHAND = {
    'pro':         'pro_auto',
    'state':       'tri_state_glass',
    'summit':      'summit_tire',
    'city auto':   'city_auto',
    'jim keras nissan': 'jim_keras_nissan',
    'muffler c&s': 'muffler_cs',
    'muffler':     'muffler_cs',
}
HOME_LOT = 'on_lot'
SOURCE_TAG = 'chat_carzinc'

VIN_CHARS = r'[A-HJ-NPR-Z0-9]'  # VIN alphabet (no I, O, Q)
LAST6_RE = re.compile(rf'\b({VIN_CHARS}{{6}})\b')


def looks_like_vin_last6(s):
    """Real VIN last-6 always contains digits (serial section of a VIN).
    Reject all-letter tokens like 'ADESA', 'SMART', 'SCNAJS' that slip through
    OCR/regex. Require at least 3 digits."""
    if not s or len(s) != 6:
        return False
    if not re.fullmatch(rf'{VIN_CHARS}+', s):
        return False
    digit_count = sum(1 for c in s if c.isdigit())
    return digit_count >= 3

SUPABASE_URL = None
SUPABASE_KEY = None


def load_supabase_creds():
    global SUPABASE_URL, SUPABASE_KEY
    env_path = Path(__file__).resolve().parent.parent / 'inspection-app' / '.env'
    with open(env_path) as fh:
        for line in fh:
            if line.startswith('VITE_SUPABASE_URL='):
                SUPABASE_URL = line.split('=', 1)[1].strip()
            elif line.startswith('VITE_SUPABASE_ANON_KEY='):
                SUPABASE_KEY = line.split('=', 1)[1].strip()
    if not (SUPABASE_URL and SUPABASE_KEY):
        raise SystemExit("Could not load Supabase creds from inspection-app/.env")


def sb_get(path):
    req = urllib.request.Request(
        SUPABASE_URL + path,
        headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'},
    )
    return json.load(urllib.request.urlopen(req))


def sb_post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        SUPABASE_URL + path,
        data=data,
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json',
        },
    )
    return json.load(urllib.request.urlopen(req))


def sb_upsert_batch(rows):
    """POST vehicle_locations with merge-duplicates on stock_number."""
    if not rows:
        return 0
    url = SUPABASE_URL + '/rest/v1/vehicle_locations?on_conflict=stock_number'
    data = json.dumps(rows).encode()
    req = urllib.request.Request(
        url, data=data, method='POST',
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
    )
    try:
        urllib.request.urlopen(req)
        return len(rows)
    except urllib.error.HTTPError as e:
        print(f"   UPSERT FAILED: {e.code} {e.read()[:200].decode()}")
        return 0


def ensure_vision_script():
    Path(VISION_SCRIPT).write_text('''import Foundation
import Vision
import AppKit

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let img = NSImage(contentsOf: url)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("failed to load image\\n".data(using: .utf8)!)
    exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
let handler = VNImageRequestHandler(cgImage: img)
try handler.perform([req])
var out: [String] = []
for obs in req.results ?? [] {
    if let top = obs.topCandidates(1).first {
        out.append(top.string)
    }
}
print(out.joined(separator: "\\n"))
''')


def ocr(path):
    try:
        r = subprocess.run(
            ['swift', VISION_SCRIPT, path],
            capture_output=True, timeout=30,
        )
        return r.stdout.decode('utf-8', 'replace')
    except subprocess.TimeoutExpired:
        return ''


def extract_last6(ocr_text):
    """Find candidate 6-char VIN-alphabet tokens in OCR output and pick the
    best. Real VIN last-6 must contain >=3 digits (looks_like_vin_last6)."""
    candidates = []
    for line in ocr_text.splitlines():
        s = line.strip().upper()
        if s in ('NEW', 'USED CERT', 'YEAR', 'MAKE', 'MODEL', 'BODY', 'COLOR',
                 'DONKEYKEYTAGS.COM', 'DONKEY KEY TAGS'):
            continue
        m = LAST6_RE.search(s)
        if m and looks_like_vin_last6(m.group(1)):
            candidates.append(m.group(1))
    candidates.sort(key=lambda v: (-sum(c.isalpha() for c in v), -len(v)))
    return candidates[0] if candidates else None


def clean_text(s):
    """Strip object-replacement chars, NUL bytes, and other control chars that
    PostgREST can't encode as JSON-escaped text."""
    if not s:
        return ''
    return (s
            .replace('\x00', '')
            .replace('￼', '')  # object replacement (attachment placeholder)
            .strip())


def extract_attributedBody_text(body):
    if not body:
        return ''
    try:
        idx = body.find(b'\x01+')
        if idx < 0:
            return ''
        chunk = body[idx + 3:idx + 3 + 400]
        for marker in (b'\x86', b'\x06\x01'):
            p = chunk.find(marker)
            if 0 <= p < len(chunk):
                chunk = chunk[:p]
        return clean_text(chunk.decode('utf-8', 'replace'))
    except Exception:
        return ''


def normalize_caption(text):
    """Return (verb, raw_location, normalized_location).

    verb:
      'drop' — car is going to the named location
      'back' — car is returning to the home lot (named location is where it came from)
    """
    t = (text or '').strip().replace('￼', '').strip()
    if not t:
        return (None, None, None)
    t_lower = t.lower()

    # "back …" / "back from …" / "picked up …" / "picked up from …" all mean home
    BACK_PREFIXES = ('back from ', 'picked up from ', 'back ', 'picked up ', 'from ')
    for p in BACK_PREFIXES:
        if t_lower.startswith(p):
            rest = t_lower[len(p):].strip()
            return ('back', rest, HOME_LOT)
    if t_lower in ('back', 'picked up', 'on lot'):
        return ('back', '', HOME_LOT)

    # "drop …" / "dropped …" / "dropping …" / bare location
    DROP_PREFIXES = ('drop ', 'dropped ', 'dropping ', 'dropped at ', 'at ')
    rest = t_lower
    for p in DROP_PREFIXES:
        if t_lower.startswith(p):
            rest = t_lower[len(p):].strip()
            break
    normalized = LOC_SHORTHAND.get(rest, re.sub(r'[^a-z0-9]+', '_', rest).strip('_'))
    return ('drop', rest, normalized)


def is_vehicle_message(text):
    """Skip reactions / chatter that can't possibly be a drop."""
    if not text:
        return True  # photo-only is still valid (treat as drop, resolve later)
    t = text.strip().lower().replace('￼', '').strip()
    if not t:
        return True
    if t.startswith(('liked ', 'loved ', 'questioned ', 'disliked ', 'emphasized ', 'laughed at ')):
        return False
    # Short reactions / chatter
    if t in ('ok', 'smh', 'lol', 'thanks', 'thank you', 'yes', 'no', '?', '??', '???'):
        return False
    return True


def open_chat_db():
    tmp = tempfile.mkdtemp(prefix='imsg_backfill_')
    shutil.copy2(MESSAGES_DB, tmp + '/chat.db')
    for s in ('-wal', '-shm'):
        if os.path.exists(MESSAGES_DB + s):
            shutil.copy2(MESSAGES_DB + s, tmp + '/chat.db' + s)
    return sqlite3.connect(tmp + '/chat.db')


def since_iso_to_apple_ns(since_iso):
    dt = datetime.fromisoformat(since_iso)
    return int((dt - datetime(2001, 1, 1)).total_seconds() * 1e9)


def load_state():
    try:
        with open(STATE_FILE) as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, 'w') as fh:
        json.dump(state, fh, indent=2)


def fetch_photo_messages(db, chat_id, since_iso=None, since_date_ns=None):
    c = db.cursor()
    where = "WHERE cmj.chat_id = ?"
    params = [chat_id]
    if since_date_ns:
        where += " AND m.date > ?"
        params.append(since_date_ns)
    elif since_iso:
        where += " AND m.date > ?"
        params.append(since_iso_to_apple_ns(since_iso))
    c.execute(f"""
        SELECT m.date, m.ROWID,
               datetime(m.date/1000000000 + 978307200, 'unixepoch') AS ts_utc,
               COALESCE(h.id, 'me'),
               COALESCE(m.text, ''), m.attributedBody,
               a.filename, a.mime_type
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        JOIN message_attachment_join maj ON m.ROWID = maj.message_id
        JOIN attachment a ON maj.attachment_id = a.ROWID
        {where}
        ORDER BY m.date ASC
    """, params)
    out = []
    for date_ns, rowid, ts_utc, sender, text, body, fn, mime in c.fetchall():
        if not (mime or '').startswith('image/'):
            continue
        caption = clean_text(text) if text else extract_attributedBody_text(body)
        fp = os.path.expanduser(fn) if fn else None
        if not fp or not os.path.exists(fp):
            continue
        ts_iso = datetime.fromisoformat(ts_utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')
        out.append({
            'date_ns': date_ns, 'msg_id': rowid, 'ts_iso': ts_iso,
            'sender': sender, 'caption': caption or '', 'file': fp,
        })
    return out


def fetch_text_messages(db, chat_id, since_iso=None, since_date_ns=None):
    c = db.cursor()
    where = "WHERE cmj.chat_id = ?"
    params = [chat_id]
    if since_date_ns:
        where += " AND m.date > ?"
        params.append(since_date_ns)
    elif since_iso:
        where += " AND m.date > ?"
        params.append(since_iso_to_apple_ns(since_iso))
    c.execute(f"""
        SELECT m.date, m.ROWID,
               datetime(m.date/1000000000 + 978307200, 'unixepoch') AS ts_utc,
               COALESCE(h.id, 'me'),
               COALESCE(m.text, ''), m.attributedBody
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        {where}
        ORDER BY m.date ASC
    """, params)
    out = []
    for date_ns, rowid, ts_utc, sender, text, body in c.fetchall():
        msg_text = clean_text(text) if text else extract_attributedBody_text(body)
        if not msg_text:
            continue
        ts_iso = datetime.fromisoformat(ts_utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')
        out.append({
            'date_ns': date_ns, 'msg_id': rowid, 'ts_iso': ts_iso,
            'sender': sender, 'text': msg_text,
        })
    return out


def extract_last6_from_text(text):
    """Find a VIN last-6 token in a text message. Looks at the FIRST line first
    (typical pattern: last-6 on its own line, then miles/condition). Only
    returns candidates that look like real VIN last-6 (>=3 digits)."""
    if not text:
        return None
    first = text.strip().splitlines()[0].strip()
    cleaned = re.sub(r'[^A-Za-z0-9]', '', first).upper()
    if len(cleaned) == 6 and looks_like_vin_last6(cleaned):
        return cleaned
    if len(cleaned) == 7 and looks_like_vin_last6(cleaned[-6:]):
        return cleaned[-6:]
    # Fallback: any 6-char VIN-alphabet token with >=3 digits anywhere
    for m in LAST6_RE.finditer(text.upper()):
        if looks_like_vin_last6(m.group(1)):
            return m.group(1)
    return None


def run_backfill(dry_run=False, since_iso=None, limit=None, incremental=False, log=print):
    """Run the backfill. Returns a dict of stats + committed rows.

    When incremental=True, reads per-chat last-processed message date from
    STATE_FILE and only fetches messages newer than that. Updates STATE_FILE
    on success.
    """
    load_supabase_creds()
    ensure_vision_script()

    state = load_state() if incremental else {}

    log("Loading Frazer inventory…")
    inv = sb_post('/rest/v1/rpc/list_all_inventory', {})
    by_last6 = {}
    for r in inv:
        k = (r.get('last_6_vin') or (r.get('vehicle_vin') or '')[-6:]).upper()
        if k:
            by_last6[k] = r
    log(f"  → {len(by_last6)} unique last-6 VINs in active inventory")

    db = open_chat_db()
    upserts_by_stock = {}
    unmatched_samples = []
    new_state = dict(state)
    totals = {'msgs': 0, 'matched': 0, 'no_last6': 0, 'not_in_inv': 0,
              'skipped_chatter': 0, 'by_chat': {}}

    for src in CHAT_SOURCES:
        chat_key = str(src['chat_id'])
        since_ns = state.get(chat_key) if incremental else None
        log(f"=== {src['name']} (chat {src['chat_id']}, mode={src['mode']}{', incremental since ' + str(since_ns) if since_ns else ''}) ===")
        if src['mode'] == 'photo':
            msgs = fetch_photo_messages(db, src['chat_id'], since_iso=since_iso, since_date_ns=since_ns)
        else:
            msgs = fetch_text_messages(db, src['chat_id'], since_iso=since_iso, since_date_ns=since_ns)
        if limit: msgs = msgs[:limit]
        log(f"  → {len(msgs)} messages")
        totals['msgs'] += len(msgs)
        per_chat = {'msgs': len(msgs), 'matched': 0}

        for i, m in enumerate(msgs, 1):
            if src['mode'] == 'photo' and i % 100 == 0:
                log(f"    [{i}/{len(msgs)}]")
            # Track newest date_ns seen for state
            if m['date_ns'] > (new_state.get(chat_key) or 0):
                new_state[chat_key] = m['date_ns']

            if src['mode'] == 'photo':
                if not is_vehicle_message(m['caption']):
                    totals['skipped_chatter'] += 1; continue
                verb, raw_loc, loc = normalize_caption(m['caption'])
                if not loc:
                    totals['skipped_chatter'] += 1
                    continue
                ocr_text = ocr(m['file'])
                last6 = extract_last6(ocr_text) if ocr_text.strip() else None
                if not last6:
                    totals['no_last6'] += 1
                    if len(unmatched_samples) < 15:
                        unmatched_samples.append(('no_last6', src['name'], m.get('caption', ''), m['ts_iso'], ocr_text[:80]))
                    continue
                row = by_last6.get(last6)
                stock_key = row['stock_number'] if row else f'unknown:{last6}'
                if not row:
                    totals['not_in_inv'] += 1
                upserts_by_stock[stock_key] = {
                    'stock_number': stock_key,
                    'vin': (row.get('vehicle_vin') if row else '') or '',
                    'physical_location': loc,
                    'physical_source': SOURCE_TAG if row else 'chat_carzinc_unmatched',
                    'location_updated_at': m['ts_iso'],
                    'updated_at': m['ts_iso'],
                    'notes': {
                        'verb': verb, 'raw_caption': m['caption'][:200],
                        'raw_location': raw_loc, 'sender': m['sender'],
                        'chat_message_id': m['msg_id'], 'chat_name': src['name'],
                        **({'not_found': True, 'last6': last6} if not row else {}),
                    },
                }
            else:
                last6 = extract_last6_from_text(m['text'])
                if not last6:
                    continue
                row = by_last6.get(last6)
                stock_key = row['stock_number'] if row else f'unknown:{last6}'
                if not row:
                    totals['not_in_inv'] += 1
                upserts_by_stock[stock_key] = {
                    'stock_number': stock_key,
                    'vin': (row.get('vehicle_vin') if row else '') or '',
                    'physical_location': src['location'],
                    'physical_source': SOURCE_TAG if row else 'chat_carzinc_unmatched',
                    'location_updated_at': m['ts_iso'],
                    'updated_at': m['ts_iso'],
                    'notes': {
                        'raw_text': m['text'][:200], 'sender': m['sender'],
                        'chat_message_id': m['msg_id'], 'chat_name': src['name'],
                        **({'not_found': True, 'last6': last6} if not row else {}),
                    },
                }
            if row:
                totals['matched'] += 1
                per_chat['matched'] += 1
        totals['by_chat'][src['name']] = per_chat

    log("")
    log(f"Total messages processed: {totals['msgs']}")
    log(f"  Matched:                {totals['matched']}")
    log(f"  Not in inventory:       {totals['not_in_inv']}")
    log(f"  No last-6 found:        {totals['no_last6']}")
    log(f"  Skipped chatter:        {totals['skipped_chatter']}")
    log(f"Unique cars to update:    {len(upserts_by_stock)}")

    upserted = 0
    if not dry_run and upserts_by_stock:
        rows = list(upserts_by_stock.values())
        for i in range(0, len(rows), 100):
            batch = rows[i:i + 100]
            ok = sb_upsert_batch(batch)
            upserted += ok
            log(f"  batch {i // 100 + 1}: +{ok}")
        log(f"Upserted {upserted}/{len(rows)}")
        if upserted > 0 and incremental:
            save_state(new_state)
            log(f"State saved to {STATE_FILE}")
    elif dry_run:
        log("DRY RUN — no writes.")

    return {
        'totals': totals,
        'unique_cars': len(upserts_by_stock),
        'upserted': upserted,
        'dry_run': dry_run,
        'sample': [
            {'stock': u['stock_number'], 'location': u['physical_location'],
             'ts': u['location_updated_at'], 'chat': u['notes'].get('chat_name')}
            for u in list(upserts_by_stock.values())[:10]
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='preview only, no Supabase writes')
    ap.add_argument('--since', help='ISO date (YYYY-MM-DD); skip messages before this')
    ap.add_argument('--limit', type=int, help='only process first N messages (debug)')
    ap.add_argument('--incremental', action='store_true', help='only process messages newer than the last successful run')
    args = ap.parse_args()
    run_backfill(dry_run=args.dry_run, since_iso=args.since, limit=args.limit, incremental=args.incremental)


if __name__ == '__main__':
    main()
