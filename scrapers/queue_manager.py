#!/usr/bin/env python3
"""
Queue Manager for Carz Inc Vehicle Listing Pipeline

Central manifest (queue.json) that tracks every vehicle's status through the
listing pipeline: queued → listed → sold.

Used by whatsapp_server.py for vehicle queue management.
"""

import json
import os
import tempfile
import re
from datetime import datetime
from pathlib import Path

OUTPUT_DIR = os.path.expanduser("~/Library/Application Support/CarzInc/seller_group_output")
QUEUE_FILE = os.path.join(OUTPUT_DIR, "queue.json")


def load_queue() -> dict:
    """Load the queue manifest. Returns empty structure if not found."""
    if os.path.exists(QUEUE_FILE):
        with open(QUEUE_FILE, 'r') as f:
            return json.load(f)
    return {"version": 1, "updated_at": None, "vehicles": {}}


def save_queue(queue: dict):
    """Atomically save the queue manifest (write to temp, then rename)."""
    queue["updated_at"] = datetime.now().isoformat()
    os.makedirs(os.path.dirname(QUEUE_FILE), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(QUEUE_FILE), suffix=".tmp")
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(queue, f, indent=2)
        os.replace(tmp_path, QUEUE_FILE)
    except Exception:
        os.unlink(tmp_path)
        raise


def add_vehicle(vin6: str, data: dict):
    """Add a vehicle to the queue (or update if it exists and is still queued)."""
    queue = load_queue()
    now = datetime.now().isoformat()

    existing = queue["vehicles"].get(vin6)
    if existing and existing["status"] not in ("queued", None):
        # Don't overwrite listed/sold/removed vehicles
        return existing

    # Count photos in the folder
    folder = os.path.join(OUTPUT_DIR, vin6)
    photo_count = 0
    if os.path.isdir(folder):
        photo_count = len([f for f in os.listdir(folder)
                          if f.startswith('photo_') and f.endswith('.jpg')])

    entry = {
        "vin6": vin6,
        "status": "queued",
        "miles": data.get("miles", ""),
        "condition": data.get("condition", ""),
        "tire_condition": data.get("tire_condition", ""),
        "notes": data.get("notes", ""),
        "photo_count": photo_count,
        "message_date": data.get("message_date", ""),
        "sender": data.get("sender", ""),
        "added_at": existing["added_at"] if existing else now,
        "listed_at": None,
        "sold_at": None,
        "sold_reason": None,
        "full_vin": data.get("full_vin"),
        "sa_status": None,
    }

    queue["vehicles"][vin6] = entry
    save_queue(queue)
    return entry


def _purge_folder(vin6: str):
    """Delete a vehicle's photo folder. Idempotent.

    Logs failures to stderr and falls back to per-file deletion so a single
    locked file (e.g. Finder holding the folder open) can't leave orphans
    behind silently — which is how 2.1 GB of dead photo folders accumulated
    once already.
    """
    import shutil
    import sys
    folder = os.path.join(OUTPUT_DIR, vin6)
    if not os.path.isdir(folder):
        return
    try:
        shutil.rmtree(folder)
    except OSError as e:
        print(f"[queue_manager] rmtree failed for {vin6}: {e} — retrying file-by-file", file=sys.stderr)
        for root, dirs, files in os.walk(folder, topdown=False):
            for name in files:
                p = os.path.join(root, name)
                try:
                    os.unlink(p)
                except OSError as fe:
                    print(f"[queue_manager]   leftover: {p} ({fe})", file=sys.stderr)
            for name in dirs:
                p = os.path.join(root, name)
                try:
                    os.rmdir(p)
                except OSError:
                    pass
        try:
            os.rmdir(folder)
        except OSError as fe:
            print(f"[queue_manager] could not remove folder {folder}: {fe}", file=sys.stderr)


def mark_listed(vin6: str, delete_folder: bool = True) -> dict | None:
    """Mark a vehicle as listed on SmartAuction and delete the photo folder."""
    queue = load_queue()
    if vin6 not in queue["vehicles"]:
        return None
    queue["vehicles"][vin6]["status"] = "listed"
    queue["vehicles"][vin6]["listed_at"] = datetime.now().isoformat()
    queue["vehicles"][vin6]["photo_count"] = 0
    save_queue(queue)
    if delete_folder:
        _purge_folder(vin6)
    return queue["vehicles"][vin6]


def mark_hold(vin6: str) -> dict | None:
    """Put a vehicle on hold."""
    queue = load_queue()
    if vin6 not in queue["vehicles"]:
        return None
    queue["vehicles"][vin6]["status"] = "hold"
    save_queue(queue)
    return queue["vehicles"][vin6]


def unhold(vin6: str) -> dict | None:
    """Take a vehicle off hold back to queued."""
    queue = load_queue()
    if vin6 not in queue["vehicles"]:
        return None
    queue["vehicles"][vin6]["status"] = "queued"
    save_queue(queue)
    return queue["vehicles"][vin6]


def mark_sold(vin6: str, reason: str = "manual", delete_folder: bool = True) -> dict | None:
    """Mark a vehicle as sold and delete the photo folder. Reason: 'sold_chat', 'inventory_removed', 'manual'."""
    queue = load_queue()
    if vin6 not in queue["vehicles"]:
        return None
    queue["vehicles"][vin6]["status"] = "sold"
    queue["vehicles"][vin6]["sold_at"] = datetime.now().isoformat()
    queue["vehicles"][vin6]["sold_reason"] = reason
    queue["vehicles"][vin6]["photo_count"] = 0
    save_queue(queue)
    if delete_folder:
        _purge_folder(vin6)
    return queue["vehicles"][vin6]


def remove_vehicle(vin6: str, delete_folder: bool = True) -> dict | None:
    """Remove a vehicle from the queue and delete its photo folder."""
    queue = load_queue()
    if vin6 not in queue["vehicles"]:
        return None
    queue["vehicles"][vin6]["status"] = "removed"
    queue["vehicles"][vin6]["photo_count"] = 0
    save_queue(queue)
    if delete_folder:
        _purge_folder(vin6)
    return queue["vehicles"][vin6]


def hold_vehicle(vin6: str) -> dict | None:
    """Mark a vehicle as on hold."""
    queue = load_queue()
    if vin6 not in queue["vehicles"]:
        return None
    queue["vehicles"][vin6]["status"] = "hold"
    save_queue(queue)
    return queue["vehicles"][vin6]


def unhold_vehicle(vin6: str) -> dict | None:
    """Return a held vehicle back to queued status."""
    queue = load_queue()
    if vin6 not in queue["vehicles"]:
        return None
    if queue["vehicles"][vin6]["status"] == "hold":
        queue["vehicles"][vin6]["status"] = "queued"
        save_queue(queue)
    return queue["vehicles"][vin6]


def get_queued() -> list:
    """Get only queued (pending listing) vehicles."""
    queue = load_queue()
    return [v for v in queue["vehicles"].values() if v["status"] == "queued"]


def get_by_status(status: str) -> list:
    """Get vehicles by status."""
    queue = load_queue()
    return [v for v in queue["vehicles"].values() if v["status"] == status]


def get_all() -> list:
    """Get all vehicles regardless of status."""
    queue = load_queue()
    return list(queue["vehicles"].values())


def get_vehicle(vin6: str) -> dict | None:
    """Get a specific vehicle from queue by VIN6."""
    queue = load_queue()
    return queue["vehicles"].get(vin6)


def update_photo_count(vin6: str, count: int) -> bool:
    """Update the photo count for a vehicle."""
    queue = load_queue()
    if vin6 in queue["vehicles"]:
        queue["vehicles"][vin6]["photo_count"] = count
        save_queue(queue)
        return True
    return False


def get_stats() -> dict:
    """Get counts by status."""
    queue = load_queue()
    stats = {"queued": 0, "listed": 0, "sold": 0, "removed": 0, "total": 0}
    for v in queue["vehicles"].values():
        stats[v["status"]] = stats.get(v["status"], 0) + 1
        stats["total"] += 1
    return stats


def rebuild_queue() -> dict:
    """
    One-time migration: scan all existing vehicle folders in seller_group_output
    and build queue.json from their info.txt files.
    """
    # Preserve existing statuses — only add new folders, don't overwrite
    queue = load_queue()
    now = datetime.now().isoformat()

    if not os.path.isdir(OUTPUT_DIR):
        save_queue(queue)
        return get_stats()

    for folder_name in sorted(os.listdir(OUTPUT_DIR)):
        folder_path = os.path.join(OUTPUT_DIR, folder_name)
        if not os.path.isdir(folder_path):
            continue
        # Skip hidden folders and non-VIN folders
        if folder_name.startswith('.'):
            continue
        if not re.match(r'^[A-Z0-9]{5,7}$', folder_name, re.IGNORECASE):
            continue

        info_file = os.path.join(folder_path, "info.txt")
        data = {
            "miles": "",
            "condition": "",
            "tire_condition": "",
            "notes": "",
            "message_date": "",
            "sender": "",
        }

        if os.path.exists(info_file):
            with open(info_file, 'r') as f:
                lines = f.readlines()
            in_notes = False
            note_lines = []
            for line in lines:
                stripped = line.strip()
                if stripped.startswith("Miles:"):
                    data["miles"] = stripped.split(":", 1)[1].strip()
                    in_notes = False
                elif stripped.startswith("Overall Condition:"):
                    data["condition"] = stripped.split(":", 1)[1].strip()
                    in_notes = False
                elif stripped.startswith("Tire Condition:"):
                    data["tire_condition"] = stripped.split(":", 1)[1].strip()
                    in_notes = False
                elif stripped.startswith("Notes:"):
                    note_lines = [stripped.split(":", 1)[1].strip()]
                    in_notes = True
                elif stripped.startswith("Scraped from message on:"):
                    data["message_date"] = stripped.split(":", 1)[1].strip()
                    in_notes = False
                elif stripped.startswith("Sender:"):
                    data["sender"] = stripped.split(":", 1)[1].strip()
                    in_notes = False
                elif stripped.startswith("---"):
                    in_notes = False
                elif in_notes and stripped:
                    note_lines.append(stripped)
            data["notes"] = "\n".join(note_lines)

        photo_count = len([f for f in os.listdir(folder_path)
                          if f.startswith('photo_') and f.endswith('.jpg')])

        # Preserve existing status if already in queue
        existing_status = queue["vehicles"].get(folder_name, {}).get("status", "queued")
        queue["vehicles"][folder_name] = {
            "vin6": folder_name,
            "status": existing_status,
            "miles": data["miles"],
            "condition": data["condition"],
            "tire_condition": data["tire_condition"],
            "notes": data["notes"],
            "photo_count": photo_count,
            "message_date": data["message_date"],
            "sender": data["sender"],
            "added_at": now,
            "listed_at": None,
            "sold_at": None,
            "sold_reason": None,
            "full_vin": None,
            "sa_status": None,
        }

    save_queue(queue)
    stats = get_stats()
    print(f"Queue rebuilt: {stats['total']} vehicles migrated")
    return stats


def cross_check(inventory: list, sa_listings: list) -> dict:
    """
    Cross-check queue vs inventory XLSX vs SmartAuction listings.

    Args:
        inventory: list of dicts from XLSX, each with 'vin' (full 17-char VIN)
        sa_listings: list of dicts from SA scrape, each with 'vin' (full VIN) and 'status'

    Returns dict with categorized VIN lists.
    """
    queue = load_queue()

    # Build lookup sets by last 6 of VIN
    queue_vin6s = set(queue["vehicles"].keys())
    queue_queued = {v["vin6"] for v in queue["vehicles"].values() if v["status"] == "queued"}
    queue_sold = {v["vin6"] for v in queue["vehicles"].values() if v["status"] == "sold"}
    queue_listed = {v["vin6"] for v in queue["vehicles"].values() if v["status"] == "listed"}

    inv_vin6s = set()
    inv_by_vin6 = {}
    for item in inventory:
        vin = item.get("vin", "")
        if len(vin) >= 6:
            v6 = vin[-6:].upper()
            inv_vin6s.add(v6)
            inv_by_vin6[v6] = item

    sa_vin6s = set()
    sa_by_vin6 = {}
    for item in sa_listings:
        vin = item.get("vin", "")
        if len(vin) >= 6:
            v6 = vin[-6:].upper()
            sa_vin6s.add(v6)
            sa_by_vin6[v6] = item

    return {
        # In inventory + queued but NOT on SA → need to list
        "ready_to_list": sorted(list(inv_vin6s & queue_queued - sa_vin6s)),
        # In inventory but not in queue at all → never scraped from group chat
        "inventory_not_in_queue": sorted(list(inv_vin6s - queue_vin6s)),
        # On SA but not in inventory → probably sold
        "listed_not_in_inventory": sorted(list(sa_vin6s - inv_vin6s)),
        # Marked sold in queue but still active on SA → need to remove from SA
        "sold_still_listed": sorted(list(queue_sold & sa_vin6s)),
        # In queue but not in inventory → may have been sold
        "queue_not_in_inventory": sorted(list(queue_vin6s - inv_vin6s)),
        # On SA and in inventory → all good, properly listed
        "properly_listed": sorted(list(sa_vin6s & inv_vin6s)),
    }


def sync_sa_inventory(csv_path: str) -> dict:
    """
    Sync queue with a SmartAuction inventory CSV export.

    For each VIN in the CSV:
    - If it has a Removal Date/Reason → mark as "removed" in queue
    - If it has a Sale Date → mark as "sold" in queue
    - If it's active (no removal, no sale) → mark as "listed" in queue
    - Stores the full VIN from SA on the queue entry

    A VIN may appear multiple times in the CSV (re-listed after expiry).
    We use the most recent entry (last row for that VIN) to determine status.
    """
    import csv

    queue = load_queue()
    now = datetime.now().isoformat()

    # Parse CSV — last row per VIN wins (most recent listing)
    vin_rows = {}
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            full_vin = row.get("VIN", "").strip()
            if len(full_vin) >= 6:
                vin_rows[full_vin] = row

    synced = {"listed": 0, "sold": 0, "removed": 0, "skipped": 0}

    for full_vin, row in vin_rows.items():
        vin6 = full_vin[-6:].upper()
        removal_date = row.get("Removal Date", "").strip()
        removal_reason = row.get("Removal Reason", "").strip()
        sale_date = row.get("Sale Date", "").strip()

        entry = queue["vehicles"].get(vin6)
        if not entry:
            synced["skipped"] += 1
            continue

        # Always store the full VIN
        entry["full_vin"] = full_vin

        purge = False
        if sale_date:
            # Car was sold on SA
            if entry["status"] != "sold":
                entry["status"] = "sold"
                entry["sold_at"] = now
                entry["sold_reason"] = "sa_sold"
                entry["sa_status"] = f"sold {sale_date}"
                entry["photo_count"] = 0
                synced["sold"] += 1
                purge = True
                print(f"  {vin6} → sold (SA sale {sale_date})")
            else:
                synced["skipped"] += 1
        elif removal_date:
            # Car expired or was removed from SA
            if entry["status"] not in ("sold", "removed"):
                entry["status"] = "removed"
                entry["sa_status"] = removal_reason or f"removed {removal_date}"
                entry["photo_count"] = 0
                synced["removed"] += 1
                purge = True
                print(f"  {vin6} → removed ({removal_reason})")
            else:
                synced["skipped"] += 1
        else:
            # Active on SA
            if entry["status"] == "queued":
                entry["status"] = "listed"
                entry["listed_at"] = now
                entry["sa_status"] = "active"
                entry["photo_count"] = 0
                synced["listed"] += 1
                purge = True
                print(f"  {vin6} → listed (active on SA)")
            else:
                synced["skipped"] += 1

        if purge:
            _purge_folder(vin6)

    save_queue(queue)
    print(f"\nSync complete: {synced}")
    return synced


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "rebuild":
        stats = rebuild_queue()
        print(f"Stats: {json.dumps(stats, indent=2)}")
    elif len(sys.argv) > 2 and sys.argv[1] == "sync":
        csv_path = sys.argv[2]
        if not os.path.exists(csv_path):
            print(f"File not found: {csv_path}")
        else:
            print(f"Syncing queue with SA inventory: {csv_path}")
            sync_sa_inventory(csv_path)
            stats = get_stats()
            print(f"\nQueue stats: {json.dumps(stats, indent=2)}")
    else:
        stats = get_stats()
        if stats["total"] == 0:
            print("Queue is empty. Run 'python3 queue_manager.py rebuild' to migrate existing folders.")
        else:
            print(f"Queue stats: {json.dumps(stats, indent=2)}")
        print("\nUsage:")
        print("  python3 queue_manager.py rebuild              - Rebuild queue from folders")
        print("  python3 queue_manager.py sync <csv_path>      - Sync with SA inventory CSV")
