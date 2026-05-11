#!/usr/bin/env python3
import pandas as pd
import json

# Load your queue data (YOUR cars)
print("Loading YOUR inventory from queue...")
with open('/Users/abdullahabunasrah/Library/Application Support/CarzInc/seller_group_output/queue.json', 'r') as f:
    queue_data = json.load(f)

your_vehicles = queue_data.get('vehicles', {})

# Filter for active vehicles (not sold or removed)
active_vehicles = {
    vin6: data for vin6, data in your_vehicles.items() 
    if data['status'] not in ['sold', 'removed']
}

print(f"\nYou have {len(active_vehicles)} active vehicles in your system")

# Load UAX auction data
presale_df = pd.read_csv('/Users/abdullahabunasrah/Downloads/edge_pipeline_presale_2026-04-29.csv')
postsale_df = pd.read_csv('/Users/abdullahabunasrah/Downloads/edgepipeline_postsale_uaxmemphis-all_20260429.csv')

# Try to match YOUR vehicles with UAX auction results
print("\n🚗 YOUR VEHICLES AT UAX AUCTION:")
print("="*60)

matches_found = []
if_sales_found = []

for vin6, vehicle_data in active_vehicles.items():
    # Look for matches in presale data by VIN last 6
    if 'Vin' in presale_df.columns:
        presale_match = presale_df[presale_df['Vin'].astype(str).str.endswith(vin6)]
        
        if not presale_match.empty:
            stock_num = str(presale_match.iloc[0]['Stock Number'])
            
            # Check if it sold
            sold_match = postsale_df[postsale_df['Stock #'].astype(str) == stock_num]
            
            if not sold_match.empty:
                sale_price = sold_match.iloc[0]['Price']
                
                # Check if it's an IF sale (low price)
                if sale_price <= 1500:
                    if_sales_found.append({
                        'vin6': vin6,
                        'stock': stock_num,
                        'year': sold_match.iloc[0]['Year'],
                        'make': sold_match.iloc[0]['Make'],
                        'model': sold_match.iloc[0]['Model'],
                        'price': sale_price,
                        'status': vehicle_data['status'],
                        'notes': vehicle_data.get('notes', '')
                    })

if if_sales_found:
    print("\n⚠️ YOUR VEHICLES WITH IF BIDS (Need Your Decision):")
    print("-"*60)
    for vehicle in if_sales_found:
        print(f"\nVIN ending: {vehicle['vin6']}")
        print(f"Stock #: {vehicle['stock']}")
        print(f"Vehicle: {vehicle['year']} {vehicle['make']} {vehicle['model']}")
        print(f"IF Bid: ${vehicle['price']:,.0f}")
        print(f"Your Status: {vehicle['status']}")
        if vehicle['notes']:
            print(f"Your Notes: {vehicle['notes']}")
        print(f"ACTION REQUIRED: Accept ${vehicle['price']:,.0f} or reject and relist")
else:
    print("\n✅ None of YOUR vehicles have IF bids requiring decisions")

# Check for YOUR vehicles that didn't sell at all
print("\n📋 YOUR VEHICLES - CURRENT STATUS:")
print("-"*60)

for vin6, data in list(active_vehicles.items())[:20]:  # Show first 20
    status = data['status']
    sa_status = data.get('sa_status', 'Not at auction')
    
    print(f"\nVIN: ...{vin6}")
    print(f"  Status: {status}")
    print(f"  SA Status: {sa_status}")
    if data.get('notes'):
        print(f"  Notes: {data['notes'][:50]}...")

print(f"\n📊 SUMMARY OF YOUR INVENTORY:")
print("="*60)
status_counts = {}
for data in your_vehicles.values():
    status = data['status']
    status_counts[status] = status_counts.get(status, 0) + 1

for status, count in sorted(status_counts.items()):
    print(f"{status}: {count} vehicles")

print("\n✅ This shows only YOUR vehicles from your queue system.")