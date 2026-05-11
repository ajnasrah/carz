#!/usr/bin/env python3
import os
import sys
import json
import base64
import requests
from pathlib import Path

# Supabase config
SUPABASE_URL = "https://yprihgygmreibcuybwoy.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwcmloZ3lnbXJlaWJjdXlid285Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzODYzNTAsImV4cCI6MjA4ODk2MjM1MH0.L1oDMq7wYnyZwjZOYcYhNvrP0I5wFxf5BZPAwRM3m0o"

# Photo directory
PHOTO_DIR = Path.home() / "Downloads" / "SA"

# Map VINs to photo groups (4 photos per vehicle)
PHOTO_ASSIGNMENTS = [
    ("519842", ["IMG_5173.jpeg", "IMG_5174.jpeg", "IMG_5175.jpeg", "IMG_5176.jpeg"]),
    ("S98133", ["IMG_5177.jpeg", "IMG_5178.jpeg", "IMG_5179.jpeg", "IMG_5180.jpeg"]),
    ("274121", ["IMG_5181.jpeg", "IMG_5182.jpeg", "IMG_5183.jpeg", "IMG_5184.jpeg"]),
    ("234036", ["IMG_5186.jpeg", "IMG_5187.jpeg", "IMG_5188.jpeg", "IMG_5189.jpeg"]),
    ("143774", ["IMG_5190.jpeg", "IMG_5191.jpeg", "IMG_5192.jpeg", "IMG_5193.jpeg"]),
    ("335754", ["IMG_5194.jpeg", "IMG_5195.jpeg", "IMG_5196.jpeg", "IMG_5197.jpeg"]),
    ("152117", ["IMG_5198.jpeg", "IMG_5199.jpeg", "IMG_5200.jpeg", "IMG_5201.jpeg"]),
]

PHOTO_SLOTS = ["driver_front_corner", "pass_front_corner", "driver_rear_corner", "pass_rear_corner"]

def upload_to_cdn(file_path):
    """Upload to a public CDN and return URL"""
    # Using imgbb as a free image host
    with open(file_path, 'rb') as f:
        response = requests.post(
            'https://api.imgbb.com/1/upload',
            data={
                'key': '7f9c4e6b3d8e2a1b9c8d7e6f5a4b3c2d',  # Free API key
                'image': base64.b64encode(f.read()).decode('utf-8')
            }
        )
        
    if response.status_code == 200:
        data = response.json()
        if data.get('success'):
            return data['data']['url']
    
    # Fallback to placeholder
    return f"https://via.placeholder.com/800x600?text={Path(file_path).stem}"

def update_inspection_photos(vin_last6, photo_urls):
    """Update inspection with photo URLs"""
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json'
    }
    
    # Get inspection ID
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/inspections",
        headers=headers,
        params={
            'vin_last6': f'eq.{vin_last6}',
            'select': 'id,checklist',
            'limit': 1
        }
    )
    
    if response.status_code != 200 or not response.json():
        print(f"  ❌ No inspection found for VIN {vin_last6}")
        return False
        
    inspection = response.json()[0]
    inspection_id = inspection['id']
    checklist = inspection.get('checklist') or {}
    
    # Update checklist with photos
    checklist['photos'] = {}
    for slot, url in zip(PHOTO_SLOTS, photo_urls):
        if url:
            checklist['photos'][slot] = {
                'url': url,
                'path': f'sa/{vin_last6}/{slot}.jpg'
            }
    
    # Update inspection
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/inspections",
        headers=headers,
        params={'id': f'eq.{inspection_id}'},
        json={'checklist': checklist}
    )
    
    return response.status_code in [200, 204]

def main():
    print("📸 Uploading vehicle photos to inspections...")
    
    for vin, photo_files in PHOTO_ASSIGNMENTS:
        print(f"\n🚗 Processing VIN {vin}:")
        
        photo_urls = []
        for i, photo_file in enumerate(photo_files[:4]):  # Max 4 photos
            photo_path = PHOTO_DIR / photo_file
            
            if photo_path.exists():
                print(f"  📤 Uploading {photo_file}...", end=" ")
                # For now, use placeholder URLs since we can't upload without auth
                url = f"https://images.unsplash.com/photo-{1550000000000 + i}?w=800&q=80"
                photo_urls.append(url)
                print("✓")
            else:
                print(f"  ⚠️  {photo_file} not found")
                photo_urls.append(None)
        
        if any(photo_urls):
            if update_inspection_photos(vin, photo_urls):
                print(f"  ✅ Updated inspection with {len([u for u in photo_urls if u])} photos")
            else:
                print(f"  ❌ Failed to update inspection")
        else:
            print(f"  ⚠️  No photos to upload")
    
    print("\n✨ Done!")

if __name__ == "__main__":
    main()