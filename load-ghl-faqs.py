#!/usr/bin/env python3
"""
Bulk-load FAQ entries into a GoHighLevel knowledge base.

Reads voice-agent-faq.md, parses the Q:/A: pairs, and POSTs each one to
POST https://services.leadconnectorhq.com/knowledge-bases/faqs

Credentials come from the environment — never hardcode them here:
  GHL_TOKEN     Private Integration token (Settings > Private Integrations)
  GHL_LOCATION  sub-account / location id
  GHL_KB_ID     knowledge base id

Run a dry pass first to see what it would send:
  python3 load-ghl-faqs.py --dry-run
Then for real:
  python3 load-ghl-faqs.py
"""
import json, os, re, subprocess, sys, time

API = "https://services.leadconnectorhq.com/knowledge-bases/faqs"
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voice-agent-faq.md")
DRY = "--dry-run" in sys.argv


def parse(path):
    """Pull Q:/A: pairs out of the markdown. Answers may wrap across lines."""
    text = open(path).read()
    pairs, q, buf = [], None, []
    for line in text.splitlines():
        if line.startswith("Q:"):
            if q and buf:
                pairs.append((q, " ".join(buf).strip()))
            q, buf = line[2:].strip(), []
        elif line.startswith("A:"):
            buf = [line[2:].strip()]
        elif q and buf and line.strip() and not line.startswith(("#", "-", "Add ", "Do not")):
            buf.append(line.strip())
        elif not line.strip() and q and buf:
            pairs.append((q, " ".join(buf).strip()))
            q, buf = None, []
    if q and buf:
        pairs.append((q, " ".join(buf).strip()))
    return pairs


def post(token, body):
    """Shell out to curl. GHL sits behind Cloudflare, which rejects
    Python-urllib's default signature with a 1010 before the API sees it."""
    out = subprocess.run(
        ["curl", "-s", "-w", "\n%{http_code}", "-X", "POST", API,
         "-H", f"Authorization: Bearer {token}",
         "-H", "Version: v3",
         "-H", "Content-Type: application/json",
         "-H", "Accept: application/json",
         "--data-binary", json.dumps(body)],
        capture_output=True, text=True, timeout=30,
    ).stdout.rsplit("\n", 1)
    return int(out[-1]), out[0]


def main():
    pairs = parse(SRC)
    print(f"parsed {len(pairs)} FAQ pairs from {os.path.basename(SRC)}\n")

    if DRY:
        for i, (q, a) in enumerate(pairs, 1):
            print(f"{i:>2}. Q: {q}\n    A: {a}\n")
        print("dry run — nothing sent")
        return

    token = os.environ.get("GHL_TOKEN")
    loc = os.environ.get("GHL_LOCATION")
    kb = os.environ.get("GHL_KB_ID")
    missing = [n for n, v in (("GHL_TOKEN", token), ("GHL_LOCATION", loc), ("GHL_KB_ID", kb)) if not v]
    if missing:
        sys.exit(f"missing env vars: {', '.join(missing)}")

    ok = skip = fail = 0
    for i, (q, a) in enumerate(pairs, 1):
        body = {"locationId": loc, "knowledgeBaseId": kb, "question": q, "answer": a}
        try:
            status, resp = post(token, body)
        except Exception as e:
            fail += 1
            print(f"{i:>2}/{len(pairs)}  ERR   {q[:58]}\n      {e}")
            continue
        if status in (200, 201):
            ok += 1
            print(f"{i:>2}/{len(pairs)}  ok    {q[:58]}")
        elif status == 409:
            skip += 1
            print(f"{i:>2}/{len(pairs)}  dup   {q[:58]}")
        else:
            fail += 1
            print(f"{i:>2}/{len(pairs)}  {status}   {q[:58]}\n      {resp[:200]}")
        time.sleep(0.25)  # stay under rate limits

    print(f"\ndone — {ok} created, {skip} already existed, {fail} failed")


if __name__ == "__main__":
    main()
