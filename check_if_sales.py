#!/usr/bin/env python3
import pandas as pd
import json

# Load the data
print("Loading UAX auction data...")
presale_df = pd.read_csv('/Users/abdullahabunasrah/Downloads/edge_pipeline_presale_2026-04-29.csv')
postsale_df = pd.read_csv('/Users/abdullahabunasrah/Downloads/edgepipeline_postsale_uaxmemphis-all_20260429.csv')
unsold_df = pd.read_csv('/Users/abdullahabunasrah/Desktop/carz inc/uax_unsold_inventory.csv')

# Load queue data
with open('/Users/abdullahabunasrah/Library/Application Support/CarzInc/seller_group_output/queue.json', 'r') as f:
    queue_data = json.load(f)

print(f"\nTotal presale vehicles: {len(presale_df)}")
print(f"Total sold vehicles: {len(postsale_df)}")
print(f"Total unsold vehicles: {len(unsold_df)}")

# In auction terminology, "IF" sales typically mean:
# 1. Sale pending seller approval (if bid)
# 2. Sale pending inspection/arbitration
# 3. Sale at a certain price threshold

# Check for potential IF sales by looking at:
# 1. Vehicles that appear in post-sale but might be conditional
# 2. Low-price sales that might trigger IF status

# Identify suspiciously low sales that might be IF bids
low_price_threshold = 1500  # Common IF threshold
potential_if_sales = postsale_df[postsale_df['Price'] <= low_price_threshold].copy()

print(f"\n🔍 POTENTIAL IF/PHONE CALL VEHICLES")
print("=" * 60)
print(f"Found {len(potential_if_sales)} vehicles sold at or below ${low_price_threshold}")
print("(These low prices often indicate IF bids requiring approval)\n")

# Group by price ranges to identify patterns
price_ranges = [0, 500, 750, 1000, 1500, 2000]
labels = ['$0-500', '$501-750', '$751-1000', '$1001-1500', '$1501-2000']

potential_if_sales['Price_Range'] = pd.cut(potential_if_sales['Price'], bins=price_ranges + [float('inf')], labels=labels + ['$2000+'], right=True, include_lowest=True)

print("Distribution of low-price sales:")
print(potential_if_sales['Price_Range'].value_counts().sort_index())

print("\n📞 VEHICLES REQUIRING DECISION (IF/Phone Call):")
print("-" * 60)

# Show vehicles in the critical $500-1500 range (common IF range)
if_candidates = potential_if_sales[(potential_if_sales['Price'] >= 500) & (potential_if_sales['Price'] <= 1500)].sort_values('Price', ascending=False)

for _, vehicle in if_candidates.head(20).iterrows():
    print(f"\nStock #{vehicle['Stock #']}")
    print(f"  {vehicle['Year']:.0f} {vehicle['Make']} {vehicle['Model']}")
    print(f"  IF Bid: ${vehicle['Price']:.0f}")
    print(f"  Grade: {vehicle['Grade']}" if pd.notna(vehicle['Grade']) else "  Grade: N/A")
    print(f"  Lane: {vehicle['Lane']:.0f}")
    print(f"  Action: DECIDE - Accept ${vehicle['Price']:.0f} or reject and relist")

# Check for vehicles that might have been pulled (in presale but not in postsale or unsold)
presale_stocks = set(presale_df['Stock Number'].astype(str))
postsale_stocks = set(postsale_df['Stock #'].astype(str))
unsold_stocks = set(unsold_df['Stock Number'].astype(str))

# These are vehicles that were in presale but don't appear in postsale
# They might be on IF or were pulled
missing_vehicles = presale_stocks - postsale_stocks

# Double-check against unsold list
truly_missing = []
for stock in missing_vehicles:
    if stock not in unsold_stocks:
        vehicle = presale_df[presale_df['Stock Number'].astype(str) == stock].iloc[0]
        truly_missing.append(vehicle)

if truly_missing:
    print("\n⚠️ VEHICLES WITH UNKNOWN STATUS (Possible IF or Pulled):")
    print("-" * 60)
    for vehicle in truly_missing[:10]:
        print(f"Stock #{vehicle['Stock Number']}: {vehicle['Year']:.0f} {vehicle['Make']} {vehicle['Model']}")

# Summary
print("\n📊 SUMMARY:")
print("=" * 60)
print(f"• {len(if_candidates)} vehicles with IF bids ($500-$1500)")
print(f"• {len(potential_if_sales[potential_if_sales['Price'] < 500])} vehicles under $500 (likely reject)")
print(f"• {len(truly_missing)} vehicles with unknown status")

# Save IF candidates list
if_sales_file = '/Users/abdullahabunasrah/Desktop/carz inc/uax_if_sales_decisions.csv'
if_candidates.to_csv(if_sales_file, index=False)
print(f"\n✅ IF sales list saved to: {if_sales_file}")

# Create a quick decision sheet
print("\n🎯 QUICK DECISION GUIDE:")
print("-" * 40)
print("For IF bids, consider:")
print("• Grade 3.5+: Generally ACCEPT if bid > $1000")
print("• Grade 2.5-3.5: Case by case, check comps")  
print("• Grade < 2.5: Generally REJECT and relist")
print("• No grade: Check photos before deciding")

# Check queue.json for any related vehicles
print("\n📱 CHECKING YOUR QUEUE DATA...")
queue_vehicles = queue_data.get('vehicles', {})
vin_last6_in_queue = set(queue_vehicles.keys())

# Try to match with unsold inventory (using last 6 of VIN if available)
matches_found = []
for _, vehicle in unsold_df.iterrows():
    if 'Vin' in vehicle and pd.notna(vehicle.get('Vin')):
        last6 = str(vehicle['Vin'])[-6:]
        if last6 in vin_last6_in_queue:
            queue_info = queue_vehicles[last6]
            if queue_info['status'] not in ['sold', 'removed']:
                matches_found.append({
                    'Stock': vehicle['Stock Number'],
                    'Vehicle': f"{vehicle['Year_presale']} {vehicle['Make_presale']} {vehicle['Model_presale']}",
                    'Queue_Status': queue_info['status'],
                    'SA_Status': queue_info.get('sa_status', 'N/A')
                })

if matches_found:
    print("\n🔗 VEHICLES FOUND IN YOUR QUEUE:")
    for match in matches_found[:10]:
        print(f"Stock #{match['Stock']}: {match['Vehicle']} - Status: {match['Queue_Status']}")

print("\n" + "=" * 60)
print("✅ Analysis complete. Review uax_if_sales_decisions.csv for action items.")