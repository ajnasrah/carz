#!/usr/bin/env python3
"""
Find iMessage Chat IDs

Lists all group chats in your iMessage database with their IDs,
display names, and participants. Use this to find the ROWID for
the "sold cars" group chat.

Usage:
  python3 find_chat.py              # List all group chats
  python3 find_chat.py --search sold  # Search for chats containing "sold"
  python3 find_chat.py --all         # Include 1-on-1 chats too
"""

import sqlite3
import os
import argparse
import shutil
import tempfile

MESSAGES_DB = os.path.expanduser("~/Library/Messages/chat.db")


def list_chats(search: str = None, include_individual: bool = False):
    # Copy DB to temp file so we never lock the live Messages database
    tmp_dir = tempfile.mkdtemp(prefix="imsg_find_")
    tmp_db = os.path.join(tmp_dir, "chat.db")
    shutil.copy2(MESSAGES_DB, tmp_db)
    for suffix in ("-wal", "-shm"):
        src = MESSAGES_DB + suffix
        if os.path.exists(src):
            shutil.copy2(src, tmp_db + suffix)

    db = sqlite3.connect(tmp_db)
    cursor = db.cursor()

    # Get chats with participant info
    cursor.execute("""
        SELECT c.ROWID, c.chat_identifier, c.display_name, c.style,
               GROUP_CONCAT(h.id, ', ') as participants,
               COUNT(DISTINCT cmj.message_id) as message_count
        FROM chat c
        LEFT JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        LEFT JOIN handle h ON chj.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
        GROUP BY c.ROWID
        ORDER BY message_count DESC
    """)

    rows = cursor.fetchall()
    db.close()
    shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"{'ID':>6}  {'Style':>5}  {'Messages':>8}  {'Name':<30}  {'Participants'}")
    print("-" * 120)

    for rowid, chat_id, display_name, style, participants, msg_count in rows:
        # style 43 = group chat, 45 = individual
        is_group = style == 43
        if not include_individual and not is_group:
            continue

        name = display_name or chat_id or ""
        participants = participants or ""
        style_label = "GROUP" if is_group else "1on1"

        # Search filter
        if search:
            searchable = f"{name} {participants} {chat_id}".lower()
            if search.lower() not in searchable:
                continue

        # Truncate for display
        name_display = name[:30] if name else "(no name)"
        participants_display = participants[:60] + ("..." if len(participants) > 60 else "")

        print(f"{rowid:>6}  {style_label:>5}  {msg_count:>8}  {name_display:<30}  {participants_display}")

    print(f"\nTo use a chat ID, set it in imessage_scraper.py:")
    print(f"  SOLD_CHAT_ID = <ID from above>")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Find iMessage chat IDs")
    parser.add_argument("--search", "-s", help="Filter chats by name/participants")
    parser.add_argument("--all", "-a", action="store_true", help="Include individual (1-on-1) chats")
    args = parser.parse_args()

    list_chats(search=args.search, include_individual=args.all)
