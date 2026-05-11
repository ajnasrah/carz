#!/usr/bin/env python3
import pandas as pd
import json
from datetime import datetime
import subprocess

def copy_to_clipboard(text):
    """Copy text to clipboard using pbcopy on macOS"""
    try:
        process = subprocess.Popen('pbcopy', stdin=subprocess.PIPE, text=True)
        process.communicate(text)
        return True
    except:
        return False

print("UPLOADING POST-SALE DATA WITH VIN TRACKING")
print("="*60)

# Load both presale (with VINs) and postsale data
presale_file = '/Users/abdullahabunasrah/Downloads/edge_pipeline_presale_2026-04-29.csv'
postsale_file = '/Users/abdullahabunasrah/Downloads/edgepipeline_postsale_uaxmemphis-all_20260429.csv'

print("Loading data files...")
presale_df = pd.read_csv(presale_file)
postsale_df = pd.read_csv(postsale_file)

print(f"✅ Loaded {len(presale_df)} presale records (with VINs)")
print(f"✅ Loaded {len(postsale_df)} postsale records")

# Clean column names
presale_df.columns = presale_df.columns.str.strip()
postsale_df.columns = postsale_df.columns.str.strip()

# Match on Stock Number to get VINs
presale_df['Stock Number'] = presale_df['Stock Number'].astype(str)
postsale_df['Stock #'] = postsale_df['Stock #'].astype(str)

# Merge to add VINs to postsale data
merged_df = postsale_df.merge(
    presale_df[['Stock Number', 'Vin']],
    left_on='Stock #',
    right_on='Stock Number',
    how='left'
)

# Count matches
matched_vins = merged_df['Vin'].notna().sum()
print(f"\n📊 MATCHING RESULTS:")
print(f"• {matched_vins} vehicles matched with VINs")
print(f"• {len(merged_df) - matched_vins} vehicles without VIN match")

# Option 1: Copy all matched VINs to clipboard
print("\n1️⃣ COPYING VINS TO CLIPBOARD...")
print("-"*40)

sold_with_vins = merged_df[merged_df['Vin'].notna()]
if len(sold_with_vins) > 0:
    vin_list = sold_with_vins['Vin'].tolist()
    vin_text = '\n'.join(vin_list)
    
    if copy_to_clipboard(vin_text):
        print(f"✅ Copied {len(vin_list)} VINs to clipboard!")
    else:
        print("⚠️ Could not copy to clipboard automatically")
    
    # Save VINs to file
    vin_file = '/Users/abdullahabunasrah/Desktop/carz inc/postsale_vins.txt'
    with open(vin_file, 'w') as f:
        f.write(vin_text)
    print(f"✅ VINs saved to: {vin_file}")

# Option 2: Create enhanced sale tracking with VINs
print("\n2️⃣ CREATING ENHANCED SALE TRACKING...")
print("-"*40)

sale_tracking = merged_df.copy()
sale_tracking['upload_date'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
sale_tracking['auction'] = 'UAX Memphis'
sale_tracking['has_vin'] = sale_tracking['Vin'].notna()

# Reorder columns for clarity
column_order = ['Stock #', 'Vin', 'Year', 'Make', 'Model', 'Style', 'Color', 
                'Odometer', 'Grade', 'Sale Date', 'Lane', 'Price', 
                'has_vin', 'auction', 'upload_date']
sale_tracking = sale_tracking[column_order]

tracking_file = '/Users/abdullahabunasrah/Desktop/carz inc/sales_tracking_with_vin.csv'
sale_tracking.to_csv(tracking_file, index=False)
print(f"✅ Enhanced tracking file created: {tracking_file}")

# Option 3: Generate SQL with VIN column
print("\n3️⃣ GENERATING SQL WITH VIN SUPPORT...")
print("-"*40)

sql_file = '/Users/abdullahabunasrah/Desktop/carz inc/upload_sales_with_vin.sql'
with open(sql_file, 'w') as f:
    f.write("-- SQL commands to upload UAX post-sale data with VINs\n")
    f.write("-- Generated: " + datetime.now().strftime('%Y-%m-%d %H:%M:%S') + "\n\n")
    
    # Create enhanced table
    f.write("""CREATE TABLE IF NOT EXISTS auction_sales (
    id SERIAL PRIMARY KEY,
    stock_number VARCHAR(50),
    vin VARCHAR(17),
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
    has_vin BOOLEAN DEFAULT FALSE,
    uploaded_at TIMESTAMP DEFAULT NOW()
);\n\n""")
    
    # Insert statements with VINs
    for _, row in merged_df.iterrows():
        stock = row['Stock #']
        vin = row['Vin'] if pd.notna(row['Vin']) else 'NULL'
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
        has_vin = 'TRUE' if pd.notna(row['Vin']) else 'FALSE'
        
        if vin != 'NULL':
            vin = f"'{vin}'"
        
        f.write(f"INSERT INTO auction_sales (stock_number, vin, year, make, model, style, color, odometer, grade, sale_date, lane, price, auction_location, has_vin) VALUES ('{stock}', {vin}, {year}, '{make}', '{model}', '{style}', '{color}', {odometer}, {grade}, '{sale_date}', {lane}, {price}, 'UAX Memphis', {has_vin});\n")

print(f"✅ SQL file created: {sql_file}")

# Option 4: Create JSON with VINs for API
print("\n4️⃣ CREATING JSON WITH VIN DATA...")
print("-"*40)

json_data = {
    'auction': 'UAX Memphis',
    'sale_date': '2026-04-29',
    'total_vehicles': len(merged_df),
    'vehicles_with_vins': int(merged_df['Vin'].notna().sum()),
    'total_revenue': float(merged_df['Price'].sum()),
    'vehicles': []
}

for _, row in merged_df.iterrows():
    json_data['vehicles'].append({
        'stock_number': str(row['Stock #']),
        'vin': str(row['Vin']) if pd.notna(row['Vin']) else None,
        'year': int(row['Year']) if pd.notna(row['Year']) else None,
        'make': row['Make'],
        'model': row['Model'],
        'price': float(row['Price']) if pd.notna(row['Price']) else None,
        'lane': int(row['Lane']) if pd.notna(row['Lane']) else None,
        'grade': float(row['Grade']) if pd.notna(row['Grade']) else None,
        'has_vin': bool(pd.notna(row['Vin']))
    })

json_file = '/Users/abdullahabunasrah/Desktop/carz inc/postsale_upload_with_vin.json'
with open(json_file, 'w') as f:
    json.dump(json_data, f, indent=2)

print(f"✅ JSON file created: {json_file}")

# Summary report
print("\n" + "="*60)
print("📤 VIN-ENHANCED UPLOAD OPTIONS READY:")
print("\n📋 VIN Files:")
print(f"• Text file with VINs: postsale_vins.txt ({len(vin_list) if 'vin_list' in locals() else 0} VINs)")
print(f"• VINs copied to clipboard: {len(vin_list) if 'vin_list' in locals() else 0} vehicles")

print("\n📊 Data Files:")
print("• Enhanced CSV: sales_tracking_with_vin.csv")
print("• SQL commands: upload_sales_with_vin.sql")  
print("• JSON data: postsale_upload_with_vin.json")

print("\n✅ Quick Actions:")
print("• Paste VINs: Ctrl+V (already in clipboard)")
print("• Import to Supabase: Use the SQL file")
print("• API upload: Use the JSON file")
print("• Spreadsheet: Use the CSV file")
print("="*60)