#!/usr/bin/env python3
"""
WhatsApp Server for Carz Inc - Replaces iMessage Server
Runs on localhost:7749 to maintain compatibility with Chrome extensions

This uses WhatsApp Web automation via whatsapp-web.js running in Node.js
The Python server communicates with the Node.js WhatsApp client

Usage:
  1. First run: node whatsapp_client.js (in another terminal)
  2. Then run: python3 whatsapp_server.py
  3. Scan QR code when prompted in the Node.js terminal

Endpoints (same as iMessage server for compatibility):
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
  
New WhatsApp endpoints:
  POST /webhook/whatsapp - Receive messages from WhatsApp client
  GET  /whatsapp/status - Check WhatsApp connection status
"""

import base64
import json
import os
import re
import sys
import requests
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import threading
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

import queue_manager

PORT = 7749
NODE_PORT = 7750  # WhatsApp Node.js client port
INACTIVITY_TIMEOUT = 60 * 60  # 60 minutes

OUTPUT_DIR = os.path.expanduser("~/Library/Application Support/CarzInc/seller_group_output")
STATE_FILE = os.path.join(OUTPUT_DIR, ".last_scrape_whatsapp")
SA_PHOTOS_DIR = os.path.expanduser('~/Desktop/SA Photos')
DOWNLOADS_DIR = os.path.expanduser('~/Downloads')

# Supabase configuration for carzinc.ai
SUPABASE_URL = 'https://yprihgygmreibcuybwoy.supabase.co'
SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwcmloZ3lnbXJlaWJjdXlid295Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODYzNTAsImV4cCI6MjA4ODk2MjM1MH0.L1oDMq7wYnyZwjZOYcYhNvrP0I5wFxf5BZPAwRM3m0o'

# Track last activity for auto-shutdown
_last_activity = time.time()

# VIN validation patterns
_VIN6_PATTERN = re.compile(r'^[A-Z0-9]{4,7}$', re.IGNORECASE)
_FULL_VIN_PATTERN = re.compile(r'^[A-Z0-9]{17}$', re.IGNORECASE)

# WhatsApp message cache
message_cache = []
whatsapp_connected = False
last_scrape_time = None


def load_last_scrape():
    """Load the timestamp of the last successful scrape."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r') as f:
                data = json.load(f)
                return datetime.fromisoformat(data['last_scrape'])
        except (json.JSONDecodeError, KeyError, ValueError):
            return None
    return None


def save_last_scrape(timestamp):
    """Save the timestamp of the last successful scrape."""
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump({'last_scrape': timestamp.isoformat()}, f)


def update_vehicle_location(vin_last6, location, updated_by='WhatsApp'):
    """Update vehicle location on carzinc.ai via Supabase."""
    try:
        # First, check vehicle_locations table by VIN last 6
        search_url = f"{SUPABASE_URL}/rest/v1/vehicle_locations"
        headers = {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        # Search for vehicle by VIN pattern (last 6 digits)
        params = {
            'vin': f'ilike.%{vin_last6}',
            'select': 'stock_number,vin,physical_location',
            'limit': '1'
        }
        
        search_response = requests.get(search_url, headers=headers, params=params)
        
        if search_response.status_code == 200:
            vehicles = search_response.json()
            
            if vehicles:
                vehicle = vehicles[0]  # Get first match
                stock_number = vehicle.get('stock_number')
                current_location = vehicle.get('physical_location', '')
                
                # Map WhatsApp group to location code
                location_code = 'body_shop' if location == 'Body Shop' else 'mechanic_shop'
                
                # Update location if different
                if current_location != location_code:
                    update_url = f"{SUPABASE_URL}/rest/v1/vehicle_locations"
                    update_params = {'stock_number': f'eq.{stock_number}'}
                    update_data = {
                        'physical_location': location_code,
                        'physical_source': 'whatsapp',
                        'location_updated_at': datetime.now(timezone.utc).isoformat(),
                        'notes': {'updated_by': updated_by, 'from_group': location}
                    }
                    
                    update_response = requests.patch(
                        update_url,
                        headers=headers,
                        params=update_params,
                        json=update_data
                    )
                    
                    if update_response.status_code in [200, 204]:
                        print(f"✅ Updated location for {vin_last6} (Stock: {stock_number}) to {location_code}")
                        return True
                    else:
                        print(f"❌ Failed to update location: {update_response.status_code}")
                        print(f"   Response: {update_response.text}")
                        return False
                else:
                    print(f"ℹ️ {vin_last6} already at {location_code}")
                    return True
            else:
                print(f"⚠️ Vehicle with VIN ending {vin_last6} not found in vehicle_locations table")
                # Could create a new entry or log this somewhere
                return False
        else:
            print(f"❌ Error searching for vehicle: {search_response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Error updating location: {str(e)}")
        return False


def parse_vehicle_entry(text):
    """
    Parse a vehicle inspection message into structured data.
    Expected format (same as iMessage):
        [last 6 of VIN]
        [miles]
        [condition]
        [tire score]
        [optional notes...]
    """
    cleaned = re.sub(r'^[^\x20-\x7E]+', '', text.strip())
    lines = [l.strip() for l in cleaned.strip().split('\n') if l.strip()]
    if len(lines) < 3:
        return None

    first_line = re.sub(r'[^A-Za-z0-9]', '', lines[0])
    
    vin6_match = re.match(r'^([A-Z0-9]{5,7})$', first_line, re.IGNORECASE)
    if not vin6_match:
        return None

    vin_last6 = vin6_match.group(1).upper()
    if len(vin_last6) == 7:
        vin_last6 = vin_last6[-6:]
    elif len(vin_last6) == 5:
        vin_last6 = '0' + vin_last6

    miles_line = lines[1].replace(',', '').replace('miles', '').strip()
    miles_match = re.search(r'(\d+)', miles_line)
    if not miles_match:
        return None
    miles = int(miles_match.group(1))

    condition = lines[2] if len(lines) > 2 else ""
    
    tire_line = lines[3] if len(lines) > 3 else ""
    tire_match = re.search(r'(\d+(?:\.\d+)?)', tire_line)
    tire_condition = float(tire_match.group(1)) if tire_match else ""

    notes = '\n'.join(lines[4:]) if len(lines) > 4 else ""

    return {
        'vin6': vin_last6,
        'miles': miles,
        'condition': condition,
        'tire_condition': tire_condition,
        'notes': notes
    }


def save_whatsapp_photo(photo_data, vin6, photo_index):
    """Save a photo from WhatsApp to the vehicle folder."""
    folder = os.path.join(OUTPUT_DIR, vin6)
    os.makedirs(folder, exist_ok=True)
    
    photo_path = os.path.join(folder, f"photo_{photo_index:03d}.jpg")
    
    # Decode base64 if needed
    if isinstance(photo_data, str):
        # Remove data URL prefix if present
        if photo_data.startswith('data:'):
            photo_data = photo_data.split(',', 1)[1]
        photo_bytes = base64.b64decode(photo_data)
    else:
        photo_bytes = photo_data
    
    with open(photo_path, 'wb') as f:
        f.write(photo_bytes)
    
    return photo_path


def process_whatsapp_message(message_data):
    """Process a message received from WhatsApp."""
    global message_cache
    
    message_cache.append(message_data)
    
    # Parse text messages for vehicle data
    if message_data.get('type') == 'text':
        text = message_data.get('body', '')
        group_type = message_data.get('groupType', 'seller')
        
        # For Body shop and Mechanic groups, update location
        if group_type in ['bodyshop', 'mechanic']:
            # Extract VIN last 6 from message (could be just the VIN or full message)
            vin6_match = re.search(r'\b([A-Z0-9]{5,7})\b', text.upper())
            if vin6_match:
                vin_last6 = vin6_match.group(1)
                if len(vin_last6) == 7:
                    vin_last6 = vin_last6[-6:]
                elif len(vin_last6) == 5:
                    vin_last6 = '0' + vin_last6
                
                # Update location based on group type
                location = 'Body Shop' if group_type == 'bodyshop' else 'Mechanic Shop'
                update_vehicle_location(vin_last6, location, message_data.get('author', 'Unknown'))
                
                # Log the update
                print(f"📍 Location Update: {vin_last6} moved to {location}")
                return vin_last6
        
        # For seller group, process as inspection
        else:
            vehicle_data = parse_vehicle_entry(text)
            
            if vehicle_data:
                # Add metadata
                vehicle_data['message_date'] = message_data.get('timestamp', datetime.now().isoformat())
                vehicle_data['sender'] = message_data.get('author', 'Unknown')
                vehicle_data['source'] = 'whatsapp'
                vehicle_data['group_type'] = group_type
                vehicle_data['chat_name'] = message_data.get('chatName', 'Unknown Group')
                
                # Create subfolder based on group type
                group_output_dir = os.path.join(OUTPUT_DIR, vehicle_data['group_type'])
                os.makedirs(group_output_dir, exist_ok=True)
                
                # Add to queue
                queue_manager.add_vehicle(vehicle_data['vin6'], vehicle_data)
                
                # Store for photo association
                return vehicle_data['vin6']
    
    return None


def _reset_sa_photos_dir():
    """Empty ~/Desktop/SA Photos before a new copy."""
    stale = SA_PHOTOS_DIR + '_old'
    if os.path.exists(stale):
        shutil.rmtree(stale, ignore_errors=True)
    if os.path.exists(SA_PHOTOS_DIR):
        try:
            shutil.rmtree(SA_PHOTOS_DIR)
        except OSError:
            for old_f in os.listdir(SA_PHOTOS_DIR):
                try: os.remove(os.path.join(SA_PHOTOS_DIR, old_f))
                except OSError: pass
            if os.listdir(SA_PHOTOS_DIR):
                try:
                    os.rename(SA_PHOTOS_DIR, stale)
                except OSError:
                    pass


def trigger_whatsapp_scrape(start_date=None, end_date=None):
    """Trigger the WhatsApp Node.js client to fetch messages."""
    try:
        # If no start date, use last scrape time
        if not start_date:
            last_scrape = load_last_scrape()
            if last_scrape:
                start_date = last_scrape
                print(f"📅 Scraping from last checkpoint: {start_date.isoformat()}")
        
        params = {'limit': 1000}  # Get more messages
        if start_date:
            params['start'] = start_date.isoformat()
        if end_date:
            params['end'] = end_date.isoformat()
        
        response = requests.post(
            f'http://localhost:{NODE_PORT}/scrape',
            json=params,
            timeout=60  # Increase timeout for more messages
        )
        
        if response.status_code == 200:
            data = response.json()
            messages = data.get('messages', [])
            
            # Process each message
            current_vin6 = None
            photo_index = 1
            location_updates = 0
            vehicle_updates = 0
            
            for msg in messages:
                group_type = msg.get('groupType', 'seller')
                
                if msg.get('type') == 'text':
                    text = msg.get('body', '')
                    
                    # Handle Body Shop and Mechanic location updates
                    if group_type in ['bodyshop', 'mechanic']:
                        vin6_match = re.search(r'\b([A-Z0-9]{5,7})\b', text.upper())
                        if vin6_match:
                            vin_last6 = vin6_match.group(1)
                            if len(vin_last6) == 7:
                                vin_last6 = vin_last6[-6:]
                            elif len(vin_last6) == 5:
                                vin_last6 = '0' + vin_last6
                            
                            location = 'Body Shop' if group_type == 'bodyshop' else 'Mechanic Shop'
                            author = msg.get('author', 'Unknown')
                            
                            if update_vehicle_location(vin_last6, location, author):
                                location_updates += 1
                    
                    # Handle seller group inspection messages
                    elif group_type == 'seller':
                        vehicle_data = parse_vehicle_entry(text)
                        if vehicle_data:
                            current_vin6 = vehicle_data['vin6']
                            photo_index = 1
                            
                            vehicle_data['message_date'] = msg.get('timestamp', datetime.now().isoformat())
                            vehicle_data['sender'] = msg.get('author', 'Unknown')
                            vehicle_data['source'] = 'whatsapp'
                            
                            queue_manager.add_vehicle(current_vin6, vehicle_data)
                            vehicle_updates += 1
                
                elif msg.get('type') == 'image' and current_vin6:
                    # Save associated photo
                    photo_data = msg.get('media')
                    if photo_data:
                        save_whatsapp_photo(photo_data, current_vin6, photo_index)
                        photo_index += 1
            
            # Update last scrape time
            save_last_scrape(datetime.now())
            
            print(f"📊 Scrape Results:")
            print(f"   Messages processed: {len(messages)}")
            print(f"   Location updates: {location_updates}")
            print(f"   Vehicle inspections: {vehicle_updates}")
            
            return {
                'success': True,
                'message_count': len(messages),
                'location_updates': location_updates,
                'vehicle_updates': vehicle_updates,
                'vehicles_found': vehicle_updates
            }
        else:
            return {'success': False, 'error': f'Node.js client returned {response.status_code}'}
    
    except requests.exceptions.ConnectionError:
        return {'success': False, 'error': 'WhatsApp client not running. Run: node whatsapp_client.js'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global _last_activity, whatsapp_connected
        _last_activity = time.time()
        
        parsed = urlparse(self.path)
        path = parsed.path
        
        # Check server status
        if path == '/status':
            last_scrape = load_last_scrape()
            
            # Check WhatsApp connection
            try:
                wa_response = requests.get(f'http://localhost:{NODE_PORT}/status', timeout=2)
                whatsapp_connected = wa_response.status_code == 200 and wa_response.json().get('connected', False)
            except:
                whatsapp_connected = False
            
            self.send_json({
                'online': True,
                'whatsapp_connected': whatsapp_connected,
                'last_scrape': last_scrape.isoformat() if last_scrape else None,
                'message': 'WhatsApp server running' if whatsapp_connected else 'WhatsApp client not connected'
            })
        
        # Get vehicles
        elif path == '/vehicles':
            vehicles = []
            if os.path.isdir(OUTPUT_DIR):
                for folder in os.listdir(OUTPUT_DIR):
                    folder_path = os.path.join(OUTPUT_DIR, folder)
                    if os.path.isdir(folder_path) and _VIN6_PATTERN.match(folder):
                        info_file = os.path.join(folder_path, 'info.json')
                        if os.path.exists(info_file):
                            with open(info_file, 'r') as f:
                                info = json.load(f)
                                info['vin6'] = folder
                                vehicles.append(info)
            self.send_json(vehicles)
        
        # Get queue
        elif path == '/queue' or path == '/queue/all':
            queue = queue_manager.load_queue()
            if path == '/queue':
                # Filter to only queued vehicles
                vehicles = {k: v for k, v in queue['vehicles'].items() 
                           if v.get('status') == 'queued'}
            else:
                vehicles = queue['vehicles']
            
            self.send_json({
                'updated_at': queue.get('updated_at'),
                'vehicles': vehicles
            })
        
        # Get queue stats
        elif path == '/queue/stats':
            queue = queue_manager.load_queue()
            stats = {'queued': 0, 'listed': 0, 'sold': 0, 'removed': 0}
            for vehicle in queue['vehicles'].values():
                status = vehicle.get('status', 'queued')
                if status in stats:
                    stats[status] += 1
            self.send_json(stats)
        
        # Get specific vehicle
        elif path.startswith('/vehicle/'):
            parts = path.split('/')
            if len(parts) >= 3:
                vin6 = parts[2].upper()
                
                if not _VIN6_PATTERN.match(vin6):
                    self.send_error(400, 'Invalid VIN6 format')
                    return
                
                # Handle photo request
                if len(parts) > 3 and parts[3] == 'photos':
                    folder = os.path.join(OUTPUT_DIR, vin6)
                    if not os.path.isdir(folder):
                        self.send_json({'photos': []})
                        return
                    
                    photos = []
                    for fname in sorted(os.listdir(folder)):
                        if fname.startswith('photo_') and fname.endswith('.jpg'):
                            photo_path = os.path.join(folder, fname)
                            with open(photo_path, 'rb') as f:
                                photo_data = base64.b64encode(f.read()).decode('utf-8')
                                photos.append({
                                    'filename': fname,
                                    'data': f'data:image/jpeg;base64,{photo_data}'
                                })
                    self.send_json({'photos': photos})
                
                else:
                    # Get vehicle info
                    folder = os.path.join(OUTPUT_DIR, vin6)
                    if not os.path.isdir(folder):
                        self.send_error(404, 'Vehicle not found')
                        return
                    
                    info_file = os.path.join(folder, 'info.json')
                    if os.path.exists(info_file):
                        with open(info_file, 'r') as f:
                            info = json.load(f)
                            info['vin6'] = vin6
                            self.send_json(info)
                    else:
                        self.send_json({'vin6': vin6, 'error': 'No info file'})
        
        # WhatsApp status
        elif path == '/whatsapp/status':
            try:
                response = requests.get(f'http://localhost:{NODE_PORT}/status', timeout=2)
                self.send_json(response.json())
            except:
                self.send_json({'connected': False, 'error': 'WhatsApp client not running'})
        
        else:
            self.send_error(404)
    
    def do_POST(self):
        global _last_activity, last_scrape_time
        _last_activity = time.time()
        
        parsed = urlparse(self.path)
        path = parsed.path
        
        # Read request body
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b'{}'
        
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            data = {}
        
        # Trigger scrape
        if path == '/scrape':
            start_date = None
            end_date = None
            
            if 'start' in data:
                start_date = datetime.fromisoformat(data['start'])
            if 'end' in data:
                end_date = datetime.fromisoformat(data['end'])
            
            result = trigger_whatsapp_scrape(start_date, end_date)
            self.send_json(result)
        
        # Queue management endpoints
        elif path.startswith('/queue/'):
            action = path.split('/')[-1]
            
            if path.startswith('/queue/mark-listed/'):
                vin6 = path.split('/')[-1].upper()
                queue_manager.mark_listed(vin6)
                self.send_json({'success': True})
            
            elif path.startswith('/queue/mark-sold/'):
                vin6 = path.split('/')[-1].upper()
                reason = data.get('reason', 'Manual')
                queue_manager.mark_sold(vin6, reason)
                self.send_json({'success': True})
            
            elif path.startswith('/queue/remove/'):
                vin6 = path.split('/')[-1].upper()
                queue_manager.remove_vehicle(vin6)
                self.send_json({'success': True})
            
            elif path == '/queue/rebuild':
                count = queue_manager.rebuild_queue_from_folders()
                self.send_json({'success': True, 'vehicles_found': count})
            
            elif path == '/queue/cross-check':
                # This would need inventory integration
                self.send_json({'success': True, 'message': 'Cross-check completed'})
        
        # WhatsApp webhook endpoint
        elif path == '/webhook/whatsapp':
            # Process incoming message from Node.js client
            current_vin6 = process_whatsapp_message(data)
            self.send_json({'success': True, 'vin6': current_vin6})
        
        else:
            self.send_error(404)
    
    def send_json(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass


def check_inactivity():
    """Auto-shutdown after inactivity timeout."""
    global _last_activity
    while True:
        time.sleep(60)  # Check every minute
        if time.time() - _last_activity > INACTIVITY_TIMEOUT:
            print(f"No activity for {INACTIVITY_TIMEOUT//60} minutes. Shutting down...")
            os._exit(0)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Start inactivity monitor
    monitor_thread = threading.Thread(target=check_inactivity, daemon=True)
    monitor_thread.start()
    
    # Check if WhatsApp client is running
    try:
        response = requests.get(f'http://localhost:{NODE_PORT}/status', timeout=2)
        if response.status_code == 200:
            print(f"✓ WhatsApp client detected on port {NODE_PORT}")
        else:
            print(f"⚠ WhatsApp client not responding properly on port {NODE_PORT}")
    except requests.exceptions.ConnectionError:
        print(f"⚠ WhatsApp client not running. Start it with: node whatsapp_client.js")
    
    # Start HTTP server
    server = HTTPServer(('localhost', PORT), RequestHandler)
    print(f"WhatsApp server running on http://localhost:{PORT}")
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Auto-shutdown after {INACTIVITY_TIMEOUT//60} minutes of inactivity")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()