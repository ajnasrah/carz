#!/usr/bin/env python3
"""
WhatsApp Puller for Carz Inc

Replaces the whatsapp-web.js scraper's "fetch from WhatsApp" step. Instead of
scraping, inbound photos + vehicle entries now arrive via the official Cloud API
webhook (inspection-app/api/whatsapp.js), which writes them to Supabase:
  - vehicle data  -> table  wa_inbound_messages (parsed JSONB)
  - photos        -> storage bucket  wa-photos/{vin6}/...

This script runs ON THE MAC and pulls those down into the SAME local folders the
SmartAuction extension already reads:
  ~/Library/Application Support/CarzInc/seller_group_output/{vin6}/photo_NNN.jpg
…and registers each vehicle in queue.json via queue_manager. The extension's
existing /vehicle/<vin6>/photos endpoint then copies them to ~/Desktop/SA Photos
exactly as before.

Only INTAKE stations (seller / ready) feed listing photos — the webhook never
stores body-shop/mechanic photos, so nothing here can leak damage shots into a
listing.

Usage:
  export SUPABASE_SERVICE_KEY=...        # service_role key (reads private bucket)
  python3 whatsapp_pull.py               # one-shot pull
  python3 whatsapp_pull.py --watch       # poll every 60s
  python3 whatsapp_pull.py --watch 30    # poll every 30s

Idempotent: every pulled message_id is recorded locally, so re-runs never
double-add a photo or a queue entry — even after a folder is purged on listing.
"""

import json
import os
import re
import sys
import time
import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
import queue_manager

OUTPUT_DIR = os.path.expanduser("~/Library/Application Support/CarzInc/seller_group_output")
STATE_FILE = os.path.join(OUTPUT_DIR, ".wa_pulled.json")

def _load_local_env():
    """Read KEY=VALUE secrets from a local (non-git) file so launchd/cron don't
    need the service key inlined in a plist. Env vars take precedence."""
    path = os.path.expanduser("~/Library/Application Support/CarzInc/.env")
    if not os.path.exists(path):
        return
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except OSError:
        pass


_load_local_env()
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://yprihgygmreibcuybwoy.supabase.co")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

BUCKET = "wa-photos"
INTAKE_STATIONS = ("seller", "ready")


def _headers():
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    }


def load_pulled() -> set:
    """message_ids already pulled locally (idempotency across runs)."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                return set(json.load(f))
        except (json.JSONDecodeError, ValueError):
            return set()
    return set()


def save_pulled(pulled: set):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(sorted(pulled), f)
    os.replace(tmp, STATE_FILE)


def fetch_inbound(limit=500):
    """Processed intake messages that carry a VIN, oldest first."""
    url = f"{SUPABASE_URL}/rest/v1/wa_inbound_messages"
    params = {
        "select": "message_id,wa_from,station,body,vin6,media_path,parsed,received_at",
        "processed": "eq.true",
        "vin6": "not.is.null",
        "station": f"in.({','.join(INTAKE_STATIONS)})",
        "order": "received_at.asc",
        "limit": str(limit),
    }
    r = requests.get(url, headers=_headers(), params=params, timeout=30)
    if r.status_code != 200:
        print(f"❌ Supabase query failed: {r.status_code} {r.text[:200]}")
        return []
    return r.json()


def download_photo(media_path: str) -> bytes | None:
    """Download one object from the private wa-photos bucket."""
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{media_path}"
    r = requests.get(url, headers=_headers(), timeout=60)
    if r.status_code == 200:
        return r.content
    print(f"  ❌ photo download failed ({r.status_code}) for {media_path}")
    return None


def _photo_count(folder: str) -> int:
    if not os.path.isdir(folder):
        return 0
    return len([f for f in os.listdir(folder)
                if f.startswith("photo_") and f.lower().endswith((".jpg", ".jpeg", ".png"))])


def save_photo(vin6: str, data: bytes, message_id: str, received_at: str) -> str:
    """Save with a deterministic, chronologically-sortable name so re-runs never
    duplicate a photo and the extension lists them in capture order."""
    folder = os.path.join(OUTPUT_DIR, vin6)
    os.makedirs(folder, exist_ok=True)
    ts = re.sub(r"\D", "", received_at or "")[:14] or "00000000000000"
    safe_id = re.sub(r"[^A-Za-z0-9]", "_", message_id)
    path = os.path.join(folder, f"photo_{ts}_{safe_id}.jpg")
    if os.path.exists(path):          # already saved on a prior run — idempotent
        return path
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    return path


def register_vehicle(msg: dict):
    """Add/refresh the vehicle in queue.json from the parsed entry."""
    parsed = msg.get("parsed") or {}
    vin6 = msg["vin6"]
    data = {
        "miles": parsed.get("miles", ""),
        "condition": parsed.get("condition", ""),
        "tire_condition": parsed.get("tire_condition", ""),
        "notes": parsed.get("notes", msg.get("body", "")),
        "message_date": msg.get("received_at", ""),
        "sender": msg.get("wa_from", ""),
        "source": "whatsapp_api",
    }
    queue_manager.add_vehicle(vin6, data)


def pull_once() -> dict:
    if not SERVICE_KEY:
        print("❌ SUPABASE_SERVICE_KEY not set. Export it first (service_role key).")
        return {"error": "no_service_key"}

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    pulled = load_pulled()
    messages = fetch_inbound()

    new_vehicles = 0
    new_photos = 0
    skipped = 0

    for msg in messages:
        mid = msg.get("message_id")
        if not mid or mid in pulled:
            skipped += 1
            continue

        vin6 = msg.get("vin6")
        if not vin6:
            pulled.add(mid)
            continue

        # Skip vehicles already past the queue (listed/sold/removed) so we don't
        # resurrect a purged folder.
        existing = queue_manager.get_vehicle(vin6)
        if existing and existing.get("status") not in ("queued", "hold", None):
            pulled.add(mid)
            continue

        try:
            # Vehicle entry (text intake or captioned photo).
            if msg.get("parsed"):
                register_vehicle(msg)
                new_vehicles += 1

            # Photo.
            if msg.get("media_path"):
                data = download_photo(msg["media_path"])
                if data is None:
                    # leave UNpulled so the next run retries the download
                    continue
                save_photo(vin6, data, mid, msg.get("received_at", ""))
                queue_manager.update_photo_count(vin6, _photo_count(os.path.join(OUTPUT_DIR, vin6)))
                new_photos += 1

            pulled.add(mid)
        except Exception as e:
            print(f"  ❌ error on {mid}: {e}")
            # leave UNpulled to retry next run

    save_pulled(pulled)
    result = {"vehicles": new_vehicles, "photos": new_photos, "skipped": skipped, "seen": len(messages)}
    print(f"✅ Pull: +{new_vehicles} vehicles, +{new_photos} photos "
          f"({skipped} already-pulled, {len(messages)} scanned)")
    return result


def main():
    args = sys.argv[1:]
    if args and args[0] == "--watch":
        interval = int(args[1]) if len(args) > 1 else 60
        print(f"👀 Watching Supabase every {interval}s (Ctrl-C to stop)")
        try:
            while True:
                pull_once()
                time.sleep(interval)
        except KeyboardInterrupt:
            print("\nStopped.")
    else:
        pull_once()


if __name__ == "__main__":
    main()
