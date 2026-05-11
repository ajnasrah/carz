#!/usr/bin/env python3
import pandas as pd
import os
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

# Load the datasets
presale_file = '/Users/abdullahabunasrah/Downloads/edge_pipeline_presale_2026-04-29.csv'
postsale_file = '/Users/abdullahabunasrah/Downloads/edgepipeline_postsale_uaxmemphis-all_20260429.csv'

print("Loading UAX Memphis data...")
presale_df = pd.read_csv(presale_file)
postsale_df = pd.read_csv(postsale_file)

print(f"\nPresale inventory: {len(presale_df)} vehicles")
print(f"Postsale results: {len(postsale_df)} vehicles")

# Clean column names (remove spaces)
presale_df.columns = presale_df.columns.str.strip()
postsale_df.columns = postsale_df.columns.str.strip()

# Match on Stock Number
presale_df['Stock Number'] = presale_df['Stock Number'].astype(str)
postsale_df['Stock #'] = postsale_df['Stock #'].astype(str)

# Merge the datasets - this will bring VIN from presale to postsale
merged_df = presale_df.merge(
    postsale_df,
    left_on='Stock Number',
    right_on='Stock #',
    how='inner',  # Changed to inner join to only get matched vehicles
    suffixes=('_presale', '_postsale')
)

# Analyze results
sold_vehicles = merged_df[merged_df['Price'].notna()].copy()
unsold_vehicles = presale_df[~presale_df['Stock Number'].isin(postsale_df['Stock #'])]

print(f"\n=== SALES RESULTS ===")
print(f"Total presale inventory: {len(presale_df)}")
print(f"Vehicles sold: {len(sold_vehicles)} ({len(sold_vehicles)/len(presale_df)*100:.1f}%)")
print(f"Vehicles unsold: {len(unsold_vehicles)} ({len(unsold_vehicles)/len(presale_df)*100:.1f}%)")

# Extract VINs for sold vehicles
if len(sold_vehicles) > 0:
    # Get VINs from the presale data (now available in merged_df as 'Vin')
    sold_vehicles['VIN'] = merged_df['Vin']
    
    # Filter to only our vehicles (you can modify this filter based on your criteria)
    our_vehicles = sold_vehicles[sold_vehicles['VIN'].notna()].copy()
    
    print(f"\n=== VIN EXTRACTION ===")
    print(f"Total vehicles with VINs: {len(our_vehicles)}")
    
    # Copy VINs to clipboard
    vin_list = our_vehicles['VIN'].tolist()
    vin_text = '\n'.join(vin_list)
    
    if copy_to_clipboard(vin_text):
        print(f"✅ Copied {len(vin_list)} VINs to clipboard!")
    else:
        print("⚠️ Could not copy to clipboard. VINs saved to file instead.")
    
    # Also save VINs to a file
    vin_file = '/Users/abdullahabunasrah/Desktop/carz inc/uax_sold_vins.txt'
    with open(vin_file, 'w') as f:
        f.write(vin_text)
    print(f"✅ VINs saved to: {vin_file}")
    
    # Create detailed report with VINs
    print(f"\n=== SALE PRICE STATISTICS ===")
    print(f"Total revenue: ${sold_vehicles['Price'].sum():,.2f}")
    print(f"Average sale price: ${sold_vehicles['Price'].mean():,.2f}")
    print(f"Median sale price: ${sold_vehicles['Price'].median():,.2f}")
    print(f"Min sale price: ${sold_vehicles['Price'].min():,.2f}")
    print(f"Max sale price: ${sold_vehicles['Price'].max():,.2f}")
    
    # Save complete report with VINs
    report_columns = ['Stock Number', 'VIN', 'Year_presale', 'Make_presale', 'Model_presale', 
                     'Mileage', 'Grade_presale', 'Lane_postsale', 'Price']
    
    report_df = sold_vehicles[report_columns].copy()
    report_df.columns = ['Stock_Number', 'VIN', 'Year', 'Make', 'Model', 
                         'Mileage', 'Grade', 'Lane', 'Sale_Price']
    
    # Save detailed report
    report_file = '/Users/abdullahabunasrah/Desktop/carz inc/uax_sales_report_with_vin.csv'
    report_df.to_csv(report_file, index=False)
    print(f"\n✅ Detailed sales report with VINs saved to: {report_file}")
    
    # Create summary by make
    print(f"\n=== TOP 10 MAKES BY VOLUME ===")
    make_stats = sold_vehicles.groupby('Make_presale').agg({
        'Price': ['count', 'mean', 'sum'],
        'VIN': 'count'
    }).round(0)
    make_stats.columns = ['Units Sold', 'Avg Price', 'Total Revenue', 'VINs Available']
    make_stats = make_stats.sort_values('Units Sold', ascending=False).head(10)
    print(make_stats.to_string())

# Save complete merged data
output_file = '/Users/abdullahabunasrah/Desktop/carz inc/uax_complete_analysis.csv'
# Add VIN to postsale-style output for easy reference
if 'Vin' in merged_df.columns:
    final_df = merged_df[['Stock Number', 'Vin', 'Year_presale', 'Make_presale', 'Model_presale',
                          'Style_presale', 'Exterior Color', 'Mileage', 'Grade_presale', 
                          'Sale Date_postsale', 'Lane_postsale', 'Price']].copy()
    final_df.columns = ['Stock_Number', 'VIN', 'Year', 'Make', 'Model', 'Style', 
                        'Color', 'Mileage', 'Grade', 'Sale_Date', 'Lane', 'Price']
    final_df.to_csv(output_file, index=False)
    print(f"\n✅ Complete merged data with VINs saved to: {output_file}")

print("\n" + "="*60)
print("📋 VIN COPY SUMMARY:")
print(f"• {len(vin_list) if 'vin_list' in locals() else 0} VINs copied to clipboard")
print(f"• VINs saved to: uax_sold_vins.txt")
print(f"• Full report: uax_sales_report_with_vin.csv")
print("• Complete analysis: uax_complete_analysis.csv")
print("="*60)