#!/usr/bin/env python3
import pandas as pd
import json
from datetime import datetime

print("UPLOADING POST-SALE DATA TO YOUR SYSTEM")
print("="*60)

# Load the post-sale data
postsale_file = '/Users/abdullahabunasrah/Downloads/edgepipeline_postsale_uaxmemphis-all_20260429.csv'
postsale_df = pd.read_csv(postsale_file)

print(f"Loaded {len(postsale_df)} post-sale records from UAX Memphis")

# Option 1: Update your queue.json with sale results
print("\n1️⃣ UPDATING QUEUE.JSON WITH SALES...")
print("-"*40)

queue_file = '/Users/abdullahabunasrah/Library/Application Support/CarzInc/seller_group_output/queue.json'
with open(queue_file, 'r') as f:
    queue_data = json.load(f)

updated_count = 0
# Match sold vehicles by VIN last 6 if available
# This is a template - would need actual VIN matching logic

print(f"Would update {updated_count} vehicles in queue.json")

# Option 2: Create a sale tracking CSV
print("\n2️⃣ CREATING SALE TRACKING FILE...")
print("-"*40)

# Prepare data for tracking
sale_tracking = postsale_df.copy()
sale_tracking['upload_date'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
sale_tracking['auction'] = 'UAX Memphis'

# Save to tracking file
tracking_file = '/Users/abdullahabunasrah/Desktop/carz inc/sales_tracking.csv'
try:
    existing = pd.read_csv(tracking_file)
    combined = pd.concat([existing, sale_tracking], ignore_index=True)
    combined.to_csv(tracking_file, index=False)
    print(f"✅ Appended {len(sale_tracking)} records to existing tracking file")
except:
    sale_tracking.to_csv(tracking_file, index=False)
    print(f"✅ Created new tracking file with {len(sale_tracking)} records")

# Option 3: Create SQL commands for database upload
print("\n3️⃣ GENERATING SQL FOR DATABASE UPLOAD...")
print("-"*40)

sql_file = '/Users/abdullahabunasrah/Desktop/carz inc/upload_sales.sql'
with open(sql_file, 'w') as f:
    f.write("-- SQL commands to upload UAX post-sale data\n")
    f.write("-- Generated: " + datetime.now().strftime('%Y-%m-%d %H:%M:%S') + "\n\n")
    
    # Create table if not exists
    f.write("""CREATE TABLE IF NOT EXISTS auction_sales (
    id SERIAL PRIMARY KEY,
    stock_number VARCHAR(50),
    year INTEGER,
    make VARCHAR(100),
    model VARCHAR(100),
    style VARCHAR(200),
    color VARCHAR(50),
    odometer INTEGER,
    grade DECIMAL(2,1),
    sale_date DATE,
    lane INTEGER,
    price DECIMAL(10,2),
    auction_location VARCHAR(100),
    uploaded_at TIMESTAMP DEFAULT NOW()
);\n\n""")
    
    # Insert statements
    for _, row in postsale_df.iterrows():
        stock = row['Stock #']
        year = int(row['Year']) if pd.notna(row['Year']) else 'NULL'
        make = row['Make'].replace("'", "''") if pd.notna(row['Make']) else ''
        model = row['Model'].replace("'", "''") if pd.notna(row['Model']) else ''
        style = row['Style'].replace("'", "''") if pd.notna(row['Style']) else ''
        color = row['Color'] if pd.notna(row['Color']) else ''
        odometer = int(row['Odometer']) if pd.notna(row['Odometer']) else 'NULL'
        grade = row['Grade'] if pd.notna(row['Grade']) else 'NULL'
        sale_date = row['Sale Date']
        lane = int(row['Lane']) if pd.notna(row['Lane']) else 'NULL'
        price = row['Price'] if pd.notna(row['Price']) else 'NULL'
        
        f.write(f"INSERT INTO auction_sales (stock_number, year, make, model, style, color, odometer, grade, sale_date, lane, price, auction_location) VALUES ('{stock}', {year}, '{make}', '{model}', '{style}', '{color}', {odometer}, {grade}, '{sale_date}', {lane}, {price}, 'UAX Memphis');\n")

print(f"✅ SQL file created: {sql_file}")

# Option 4: Create JSON format for API upload
print("\n4️⃣ CREATING JSON FOR API UPLOAD...")
print("-"*40)

json_data = {
    'auction': 'UAX Memphis',
    'sale_date': '2026-04-29',
    'total_vehicles': len(postsale_df),
    'total_revenue': float(postsale_df['Price'].sum()),
    'vehicles': []
}

for _, row in postsale_df.iterrows():
    json_data['vehicles'].append({
        'stock_number': str(row['Stock #']),
        'year': int(row['Year']) if pd.notna(row['Year']) else None,
        'make': row['Make'],
        'model': row['Model'],
        'price': float(row['Price']) if pd.notna(row['Price']) else None,
        'lane': int(row['Lane']) if pd.notna(row['Lane']) else None,
        'grade': float(row['Grade']) if pd.notna(row['Grade']) else None
    })

json_file = '/Users/abdullahabunasrah/Desktop/carz inc/postsale_upload.json'
with open(json_file, 'w') as f:
    json.dump(json_data, f, indent=2)

print(f"✅ JSON file created: {json_file}")

print("\n" + "="*60)
print("📤 UPLOAD OPTIONS READY:")
print("\n1. CSV tracking file: sales_tracking.csv")
print("2. SQL commands: upload_sales.sql")  
print("3. JSON data: postsale_upload.json")
print("\nUse these files to upload to your preferred system:")
print("• Supabase: Use the SQL file")
print("• API: Use the JSON file")
print("• Excel/Sheets: Use the CSV file")
print("="*60)