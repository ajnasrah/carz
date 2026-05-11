#!/usr/bin/env python3
"""
Purges photo folders for vehicles that no longer need them.

Keeps: queued + hold (still need photos to list).
Deletes: listed, sold, removed (already on SA or done).
Also removes orphan folders (on disk but not in queue.json).
"""

import os
import shutil
import sys

import queue_manager
from queue_manager import OUTPUT_DIR


KEEP_STATUSES = {"queued", "hold"}


def folder_size(path: str) -> int:
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def main(dry_run: bool = False):
    queue = queue_manager.load_queue()
    vehicles = queue["vehicles"]

    to_delete = []
    freed = 0
    kept = 0

    on_disk = {
        d for d in os.listdir(OUTPUT_DIR)
        if os.path.isdir(os.path.join(OUTPUT_DIR, d)) and not d.startswith('.')
    }

    for vin6 in sorted(on_disk):
        folder = os.path.join(OUTPUT_DIR, vin6)
        entry = vehicles.get(vin6)
        status = entry["status"] if entry else "orphan"

        if status in KEEP_STATUSES:
            kept += 1
            continue

        size = folder_size(folder)
        to_delete.append((vin6, status, size, folder))
        freed += size

    print(f"On disk: {len(on_disk)} folders")
    print(f"Keeping: {kept} (queued + hold)")
    print(f"Deleting: {len(to_delete)} folders → {human(freed)}")
    by_status = {}
    for _, s, sz, _ in to_delete:
        b = by_status.setdefault(s, [0, 0])
        b[0] += 1
        b[1] += sz
    for s, (c, sz) in sorted(by_status.items()):
        print(f"  {s}: {c} folders, {human(sz)}")

    if dry_run:
        print("\nDRY RUN — no files deleted. Re-run without --dry to execute.")
        return

    print()
    deleted = 0
    for vin6, status, size, folder in to_delete:
        try:
            shutil.rmtree(folder)
            # Zero out photo_count in queue so it stays accurate
            if vin6 in vehicles:
                vehicles[vin6]["photo_count"] = 0
            deleted += 1
            if deleted % 50 == 0:
                print(f"  ... {deleted}/{len(to_delete)}")
        except OSError as e:
            print(f"  FAILED {vin6}: {e}")

    queue_manager.save_queue(queue)

    # Drop a Spotlight-exclusion marker so macOS stops indexing the rebuilt folder.
    marker = os.path.join(OUTPUT_DIR, ".metadata_never_index")
    if not os.path.exists(marker):
        open(marker, 'w').close()
        print(f"Added Spotlight exclusion: {marker}")

    print(f"\nDone. Deleted {deleted} folders, freed ~{human(freed)}.")


if __name__ == "__main__":
    dry = "--dry" in sys.argv or "--dry-run" in sys.argv
    main(dry_run=dry)
