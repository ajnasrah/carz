#!/usr/bin/env python3
"""
Local HTTP server for the iMessage Seller Group scraper.
Runs on localhost:7749 so the SmartAuction Chrome extension can trigger scrapes.

Usage:
  python3 imessage_server.py

Endpoints:
  GET  /status   - Check if server is running + last scrape info
  POST /scrape   - Run scraper (optional JSON body: {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"})
  GET  /vehicles - List all scraped vehicle folders
  GET  /vehicle/<vin6> - Get info for a specific vehicle
  GET  /vehicle/<vin6>/photos - Get photo files as base64 for extension
  GET  /queue    - Get queued vehicles only
  GET  /queue/all - Get all vehicles with statuses
  GET  /queue/stats - Get counts by status
  POST /queue/mark-listed/<vin6> - Mark vehicle as listed
  POST /queue/mark-sold/<vin6> - Mark vehicle as sold
  POST /queue/remove/<vin6> - Remove vehicle from queue
  POST /queue/rebuild - Rebuild queue from existing folders
  POST /queue/cross-check - Cross-check queue vs inventory vs SA
  POST /scrape-sold - Scrape sold cars group chat
"""

import base64
import json
import os
import re
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Add the scrapers directory to path so we can import the scraper
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

from imessage_scraper import scrape, scrape_sold_chat, load_last_scrape, load_sold_last_scrape, OUTPUT_DIR, get_messages, extract_text, parse_vehicle_entry, find_associated_images
import queue_manager

PORT = 7749
INACTIVITY_TIMEOUT = 60 * 60  # 60 minutes in seconds

# Track last request time for auto-shutdown
import time as _time
import threading as _threading
_last_activity = _time.time()

# VIN6 validation to prevent path traversal
_VIN6_PATTERN = re.compile(r'^[A-Z0-9]{4,7}$', re.IGNORECASE)
_FULL_VIN_PATTERN = re.compile(r'^[A-Z0-9]{17}$', re.IGNORECASE)

DOWNLOADS_DIR = os.path.expanduser('~/Downloads')
SA_PHOTOS_DIR = os.path.expanduser('~/Desktop/SA Photos')


def _reset_sa_photos_dir():
    """Empty ~/Desktop/SA Photos (and any stale _old sibling) before a new copy."""
    import shutil
    stale = SA_PHOTOS_DIR + '_old'
    if os.path.exists(stale):
        shutil.rmtree(stale, ignore_errors=True)
    if os.path.exists(SA_PHOTOS_DIR):
        try:
            shutil.rmtree(SA_PHOTOS_DIR)
        except OSError:
            # Finder has it open — delete files individually, then rename
            for old_f in os.listdir(SA_PHOTOS_DIR):
                try: os.remove(os.path.join(SA_PHOTOS_DIR, old_f))
                except OSError: pass
            if os.listdir(SA_PHOTOS_DIR):
                try:
                    os.rename(SA_PHOTOS_DIR, stale)
                except OSError:
                    pass


# Try to import Pillow — if available, shrink photos before copying so Finder
# doesn't have to generate preview thumbnails from 5MB originals. Falls back
# to a plain copy when Pillow isn't installed.
try:
    from PIL import Image as _PILImage
    _HAS_PIL = True
except ImportError:
    _HAS_PIL = False


def _copy_photo_for_sa(src, dest, max_dim=1600, quality=82):
    """Copy src -> dest, resizing to max_dim on the longest side.

    SA accepts any reasonable photo size and the human on the other end is
    looking at 800px-wide thumbnails anyway, so shipping the 3000x2250
    original is pure waste. 1600px @ q82 gets us ~400-600 KB files which
    Finder can thumbnail in one frame each instead of chewing for seconds.
    """
    if not _HAS_PIL:
        import shutil
        shutil.copy2(src, dest)
        return
    try:
        with _PILImage.open(src) as im:
            im.load()
            # Drop EXIF rotation by baking it in, then resize
            if im.mode not in ('RGB', 'L'):
                im = im.convert('RGB')
            w, h = im.size
            if max(w, h) > max_dim:
                if w >= h:
                    new_w = max_dim
                    new_h = int(h * max_dim / w)
                else:
                    new_h = max_dim
                    new_w = int(w * max_dim / h)
                im = im.resize((new_w, new_h), _PILImage.LANCZOS)
            im.save(dest, 'JPEG', quality=quality, optimize=True, progressive=True)
    except Exception as err:
        # Any decode/save failure falls back to a raw copy so the user still
        # gets the photo, just un-shrunk.
        print(f"[scraper] resize failed for {os.path.basename(src)}: {err}")
        import shutil
        shutil.copy2(src, dest)
    os.makedirs(SA_PHOTOS_DIR, exist_ok=True)


def _valid_vin6(vin6: str) -> bool:
    return bool(vin6 and _VIN6_PATTERN.match(vin6))

def _valid_full_vin(vin: str) -> bool:
    return bool(vin and _FULL_VIN_PATTERN.match(vin))


# Allowed CORS origins — restrict to local and known extensions
_ALLOWED_ORIGINS = {'http://localhost', 'http://127.0.0.1', f'http://localhost:{PORT}', f'http://127.0.0.1:{PORT}'}

class ScrapeHandler(BaseHTTPRequestHandler):
    def _cors_headers(self):
        origin = self.headers.get('Origin', '')
        # Allow localhost and chrome-extension:// origins only
        if origin in _ALLOWED_ORIGINS or origin.startswith('chrome-extension://'):
            self.send_header('Access-Control-Allow-Origin', origin)
        else:
            self.send_header('Access-Control-Allow-Origin', f'http://localhost:{PORT}')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Server-Token')

    def _json_response(self, data, status=200):
        # Swallow BrokenPipeError — it just means the client (extension) timed
        # out or navigated away before we could reply. Not an error worth
        # crashing the server thread over.
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        except (BrokenPipeError, ConnectionResetError) as e:
            print(f"[scraper] client disconnected before response ({type(e).__name__})")

    def _read_json_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 0:
            return json.loads(self.rfile.read(content_length))
        return {}

    def _extract_vin6(self, path, prefix):
        """Extract and validate vin6 from URL path. Returns None if invalid."""
        vin6 = path.split(prefix, 1)[1].strip('/')
        # Strip any trailing path segments
        if '/' in vin6:
            vin6 = vin6.split('/')[0]
        if not _valid_vin6(vin6):
            self._json_response({'error': f'Invalid VIN: {vin6}'}, 400)
            return None
        return vin6

    def _touch_activity(self):
        global _last_activity
        _last_activity = _time.time()

    def do_OPTIONS(self):
        self._touch_activity()
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _serve_file(self, filepath, content_type='text/html'):
        try:
            with open(filepath, 'r') as f:
                content = f.read().encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', f'{content_type}; charset=utf-8')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            self._json_response({'error': 'File not found'}, 404)

    def do_GET(self):
        self._touch_activity()
        path = urlparse(self.path).path

        if path.startswith('/gallery/'):
            vin6 = self._extract_vin6(path, '/gallery/')
            if vin6 is None: return
            folder = os.path.join(OUTPUT_DIR, vin6)
            if not os.path.isdir(folder):
                self._json_response({'error': 'Not found'}, 404)
                return
            photos = sorted([f for f in os.listdir(folder) if f.endswith('.jpg')])
            html = f"""<!DOCTYPE html><html><head><title>{vin6} Photos</title>
<style>body{{margin:0;background:#111;color:#fff;font-family:system-ui;}}
.header{{padding:12px 20px;background:#1a1a2e;display:flex;justify-content:space-between;align-items:center;}}
.header h1{{font-size:18px;margin:0;}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:4px;padding:4px;}}
.grid img{{width:100%;height:auto;display:block;cursor:pointer;}}
.lightbox{{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:99;justify-content:center;align-items:center;}}
.lightbox.open{{display:flex;}}
.lightbox img{{max-width:95%;max-height:95%;}}
.lightbox .close{{position:absolute;top:10px;right:20px;font-size:30px;cursor:pointer;color:#fff;}}
.lightbox .nav{{position:absolute;top:50%;font-size:40px;cursor:pointer;color:#fff;padding:20px;}}
.lightbox .prev{{left:10px;}}
.lightbox .next{{right:10px;}}
</style></head><body>
<div class="header"><h1>{vin6} — {len(photos)} photos</h1></div>
<div class="grid" id="grid">"""
            for i, p in enumerate(photos):
                html += f'<img src="/photo/{vin6}/{p}" onclick="openLB({i})" />'
            html += f"""</div>
<div class="lightbox" id="lb" onclick="closeLB()">
<span class="close">&times;</span>
<span class="nav prev" onclick="event.stopPropagation();navLB(-1)">&lsaquo;</span>
<img id="lbImg" />
<span class="nav next" onclick="event.stopPropagation();navLB(1)">&rsaquo;</span>
</div>
<script>
var photos={json.dumps([f'/photo/{vin6}/{p}' for p in photos])};
var cur=0;
function openLB(i){{cur=i;document.getElementById('lb').classList.add('open');document.getElementById('lbImg').src=photos[cur];}}
function closeLB(){{document.getElementById('lb').classList.remove('open');}}
function navLB(d){{cur=(cur+d+photos.length)%photos.length;document.getElementById('lbImg').src=photos[cur];}}
document.addEventListener('keydown',function(e){{if(e.key==='Escape')closeLB();if(e.key==='ArrowRight')navLB(1);if(e.key==='ArrowLeft')navLB(-1);}});
</script></body></html>"""
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(html.encode())
            return

        elif path.startswith('/photo/'):
            # Serve individual photo file
            parts = path.split('/photo/', 1)[1].split('/', 1)
            if len(parts) != 2: self._json_response({'error': 'Bad path'}, 400); return
            vin6, filename = parts[0], parts[1]
            if not _valid_vin6(vin6): self._json_response({'error': 'Invalid'}, 400); return
            filepath = os.path.join(OUTPUT_DIR, vin6, filename)
            if not os.path.isfile(filepath) or '..' in filename:
                self._json_response({'error': 'Not found'}, 404); return
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self._cors_headers()
            self.end_headers()
            with open(filepath, 'rb') as f:
                self.wfile.write(f.read())
            return

        elif path == '/' or path == '/dashboard':
            self._serve_file(os.path.join(SCRIPT_DIR, 'dashboard.html'))
            return

        elif path.startswith('/bookmarklet.js'):
            self._serve_file(os.path.join(SCRIPT_DIR, 'bookmarklet.js'), 'application/javascript')
            return

        elif path == '/status':
            last = load_last_scrape()
            stats = queue_manager.get_stats()
            self._json_response({
                'running': True,
                'last_scrape': last,
                'vehicle_count': stats.get('queued', 0),
                'queue_stats': stats,
                'output_dir': OUTPUT_DIR
            })

        elif path == '/vehicles':
            vehicles = []
            if os.path.exists(OUTPUT_DIR):
                for d in sorted(os.listdir(OUTPUT_DIR)):
                    folder = os.path.join(OUTPUT_DIR, d)
                    if not os.path.isdir(folder):
                        continue
                    info_file = os.path.join(folder, 'info.txt')
                    photos = [f for f in os.listdir(folder) if f.startswith('photo_')]
                    entry = {'vin6': d, 'photo_count': len(photos)}
                    if os.path.exists(info_file):
                        with open(info_file) as f:
                            for line in f:
                                if line.startswith('Miles:'):
                                    entry['miles'] = line.split(':', 1)[1].strip()
                                elif line.startswith('Overall Condition:'):
                                    entry['condition'] = line.split(':', 1)[1].strip()
                                elif line.startswith('Tire Condition:'):
                                    entry['tire_condition'] = line.split(':', 1)[1].strip()
                                elif line.startswith('Notes:'):
                                    entry['notes'] = line.split(':', 1)[1].strip()
                    vehicles.append(entry)
            self._json_response({'vehicles': vehicles, 'count': len(vehicles)})

        elif path.startswith('/vehicle/') and path.endswith('/photos'):
            # Serve photo files as base64 for the extension
            vin6 = self._extract_vin6(path, '/vehicle/')
            if vin6 is None: return
            folder = os.path.join(OUTPUT_DIR, vin6)
            if not os.path.isdir(folder):
                self._json_response({'error': f'Vehicle {vin6} not found'}, 404)
                return
            # Limit photos to avoid memory blow-up (50+ photos * 2-3MB = OOM)
            MAX_PHOTOS = 40
            query = parse_qs(urlparse(self.path).query)
            limit = int(query.get('limit', [MAX_PHOTOS])[0])
            offset = int(query.get('offset', [0])[0])

            all_files = sorted([f for f in os.listdir(folder)
                               if f.startswith('photo_') and f.endswith('.jpg')])
            total = len(all_files)
            subset = all_files[offset:offset + limit]

            photos = []
            for f in subset:
                filepath = os.path.join(folder, f)
                try:
                    with open(filepath, 'rb') as img:
                        b64 = base64.b64encode(img.read()).decode('ascii')
                    photos.append({
                        'filename': f,
                        'dataUrl': f'data:image/jpeg;base64,{b64}',
                        'base64': b64,
                    })
                except Exception as e:
                    photos.append({'filename': f, 'error': str(e)})
            self._json_response({
                'vin6': vin6, 'photos': photos, 'count': len(photos),
                'total': total, 'offset': offset, 'limit': limit,
            })

        elif path.startswith('/vehicle/'):
            vin6 = self._extract_vin6(path, '/vehicle/')
            if vin6 is None: return
            folder = os.path.join(OUTPUT_DIR, vin6)
            if not os.path.isdir(folder):
                self._json_response({'error': f'Vehicle {vin6} not found'}, 404)
                return
            info_file = os.path.join(folder, 'info.txt')
            info_text = ''
            if os.path.exists(info_file):
                with open(info_file) as f:
                    info_text = f.read()
            photos = sorted([f for f in os.listdir(folder)
                           if f.startswith('photo_') and f.endswith('.jpg')])
            self._json_response({
                'vin6': vin6,
                'info': info_text,
                'photos': photos,
                'photo_count': len(photos),
                'folder': folder
            })

        # --- Queue endpoints ---
        elif path == '/queue':
            vehicles = queue_manager.get_queued()
            self._json_response({'vehicles': vehicles, 'count': len(vehicles)})

        elif path == '/queue/all':
            vehicles = queue_manager.get_all()
            self._json_response({'vehicles': vehicles, 'count': len(vehicles)})

        elif path == '/queue/stats':
            self._json_response(queue_manager.get_stats())

        # --- Manheim import endpoints ---
        elif path.startswith('/manheim/'):
            vin = path.split('/manheim/', 1)[1].strip('/')
            # Strip trailing /photos if present
            serve_photos = False
            if vin.endswith('/photos'):
                vin = vin.rsplit('/photos', 1)[0]
                serve_photos = True
            if not _valid_full_vin(vin):
                self._json_response({'error': f'Invalid VIN: {vin}'}, 400)
                return
            vin = vin.upper()
            folder = os.path.join(DOWNLOADS_DIR, vin)
            if not os.path.isdir(folder):
                self._json_response({'error': f'No Manheim export found at ~/Downloads/{vin}'}, 404)
                return

            # Parse summary file
            summary_file = os.path.join(folder, f'{vin}_summary.txt')
            vehicle_info = {'vin': vin}
            raw_damages = []
            if os.path.exists(summary_file):
                with open(summary_file) as f:
                    section = None
                    for line in f:
                        s = line.strip()
                        if s.startswith('VIN:'):
                            vehicle_info['vin'] = s.split(':', 1)[1].strip()
                        elif s.startswith('Vehicle:'):
                            vehicle_info['vehicle'] = s.split(':', 1)[1].strip()
                        elif s.startswith('Odometer:'):
                            vehicle_info['odometer'] = s.split(':', 1)[1].strip()
                        elif s.startswith('Condition Score:'):
                            vehicle_info['conditionScore'] = s.split(':', 1)[1].strip()
                        elif 'DAMAGES & ISSUES' in s:
                            section = 'damages'
                        elif 'IMAGES DOWNLOADED' in s:
                            section = 'images'
                        elif 'TIRES AND WHEELS' in s:
                            section = 'tires'
                        elif 'ANNOUNCEMENTS' in s:
                            section = 'announcements'
                        elif section == 'damages' and s and s[0].isdigit():
                            # Parse "1. F Valance (Broken)" or "16. F Valance| Broken"
                            entry = re.sub(r'^\d+\.\s*', '', s)
                            if entry:
                                raw_damages.append(entry)

            # Deduplicate damages — summary has 3 formats of same data
            seen = set()
            damages = []
            for d in raw_damages:
                # Normalize: "F Valance (Broken)", "F Valance| Broken", "F Valance- Broken" all become same key
                # Use " - " (space-dash-space) to avoid splitting hyphenated panel names like "R-Quarter"
                norm = re.sub(r'\s*[\(\|]\s*', ' | ', d).replace(' - ', ' | ').rstrip(')')
                parts = norm.split(' | ', 1)
                panel = parts[0].strip() if parts else d
                dtype = parts[1].strip() if len(parts) > 1 else ''
                key = (panel.lower(), dtype.lower())
                if key not in seen:
                    seen.add(key)
                    damages.append({'panel': panel, 'type': dtype})

            # Get image files
            image_files = sorted([
                f for f in os.listdir(folder)
                if re.match(rf'{re.escape(vin)}_image_\d+\.(jpg|jpeg|png)', f, re.IGNORECASE)
            ], key=lambda x: int(re.search(r'_image_(\d+)', x).group(1)))

            if serve_photos:
                # Serve photos as base64 in batches
                query = parse_qs(urlparse(self.path).query)
                limit = int(query.get('limit', [5])[0])
                offset = int(query.get('offset', [0])[0])
                subset = image_files[offset:offset + limit]
                photos = []
                for f in subset:
                    filepath = os.path.join(folder, f)
                    try:
                        ext = os.path.splitext(f)[1].lower()
                        mime = 'image/png' if ext == '.png' else 'image/jpeg'
                        with open(filepath, 'rb') as img:
                            b64 = base64.b64encode(img.read()).decode('ascii')
                        photos.append({
                            'filename': f,
                            'dataUrl': f'data:{mime};base64,{b64}',
                            'base64': b64,
                        })
                    except Exception as e:
                        photos.append({'filename': f, 'error': str(e)})
                self._json_response({
                    'vin': vin, 'photos': photos, 'count': len(photos),
                    'total': len(image_files), 'offset': offset, 'limit': limit,
                })
            else:
                self._json_response({
                    'vin': vin,
                    'vehicle': vehicle_info,
                    'damages': damages,
                    'photo_count': len(image_files),
                })

        else:
            self._json_response({'error': 'Not found'}, 404)

    def do_POST(self):
        self._touch_activity()
        path = urlparse(self.path).path

        if path.startswith('/open-folder/'):
            vin6 = self._extract_vin6(path, '/open-folder/')
            if vin6 is None: return
            folder = os.path.join(OUTPUT_DIR, vin6)
            if not os.path.isdir(folder):
                self._json_response({'error': f'Vehicle {vin6} not found'}, 404)
                return
            import shutil

            # Copy + shrink photos to ~/Desktop/SA Photos/ so the file dialog
            # can find them easily AND Finder doesn't choke on 5MB originals.
            _reset_sa_photos_dir()
            os.makedirs(SA_PHOTOS_DIR, exist_ok=True)
            count = 0
            for f in sorted(os.listdir(folder)):
                if f.startswith('photo_') and f.endswith('.jpg'):
                    _copy_photo_for_sa(os.path.join(folder, f), os.path.join(SA_PHOTOS_DIR, f))
                    count += 1
            os.listdir(SA_PHOTOS_DIR)  # Nudge macOS to refresh directory metadata
            self._json_response({'success': True, 'folder': SA_PHOTOS_DIR, 'count': count})
            return

        if path == '/scrape':
            body = self._read_json_body()
            start_date = body.get('start')
            end_date = body.get('end')
            scrape_all = body.get('all', False)

            # Resume logic
            if not start_date and not scrape_all:
                last = load_last_scrape()
                if last:
                    from datetime import datetime
                    last_dt = datetime.strptime(last, "%Y-%m-%d %H:%M:%S")
                    start_date = last_dt.strftime("%Y-%m-%d")

            # Capture scrape output
            import io
            from contextlib import redirect_stdout
            output = io.StringIO()

            try:
                with redirect_stdout(output):
                    scrape(start_date=start_date, end_date=end_date)
                out = output.getvalue()
                # Extract vehicle count from output
                import re as _re
                count_match = _re.search(r'Total vehicles: (\d+)', out)
                new_count = int(count_match.group(1)) if count_match else 0
                self._json_response({
                    'success': True,
                    'new_vehicles': new_count,
                    'output': out,
                    'last_scrape': load_last_scrape(),
                    'queue_stats': queue_manager.get_stats()
                })
            except Exception as e:
                import traceback
                print(f"[scraper] SCRAPE ERROR: {e}")
                traceback.print_exc()
                self._json_response({
                    'success': False,
                    'error': str(e),
                    'output': output.getvalue()
                }, 500)

        elif path == '/scrape-locations':
            # Chat-sourced location sync: pull new messages from CARZ INC /
            # Seller Group / Mechanics / Body shop chats and upsert to
            # vehicle_locations. Incremental by default via STATE_FILE.
            body = self._read_json_body()
            incremental = body.get('incremental', True)
            dry_run = body.get('dry_run', False)
            since_iso = body.get('since')

            import io
            from contextlib import redirect_stdout
            output = io.StringIO()
            try:
                import backfill_chat_locations as bcl
                with redirect_stdout(output):
                    result = bcl.run_backfill(
                        dry_run=dry_run, since_iso=since_iso,
                        incremental=incremental,
                    )
                self._json_response({
                    'success': True,
                    **result,
                    'output': output.getvalue(),
                })
            except Exception as e:
                self._json_response({
                    'success': False,
                    'error': str(e),
                    'output': output.getvalue(),
                }, 500)

        elif path == '/scrape-sold':
            body = self._read_json_body()
            start_date = body.get('start')
            end_date = body.get('end')
            scrape_all = body.get('all', False)

            if not start_date and not scrape_all:
                last = load_sold_last_scrape()
                if last:
                    from datetime import datetime
                    last_dt = datetime.strptime(last, "%Y-%m-%d %H:%M:%S")
                    start_date = last_dt.strftime("%Y-%m-%d")

            import io
            from contextlib import redirect_stdout
            output = io.StringIO()

            try:
                with redirect_stdout(output):
                    sold_vins = scrape_sold_chat(start_date=start_date, end_date=end_date)
                self._json_response({
                    'success': True,
                    'sold_vins': sold_vins,
                    'count': len(sold_vins),
                    'output': output.getvalue(),
                    'queue_stats': queue_manager.get_stats()
                })
            except Exception as e:
                self._json_response({
                    'success': False,
                    'error': str(e),
                    'output': output.getvalue() if 'output' in dir() else ''
                }, 500)

        # --- Queue POST endpoints ---
        elif path.startswith('/queue/mark-listed/'):
            vin6 = self._extract_vin6(path, '/queue/mark-listed/')
            if vin6 is None: return
            result = queue_manager.mark_listed(vin6)
            if result:
                self._json_response({'success': True, 'vehicle': result})
            else:
                self._json_response({'error': f'Vehicle {vin6} not found in queue'}, 404)

        elif path.startswith('/queue/hold/'):
            vin6 = self._extract_vin6(path, '/queue/hold/')
            if vin6 is None: return
            result = queue_manager.mark_hold(vin6)
            if result:
                self._json_response({'success': True, 'vehicle': result})
            else:
                self._json_response({'error': f'Vehicle {vin6} not found'}, 404)

        elif path.startswith('/queue/unhold/'):
            vin6 = self._extract_vin6(path, '/queue/unhold/')
            if vin6 is None: return
            result = queue_manager.unhold(vin6)
            if result:
                self._json_response({'success': True, 'vehicle': result})
            else:
                self._json_response({'error': f'Vehicle {vin6} not found'}, 404)

        elif path.startswith('/queue/mark-sold/'):
            vin6 = self._extract_vin6(path, '/queue/mark-sold/')
            if vin6 is None: return
            body = self._read_json_body()
            reason = body.get('reason', 'manual')
            result = queue_manager.mark_sold(vin6, reason)
            if result:
                self._json_response({'success': True, 'vehicle': result})
            else:
                self._json_response({'error': f'Vehicle {vin6} not found in queue'}, 404)

        elif path.startswith('/queue/remove/'):
            vin6 = self._extract_vin6(path, '/queue/remove/')
            if vin6 is None: return
            result = queue_manager.remove_vehicle(vin6)
            if result:
                self._json_response({'success': True, 'vehicle': result})
            else:
                self._json_response({'error': f'Vehicle {vin6} not found in queue'}, 404)

        elif path == '/queue/rebuild':
            import io
            from contextlib import redirect_stdout
            output = io.StringIO()
            with redirect_stdout(output):
                stats = queue_manager.rebuild_queue()
            self._json_response({
                'success': True,
                'stats': stats,
                'output': output.getvalue()
            })

        elif path == '/queue/cross-check':
            body = self._read_json_body()
            inventory = body.get('inventory', [])
            sa_listings = body.get('sa_listings', [])
            results = queue_manager.cross_check(inventory, sa_listings)
            self._json_response({'success': True, 'results': results})

        elif path.startswith('/manheim/open-folder/'):
            vin = path.split('/manheim/open-folder/', 1)[1].strip('/')
            if not _valid_full_vin(vin):
                self._json_response({'error': f'Invalid VIN: {vin}'}, 400)
                return
            vin = vin.upper()
            folder = os.path.join(DOWNLOADS_DIR, vin)
            if not os.path.isdir(folder):
                self._json_response({'error': f'No Manheim export at ~/Downloads/{vin}'}, 404)
                return
            import shutil

            _reset_sa_photos_dir()
            os.makedirs(SA_PHOTOS_DIR, exist_ok=True)
            count = 0
            for f in sorted(os.listdir(folder)):
                if re.match(rf'{re.escape(vin)}_image_\d+\.(jpg|jpeg|png)', f, re.IGNORECASE):
                    # Rename to photo_N.jpg for consistency with SA upload. Force
                    # .jpg extension since _copy_photo_for_sa always writes JPEG.
                    num = re.search(r'_image_(\d+)', f).group(1)
                    dest = f'photo_{num}.jpg'
                    _copy_photo_for_sa(os.path.join(folder, f), os.path.join(SA_PHOTOS_DIR, dest))
                    count += 1

            os.listdir(SA_PHOTOS_DIR)
            self._json_response({'success': True, 'folder': SA_PHOTOS_DIR, 'count': count})

        elif path == '/shutdown':
            self._json_response({'success': True, 'message': 'Server shutting down'})
            # Shut down after sending response
            _threading.Thread(target=self.server.shutdown, daemon=True).start()

        else:
            self._json_response({'error': 'Not found'}, 404)

    def log_message(self, format, *args):
        # Quieter logging
        print(f"[scraper] {args[0]}")


def _start_inactivity_watchdog(server):
    """Shut down the server after INACTIVITY_TIMEOUT seconds of no requests."""
    def watchdog():
        while True:
            _time.sleep(60)  # Check every minute
            idle = _time.time() - _last_activity
            if idle >= INACTIVITY_TIMEOUT:
                mins = int(idle // 60)
                print(f"\n[auto-shutdown] No activity for {mins} minutes. Shutting down.")
                server.shutdown()
                return
    t = _threading.Thread(target=watchdog, daemon=True)
    t.start()


def main():
    # Auto-rebuild queue on first run
    if not os.path.exists(queue_manager.QUEUE_FILE):
        print("No queue.json found. Rebuilding from existing folders...")
        queue_manager.rebuild_queue()
        print()

    server = HTTPServer(('127.0.0.1', PORT), ScrapeHandler)
    stats = queue_manager.get_stats()
    print(f"iMessage Scraper Server running on http://localhost:{PORT}")
    print(f"Output dir: {OUTPUT_DIR}")
    print(f"Queue: {stats['queued']} queued, {stats['listed']} listed, {stats['sold']} sold ({stats['total']} total)")
    print(f"Auto-shutdown after {INACTIVITY_TIMEOUT // 60} minutes of inactivity")

    # Start inactivity watchdog
    _start_inactivity_watchdog(server)

    print(f"Press Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == '__main__':
    main()
