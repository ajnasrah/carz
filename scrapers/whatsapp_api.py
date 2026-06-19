#!/usr/bin/env python3
"""
WhatsApp Business API Integration for Carz Inc
This uses the official WhatsApp Cloud API instead of web scraping

Requirements:
1. WhatsApp Business Account
2. Meta Business Account
3. WhatsApp Business API Access Token
4. Webhook URL for receiving messages

To set up:
1. Go to https://business.facebook.com/
2. Create a WhatsApp Business App
3. Get your Access Token and Phone Number ID
4. Set up webhook to receive messages
"""

import os
import json
import requests
import base64
from datetime import datetime
from pathlib import Path

# WhatsApp Cloud API Configuration
WHATSAPP_API_URL = "https://graph.facebook.com/v17.0"
WHATSAPP_TOKEN = os.getenv('WHATSAPP_TOKEN', '')  # Set this in environment
PHONE_NUMBER_ID = os.getenv('WHATSAPP_PHONE_ID', '')  # Your WhatsApp Business phone number ID

# Local storage
OUTPUT_DIR = os.path.expanduser("~/Library/Application Support/CarzInc/whatsapp_photos")
SA_PHOTOS_DIR = os.path.expanduser('~/Desktop/SA Photos')

class WhatsAppAPI:
    def __init__(self, token=None, phone_id=None):
        self.token = token or WHATSAPP_TOKEN
        self.phone_id = phone_id or PHONE_NUMBER_ID
        self.base_url = f"{WHATSAPP_API_URL}/{self.phone_id}"
        self.headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json'
        }
    
    def send_message(self, to_number, message):
        """Send a text message via WhatsApp Business API"""
        url = f"{self.base_url}/messages"
        data = {
            "messaging_product": "whatsapp",
            "to": to_number,
            "type": "text",
            "text": {"body": message}
        }
        
        response = requests.post(url, headers=self.headers, json=data)
        return response.json()
    
    def send_image(self, to_number, image_url, caption=None):
        """Send an image via WhatsApp Business API"""
        url = f"{self.base_url}/messages"
        data = {
            "messaging_product": "whatsapp",
            "to": to_number,
            "type": "image",
            "image": {
                "link": image_url,
                "caption": caption or ""
            }
        }
        
        response = requests.post(url, headers=self.headers, json=data)
        return response.json()
    
    def download_media(self, media_id):
        """Download media from WhatsApp"""
        # First get the download URL
        url = f"{WHATSAPP_API_URL}/{media_id}"
        response = requests.get(url, headers={'Authorization': f'Bearer {self.token}'})
        
        if response.status_code == 200:
            media_info = response.json()
            media_url = media_info.get('url')
            
            # Download the actual media
            if media_url:
                media_response = requests.get(media_url, headers={'Authorization': f'Bearer {self.token}'})
                if media_response.status_code == 200:
                    return media_response.content
        return None
    
    def process_webhook(self, webhook_data):
        """Process incoming webhook from WhatsApp"""
        messages = []
        
        # Extract messages from webhook
        for entry in webhook_data.get('entry', []):
            for change in entry.get('changes', []):
                value = change.get('value', {})
                for message in value.get('messages', []):
                    msg_data = {
                        'from': message.get('from'),
                        'timestamp': message.get('timestamp'),
                        'type': message.get('type'),
                        'id': message.get('id')
                    }
                    
                    # Handle different message types
                    if message['type'] == 'text':
                        msg_data['text'] = message.get('text', {}).get('body')
                    elif message['type'] == 'image':
                        msg_data['image'] = message.get('image', {})
                        msg_data['caption'] = msg_data['image'].get('caption', '')
                        
                        # Download and save image
                        media_id = msg_data['image'].get('id')
                        if media_id:
                            media_content = self.download_media(media_id)
                            if media_content:
                                # Parse VIN from caption or previous message
                                vin = self.extract_vin(msg_data['caption'])
                                if vin:
                                    self.save_photo(vin, media_content)
                    
                    messages.append(msg_data)
        
        return messages
    
    def extract_vin(self, text):
        """Extract VIN (last 6 digits) from text"""
        import re
        # Look for 5-7 character alphanumeric pattern
        patterns = [
            r'\b([A-Z0-9]{6})\b',
            r'\b([A-Z0-9]{5})\b',  # Will pad with 0
            r'\b([A-Z0-9]{7})\b',  # Take last 6
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text.upper())
            if match:
                vin = match.group(1)
                # Must contain at least one digit
                if re.search(r'\d', vin):
                    if len(vin) == 7:
                        vin = vin[-6:]
                    elif len(vin) == 5:
                        vin = '0' + vin
                    return vin
        return None
    
    def save_photo(self, vin, photo_data):
        """Save photo to local storage"""
        vehicle_dir = os.path.join(OUTPUT_DIR, vin)
        os.makedirs(vehicle_dir, exist_ok=True)
        
        # Find next photo number
        existing = [f for f in os.listdir(vehicle_dir) if f.startswith('photo_')]
        next_num = len(existing) + 1
        
        photo_path = os.path.join(vehicle_dir, f'photo_{next_num:03d}.jpg')
        with open(photo_path, 'wb') as f:
            f.write(photo_data)
        
        print(f"📷 Saved photo for {vin}: {photo_path}")
        return photo_path
    
    def get_vehicle_photos(self, vin):
        """Get all photos for a vehicle"""
        vehicle_dir = os.path.join(OUTPUT_DIR, vin)
        if not os.path.isdir(vehicle_dir):
            return []
        
        photos = []
        for fname in sorted(os.listdir(vehicle_dir)):
            if fname.startswith('photo_') and fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                photo_path = os.path.join(vehicle_dir, fname)
                with open(photo_path, 'rb') as f:
                    photos.append({
                        'filename': fname,
                        'data': base64.b64encode(f.read()).decode('utf-8')
                    })
        return photos
    
    def copy_to_sa_photos(self, vin):
        """Copy vehicle photos to SA Photos directory"""
        vehicle_dir = os.path.join(OUTPUT_DIR, vin)
        if not os.path.isdir(vehicle_dir):
            return False
        
        # Clear SA Photos
        if os.path.exists(SA_PHOTOS_DIR):
            import shutil
            shutil.rmtree(SA_PHOTOS_DIR)
        os.makedirs(SA_PHOTOS_DIR, exist_ok=True)
        
        # Copy photos
        photo_count = 0
        for fname in sorted(os.listdir(vehicle_dir)):
            if fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                src = os.path.join(vehicle_dir, fname)
                photo_count += 1
                ext = os.path.splitext(fname)[1]
                dst = os.path.join(SA_PHOTOS_DIR, f'{vin}_{photo_count:02d}{ext}')
                
                import shutil
                shutil.copy2(src, dst)
                print(f"📷 Copied to SA Photos: {dst}")
        
        print(f"✅ Copied {photo_count} photos to SA Photos for {vin}")
        return photo_count > 0


# Webhook handler for Flask/FastAPI
def handle_webhook(request_data):
    """
    Handle incoming WhatsApp webhook
    Use this with Flask/FastAPI to receive messages
    
    Example Flask:
    @app.route('/webhook', methods=['POST'])
    def webhook():
        data = request.get_json()
        messages = handle_webhook(data)
        return jsonify({'status': 'ok'})
    """
    api = WhatsAppAPI()
    return api.process_webhook(request_data)


# CLI for testing
if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python whatsapp_api.py send <number> <message>")
        print("  python whatsapp_api.py photos <vin>")
        print("  python whatsapp_api.py copy <vin>")
        sys.exit(1)
    
    api = WhatsAppAPI()
    
    if sys.argv[1] == 'send' and len(sys.argv) >= 4:
        result = api.send_message(sys.argv[2], ' '.join(sys.argv[3:]))
        print(json.dumps(result, indent=2))
    
    elif sys.argv[1] == 'photos' and len(sys.argv) >= 3:
        photos = api.get_vehicle_photos(sys.argv[2])
        print(f"Found {len(photos)} photos for {sys.argv[2]}")
    
    elif sys.argv[1] == 'copy' and len(sys.argv) >= 3:
        success = api.copy_to_sa_photos(sys.argv[2])
        if success:
            print("Photos copied to SA Photos")
        else:
            print("No photos found")
    
    else:
        print("Invalid command")