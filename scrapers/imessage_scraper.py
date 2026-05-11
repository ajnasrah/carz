#!/usr/bin/env python3
"""
iMessage Seller Group Scraper for Carz Inc

Scrapes the "Seller Group" iMessage group chat for vehicle inspection data.
Extracts: last 6 of VIN, miles, tire condition, overall condition, notes, and photos.
Organizes everything into folders named by the last 6 of VIN.

Supports:
  - Adjustable time periods (--start, --end)
  - Resume capability (tracks last scrape timestamp in .last_scrape file)
  - Incremental scraping (--resume flag picks up where last scrape ended)

Usage:
  python3 imessage_scraper.py                          # Scrape all messages, resume from last run
  python3 imessage_scraper.py --start 2026-03-01       # Scrape from March 1st onward
  python3 imessage_scraper.py --start 2026-03-01 --end 2026-03-15  # Specific range
  python3 imessage_scraper.py --all                    # Scrape everything from scratch
  python3 imessage_scraper.py --list                   # List what would be scraped (dry run)
"""

import sqlite3
import os
import re
import shutil
import json
import argparse
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import subprocess

try:
    import queue_manager
except ImportError:
    queue_manager = None


# --- Configuration ---
MESSAGES_DB = os.path.expanduser("~/Library/Messages/chat.db")
CHAT_ID = 7690  # Most recent "Seller Group" chat
SOLD_CHAT_ID = None  # Set after running find_chat.py (sold cars group)
OUTPUT_DIR = os.path.expanduser("~/Library/Application Support/CarzInc/seller_group_output")
STATE_FILE = os.path.join(OUTPUT_DIR, ".last_scrape")
SOLD_STATE_FILE = os.path.join(OUTPUT_DIR, ".last_scrape_sold")


def extract_text(body: bytes) -> str:
    """Extract readable text from iMessage attributedBody binary blob."""
    if not body:
        return ""
    try:
        idx = body.find(b'\x01+')
        if idx >= 0:
            start = idx + 2
            text_start = start + 1
            chunk = body[text_start:text_start + 5000]
            end_markers = [b'\x86', b'\x06\x01']
            text_end = len(chunk)
            for marker in end_markers:
                pos = chunk.find(marker)
                if 0 <= pos < text_end:
                    text_end = pos
            text = chunk[:text_end].decode('utf-8', errors='replace')
            text = text.replace('\ufffc', '').strip()
            return text
    except Exception:
        pass
    return ""


def parse_vehicle_entry(text: str) -> dict | None:
    """
    Parse a vehicle inspection message into structured data.

    Expected format:
        [last 6 of VIN]
        [miles]
        [condition]
        [tire score]
        [optional notes...]
    """
    # Strip emojis, replacement chars, and other non-ASCII junk from the start
    cleaned = re.sub(r'^[^\x20-\x7E]+', '', text.strip())
    lines = [l.strip() for l in cleaned.strip().split('\n') if l.strip()]
    if len(lines) < 3:
        return None

    # Clean first line of any remaining leading/trailing non-alphanumeric chars
    first_line = re.sub(r'[^A-Za-z0-9]', '', lines[0])

    # First line: last 6 of VIN (alphanumeric, 5-7 chars)
    # If 7 chars, take the last 6 (team sometimes includes extra char from VIN)
    vin6_match = re.match(r'^([A-Z0-9]{5,7})$', first_line, re.IGNORECASE)
    if not vin6_match:
        return None

    vin_last6 = vin6_match.group(1).upper()
    if len(vin_last6) == 7:
        vin_last6 = vin_last6[-6:]

    # Second line: miles (numeric, possibly with decimal or leading zeros)
    miles_match = re.match(r'^(\d[\d,.]+\d?)$', lines[1])
    if not miles_match:
        return None

    # Clean up: remove commas, strip leading zeros, round decimals
    miles_raw = miles_match.group(1).replace(',', '')
    try:
        miles = str(round(float(miles_raw)))
    except ValueError:
        miles = miles_raw

    # Lines 3+ can be in two formats:
    # Format A (newer): Good/Okay, then X/10
    # Format B (older): X or X.X (tire score), then Good/Okay
    condition = ""
    tire_condition = ""
    notes = []

    remaining = lines[2:]

    # Detect format by checking if line 3 is a condition word or a number
    condition_words = {"good", "okay", "ok", "fair", "poor", "excellent", "great", "bad"}

    for line in remaining:
        line_lower = line.lower().strip()
        tire_match = re.match(r'^(\d+[.,]?\d*)\s*/\s*(\d+)$', line)
        is_condition = line_lower in condition_words
        is_bare_number = re.match(r'^(\d+[.,]?\d*)$', line) and not condition

        if is_condition and not condition:
            condition = line.strip()
        elif tire_match and not tire_condition:
            tire_condition = line.replace(',', '.').strip()
        elif is_bare_number and not tire_condition:
            # Older format: bare number is tire score (e.g. "8.5" meaning 8.5/10)
            tire_condition = line.replace(',', '.').strip() + "/10"
        else:
            # Check if this is a condition word embedded with extra text
            if not condition and any(w in line_lower for w in condition_words):
                condition = line.strip()
            else:
                notes.append(line)

    return {
        "vin_last6": vin_last6,
        "miles": miles,
        "condition": condition,
        "tire_condition": tire_condition,
        "notes": "\n".join(notes) if notes else "",
    }


def mac_absolute_to_datetime(mac_abs: int) -> datetime:
    """Convert macOS absolute time (nanoseconds since 2001-01-01) to datetime."""
    unix_ts = mac_abs / 1_000_000_000 + 978307200
    return datetime.fromtimestamp(unix_ts)


def datetime_to_mac_absolute(dt: datetime) -> int:
    """Convert datetime to macOS absolute time (nanoseconds)."""
    unix_ts = dt.timestamp()
    return int((unix_ts - 978307200) * 1_000_000_000)


def load_last_scrape() -> str | None:
    """Load the timestamp of the last scrape."""
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, 'r') as f:
            data = json.load(f)
            return data.get("last_message_date")
    return None


def save_last_scrape(last_date: str):
    """Save the timestamp of the last scraped message."""
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump({"last_message_date": last_date, "scraped_at": datetime.now().isoformat()}, f, indent=2)


def get_messages(start_date: str = None, end_date: str = None, chat_id: int = None) -> list:
    """
    Query iMessage database for messages from a specific chat within a date range.
    Copies chat.db + WAL/SHM to a temp directory first so we never touch the live
    database — this prevents Messages.app from glitching or missing messages.
    """
    if chat_id is None:
        chat_id = CHAT_ID

    # Copy the DB and its WAL/SHM to a temp dir so we have zero contact with the live file
    tmp_dir = tempfile.mkdtemp(prefix="imsg_scrape_")
    tmp_db = os.path.join(tmp_dir, "chat.db")
    try:
        shutil.copy2(MESSAGES_DB, tmp_db)
        # Copy WAL and SHM if they exist — needed for SQLite to read uncommitted data
        for suffix in ("-wal", "-shm"):
            src = MESSAGES_DB + suffix
            if os.path.exists(src):
                shutil.copy2(src, tmp_db + suffix)
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise RuntimeError(f"Failed to copy Messages DB: {e}")

    db = sqlite3.connect(tmp_db)
    cursor = db.cursor()

    where_clauses = ["cmj.chat_id = ?"]
    params = [chat_id]

    if start_date:
        dt = datetime.strptime(start_date, "%Y-%m-%d")
        mac_ts = datetime_to_mac_absolute(dt)
        where_clauses.append("m.date >= ?")
        params.append(mac_ts)

    if end_date:
        dt = datetime.strptime(end_date + " 23:59:59", "%Y-%m-%d %H:%M:%S")
        mac_ts = datetime_to_mac_absolute(dt)
        where_clauses.append("m.date <= ?")
        params.append(mac_ts)

    where = " AND ".join(where_clauses)

    cursor.execute(f"""
        SELECT m.ROWID, m.attributedBody, m.date,
               datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as msg_date,
               h.id as sender,
               GROUP_CONCAT(a.filename, '|||') as attachments,
               GROUP_CONCAT(a.mime_type, '|||') as mimes
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN message_attachment_join maj ON m.ROWID = maj.message_id
        LEFT JOIN attachment a ON maj.attachment_id = a.ROWID
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE {where}
        AND m.attributedBody IS NOT NULL
        GROUP BY m.ROWID
        ORDER BY m.date ASC
    """, params)

    rows = cursor.fetchall()
    db.close()

    # Clean up temp copy
    shutil.rmtree(tmp_dir, ignore_errors=True)

    return rows


def find_associated_images(messages: list, vehicle_idx: int, vehicle_msg: dict) -> list:
    """
    Find images associated with a vehicle entry.
    Looks BEFORE and AFTER the vehicle message for image-only messages
    from the SAME SENDER within ~5 minutes. Photos are often sent as a
    burst right before or after the text details.
    """
    images_before = []
    images_after = []
    vehicle_row = messages[vehicle_idx]
    vehicle_date = vehicle_row[2]  # raw mac date
    vehicle_sender = vehicle_row[4]  # sender phone number / handle

    # Look BACKWARD at recent messages (within ~5 minutes) from the same sender
    for j in range(vehicle_idx - 1, max(vehicle_idx - 15, -1), -1):
        prev_msg = messages[j]
        prev_date = prev_msg[2]
        prev_sender = prev_msg[4]
        time_diff_seconds = (vehicle_date - prev_date) / 1_000_000_000

        # Stop if more than 5 minutes before
        if time_diff_seconds > 300:
            break

        # Skip messages from a different sender
        if prev_sender != vehicle_sender:
            continue

        prev_text = extract_text(prev_msg[1])
        prev_attachments = prev_msg[5]
        prev_mimes = prev_msg[6]

        # If the message has images and little/no text, it's likely pre-sent photos
        if prev_attachments and prev_mimes:
            text_is_minimal = len(prev_text.replace('[IMG]', '').strip()) < 20
            has_images = 'image' in prev_mimes.lower()
            if has_images and text_is_minimal:
                for att, mime in zip(prev_attachments.split('|||'), (prev_mimes or '').split('|||')):
                    if 'image' in mime.lower():
                        images_before.append(att)
            else:
                # Substantial text from same sender = different entry, stop looking back
                break

    # Reverse so earlier photos come first
    images_before.reverse()

    # Collect images from the vehicle message itself
    attachments = vehicle_row[5]
    mimes = vehicle_row[6]
    images_self = []
    if attachments:
        for att, mime in zip(attachments.split('|||'), (mimes or '').split('|||')):
            if 'image' in mime.lower():
                images_self.append(att)

    # Look FORWARD at the next few messages (within ~5 minutes) from the same sender
    for j in range(vehicle_idx + 1, min(vehicle_idx + 15, len(messages))):
        next_msg = messages[j]
        next_date = next_msg[2]
        next_sender = next_msg[4]
        time_diff_seconds = (next_date - vehicle_date) / 1_000_000_000

        # Stop if more than 5 minutes apart
        if time_diff_seconds > 300:
            break

        # Skip messages from a different sender — those belong to another car
        if next_sender != vehicle_sender:
            continue

        next_text = extract_text(next_msg[1])
        next_attachments = next_msg[5]
        next_mimes = next_msg[6]

        # If the next message has images and little/no text, it's likely follow-up photos
        if next_attachments and next_mimes:
            text_is_minimal = len(next_text.replace('[IMG]', '').strip()) < 20
            has_images = 'image' in next_mimes.lower()
            if has_images and text_is_minimal:
                for att, mime in zip(next_attachments.split('|||'), next_mimes.split('|||')):
                    if 'image' in mime.lower():
                        images_after.append(att)
            else:
                # Non-image message or substantial text from same sender = probably a new entry
                break

    return images_before + images_self + images_after


def copy_image(src_path: str, dest_dir: str, index: int) -> str | None:
    """Copy an image file to the destination directory. Converts HEIC to JPEG via sips (fast, no Python overhead)."""
    src = os.path.expanduser(src_path)
    if not os.path.exists(src):
        print(f"    MISSING: {os.path.basename(src)} (not downloaded from iCloud)")
        return None

    os.makedirs(dest_dir, exist_ok=True)

    dest_name = f"photo_{index:03d}.jpg"
    dest = os.path.join(dest_dir, dest_name)

    ext = os.path.splitext(src)[1].lower()
    if ext in ('.heic', '.heif'):
        # Use macOS sips for fast native HEIC→JPEG conversion (no Python PIL needed)
        try:
            subprocess.run(
                ['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', src, '--out', dest],
                capture_output=True, timeout=10
            )
            if os.path.exists(dest):
                return dest_name
        except Exception:
            pass
        # Fallback: just copy as-is
        shutil.copy2(src, dest)
    elif ext in ('.jpg', '.jpeg', '.png'):
        shutil.copy2(src, dest)
    else:
        shutil.copy2(src, dest)

    return dest_name


def scrape(start_date=None, end_date=None, dry_run=False):
    """Main scrape function."""
    print(f"Querying Seller Group messages...")
    if start_date:
        print(f"  From: {start_date}")
    if end_date:
        print(f"  To:   {end_date}")

    messages = get_messages(start_date, end_date)
    print(f"  Found {len(messages)} messages in range\n")

    vehicles = []
    processed_indices = set()

    for i, row in enumerate(messages):
        if i in processed_indices:
            continue

        rowid, body, raw_date, msg_date, sender, attachments, mimes = row
        text = extract_text(body)

        if not text:
            continue

        vehicle = parse_vehicle_entry(text)
        if vehicle:
            vehicle["message_date"] = msg_date
            vehicle["message_id"] = rowid
            vehicle["sender"] = sender
            vehicle["raw_text"] = text

            # Find associated images
            image_paths = find_associated_images(messages, i, vehicle)
            vehicle["image_paths"] = image_paths

            vehicles.append(vehicle)
            processed_indices.add(i)

    print(f"Found {len(vehicles)} vehicle entries\n")

    if dry_run:
        print("--- DRY RUN (no files will be created) ---\n")
        for v in vehicles:
            img_count = len(v['image_paths'])
            notes = f" | Notes: {v['notes']}" if v['notes'] else ""
            print(f"  [{v['message_date']}] VIN ...{v['vin_last6']} | {v['miles']} mi | "
                  f"{v['condition']} | Tires: {v['tire_condition']} | {img_count} photos{notes}")
        return

    # Create output
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    last_date = None

    for v in vehicles:
        folder_name = v['vin_last6']
        folder_path = os.path.join(OUTPUT_DIR, folder_name)

        # Skip if folder already has photos (don't re-convert existing vehicles)
        existing_photos = []
        if os.path.isdir(folder_path):
            existing_photos = [f for f in os.listdir(folder_path) if f.startswith('photo_') and f.endswith('.jpg')]

        if existing_photos and len(existing_photos) >= len(v['image_paths']):
            # Already processed — just update queue and move on
            if queue_manager:
                try:
                    queue_manager.add_vehicle(v['vin_last6'], v)
                except Exception:
                    pass
            last_date = v['message_date']
            continue

        # New vehicle or photo count changed — process it
        if os.path.isdir(folder_path):
            for f in os.listdir(folder_path):
                if f.startswith('photo_') or f in ('analysis.json', 'photo_classifications.json'):
                    os.remove(os.path.join(folder_path, f))

        os.makedirs(folder_path, exist_ok=True)

        # Copy images
        copied = 0
        missing = 0
        for idx, img_path in enumerate(v['image_paths'], 1):
            result = copy_image(img_path, folder_path, idx)
            if result:
                copied += 1
            else:
                missing += 1

        # Track incomplete downloads for retry
        incomplete_file = os.path.join(folder_path, '.incomplete')
        if missing > 0:
            with open(incomplete_file, 'w') as f:
                f.write(f"{missing} of {copied + missing} photos not downloaded from iCloud\n")
        elif os.path.exists(incomplete_file):
            os.remove(incomplete_file)

        # Write vehicle info
        info_path = os.path.join(folder_path, "info.txt")
        with open(info_path, 'w') as f:
            f.write(f"VIN (last 6): {v['vin_last6']}\n")
            f.write(f"Miles: {v['miles']}\n")
            f.write(f"Overall Condition: {v['condition']}\n")
            f.write(f"Tire Condition: {v['tire_condition']}\n")
            if v['notes']:
                f.write(f"Notes: {v['notes']}\n")
            f.write(f"\nScraped from message on: {v['message_date']}\n")
            f.write(f"Sender: {v['sender'] or 'You'}\n")
            f.write(f"\n--- Raw Message ---\n{v['raw_text']}\n")

        # Add to queue manifest
        if queue_manager:
            try:
                queue_manager.add_vehicle(v['vin_last6'], v)
            except Exception as e:
                print(f"  (queue update failed: {e})")

        notes_preview = f" | {v['notes'][:50]}" if v['notes'] else ""
        print(f"  {folder_name}/ - {v['miles']} mi, {v['condition']}, "
              f"tires {v['tire_condition']}, {copied} photos{notes_preview}")

        last_date = v['message_date']

    # Save state for resume
    if last_date:
        save_last_scrape(last_date)
        print(f"\nLast message date saved: {last_date}")

    print(f"\nOutput: {OUTPUT_DIR}")
    print(f"Total vehicles: {len(vehicles)}")


def parse_sold_entry(text: str) -> dict | None:
    """
    Parse a sold car message. These are simpler — just a VIN last 6,
    possibly with 'sold' or other minimal text.
    """
    cleaned = re.sub(r'^[^\x20-\x7E]+', '', text.strip())
    lines = [l.strip() for l in cleaned.strip().split('\n') if l.strip()]
    if not lines:
        return None

    # Look for a VIN6 pattern in the first line
    first_line = re.sub(r'[^A-Za-z0-9]', '', lines[0])
    vin6_match = re.match(r'^([A-Z0-9]{5,7})$', first_line, re.IGNORECASE)
    if not vin6_match:
        # Try to find VIN6 anywhere in the message
        for line in lines:
            cleaned_line = re.sub(r'[^A-Za-z0-9]', '', line)
            match = re.match(r'^([A-Z0-9]{5,7})$', cleaned_line, re.IGNORECASE)
            if match:
                return {
                    "vin_last6": match.group(1).upper(),
                    "notes": text.strip(),
                }
        return None

    return {
        "vin_last6": vin6_match.group(1).upper(),
        "notes": "\n".join(lines[1:]) if len(lines) > 1 else "",
    }


def load_sold_last_scrape() -> str | None:
    """Load the timestamp of the last sold chat scrape."""
    if os.path.exists(SOLD_STATE_FILE):
        with open(SOLD_STATE_FILE, 'r') as f:
            data = json.load(f)
            return data.get("last_message_date")
    return None


def save_sold_last_scrape(last_date: str):
    """Save the timestamp of the last sold chat scrape."""
    os.makedirs(os.path.dirname(SOLD_STATE_FILE), exist_ok=True)
    with open(SOLD_STATE_FILE, 'w') as f:
        json.dump({"last_message_date": last_date, "scraped_at": datetime.now().isoformat()}, f, indent=2)


def scrape_sold_chat(start_date=None, end_date=None, dry_run=False):
    """Scrape the sold cars group chat and mark matching vehicles as sold in queue."""
    if not SOLD_CHAT_ID:
        print("SOLD_CHAT_ID not configured. Run find_chat.py to find the chat ID.")
        return []

    print(f"Querying Sold Group messages (chat {SOLD_CHAT_ID})...")
    if start_date:
        print(f"  From: {start_date}")

    messages = get_messages(start_date, end_date, chat_id=SOLD_CHAT_ID)
    print(f"  Found {len(messages)} messages in range\n")

    if dry_run:
        print("--- DRY RUN (no vehicles will be marked) ---\n")

    sold_vins = []
    last_date = None

    for row in messages:
        rowid, body, raw_date, msg_date, sender, attachments, mimes = row
        text = extract_text(body)
        if not text:
            continue

        entry = parse_sold_entry(text)
        if entry:
            vin6 = entry["vin_last6"]
            sold_vins.append(vin6)

            if dry_run:
                print(f"  [{msg_date}] VIN ...{vin6}")
            elif queue_manager:
                try:
                    result = queue_manager.mark_sold(vin6, "sold_chat")
                    status = "marked sold" if result else "not in queue"
                except Exception as e:
                    status = f"error: {e}"
                print(f"  {vin6} - {status} (from {msg_date})")
            else:
                print(f"  {vin6} - queue_manager not available (from {msg_date})")

            last_date = msg_date

    if last_date and not dry_run:
        save_sold_last_scrape(last_date)

    print(f"\nTotal sold entries found: {len(sold_vins)}")
    return sold_vins


def main():
    parser = argparse.ArgumentParser(description="Scrape Seller Group iMessage chat for vehicle data")
    parser.add_argument("--start", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", help="End date (YYYY-MM-DD)")
    parser.add_argument("--all", action="store_true", help="Scrape all messages from scratch (ignore resume state)")
    parser.add_argument("--list", action="store_true", help="Dry run - list what would be scraped")
    parser.add_argument("--sold", action="store_true", help="Scrape the sold cars group chat")
    parser.add_argument("--sold-chat-id", type=int, help="Override SOLD_CHAT_ID")
    args = parser.parse_args()

    # Override sold chat ID if provided
    if args.sold_chat_id:
        global SOLD_CHAT_ID
        SOLD_CHAT_ID = args.sold_chat_id

    if args.sold:
        # Scrape sold chat only
        start = args.start
        if not start and not args.all:
            try:
                last = load_sold_last_scrape()
                if last:
                    last_dt = datetime.strptime(last, "%Y-%m-%d %H:%M:%S")
                    start = last_dt.strftime("%Y-%m-%d")
                    print(f"Resuming sold scrape from: {last}\n")
            except Exception:
                print("Could not read last sold scrape state, scraping all.\n")
        scrape_sold_chat(start_date=start, end_date=args.end, dry_run=args.list)
        return

    start = args.start
    end = args.end

    # Resume logic: if no --start and no --all, pick up from last scrape
    if not start and not args.all:
        try:
            last = load_last_scrape()
            if last:
                last_dt = datetime.strptime(last, "%Y-%m-%d %H:%M:%S")
                start = last_dt.strftime("%Y-%m-%d")
                print(f"Resuming from last scrape: {last}\n")
            else:
                print("No previous scrape found. Scraping all messages.\n")
        except Exception:
            print("Could not read last scrape state, scraping all.\n")

    scrape(start_date=start, end_date=end, dry_run=args.list)

    # Auto-scrape sold chat after main scrape if configured
    if SOLD_CHAT_ID and not args.list:
        print("\n--- Scraping sold chat ---")
        sold_start = args.start
        if not sold_start and not args.all:
            last = load_sold_last_scrape()
            if last:
                last_dt = datetime.strptime(last, "%Y-%m-%d %H:%M:%S")
                sold_start = last_dt.strftime("%Y-%m-%d")
        scrape_sold_chat(start_date=sold_start, end_date=args.end)


if __name__ == "__main__":
    main()
