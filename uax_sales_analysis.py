#!/usr/bin/env python3
import pandas as pd
import os
from datetime import datetime

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

# Merge the datasets
merged_df = presale_df.merge(
    postsale_df,
    left_on='Stock Number',
    right_on='Stock #',
    how='left',
    suffixes=('_presale', '_postsale')
)

# Analyze results
sold_vehicles = merged_df[merged_df['Price'].notna()]
unsold_vehicles = merged_df[merged_df['Price'].isna()]

print(f"\n=== SALES RESULTS ===")
print(f"Total inventory: {len(merged_df)}")
print(f"Vehicles sold: {len(sold_vehicles)} ({len(sold_vehicles)/len(merged_df)*100:.1f}%)")
print(f"Vehicles unsold: {len(unsold_vehicles)} ({len(unsold_vehicles)/len(merged_df)*100:.1f}%)")

if len(sold_vehicles) > 0:
    print(f"\n=== SALE PRICE STATISTICS ===")
    print(f"Total revenue: ${sold_vehicles['Price'].sum():,.2f}")
    print(f"Average sale price: ${sold_vehicles['Price'].mean():,.2f}")
    print(f"Median sale price: ${sold_vehicles['Price'].median():,.2f}")
    print(f"Min sale price: ${sold_vehicles['Price'].min():,.2f}")
    print(f"Max sale price: ${sold_vehicles['Price'].max():,.2f}")
    
    # Analyze by make
    print(f"\n=== TOP 10 MAKES BY VOLUME ===")
    make_stats = sold_vehicles.groupby('Make_presale').agg({
        'Price': ['count', 'mean', 'sum']
    }).round(0)
    make_stats.columns = ['Units Sold', 'Avg Price', 'Total Revenue']
    make_stats = make_stats.sort_values('Units Sold', ascending=False).head(10)
    print(make_stats.to_string())
    
    # Analyze by model year
    print(f"\n=== SALES BY YEAR ===")
    year_stats = sold_vehicles.groupby('Year_presale').agg({
        'Price': ['count', 'mean']
    }).round(0)
    year_stats.columns = ['Units Sold', 'Avg Price']
    year_stats = year_stats.sort_values('Year_presale', ascending=False).head(10)
    print(year_stats.to_string())
    
    # Analyze by lane
    print(f"\n=== SALES BY LANE ===")
    lane_stats = sold_vehicles.groupby('Lane_postsale').agg({
        'Price': ['count', 'mean', 'sum']
    }).round(0)
    lane_stats.columns = ['Units Sold', 'Avg Price', 'Total Revenue']
    lane_stats = lane_stats.sort_values('Total Revenue', ascending=False)
    print(lane_stats.to_string())
    
    # Grade analysis (if available)
    if 'Grade_presale' in sold_vehicles.columns:
        graded_sales = sold_vehicles[sold_vehicles['Grade_presale'].notna()]
        if len(graded_sales) > 0:
            print(f"\n=== SALES BY GRADE ===")
            grade_stats = graded_sales.groupby('Grade_presale').agg({
                'Price': ['count', 'mean']
            }).round(0)
            grade_stats.columns = ['Units Sold', 'Avg Price']
            grade_stats = grade_stats.sort_values('Grade_presale', ascending=False)
            print(grade_stats.to_string())

# Save merged data
output_file = '/Users/abdullahabunasrah/Desktop/carz inc/uax_merged_results.csv'
merged_df.to_csv(output_file, index=False)
print(f"\n✅ Merged data saved to: {output_file}")

# Create a summary report of unsold inventory
if len(unsold_vehicles) > 0:
    print(f"\n=== UNSOLD INVENTORY SUMMARY ===")
    print(f"Total unsold: {len(unsold_vehicles)} vehicles")
    
    unsold_summary = unsold_vehicles.groupby('Make_presale').size().sort_values(ascending=False).head(10)
    print(f"\nTop 10 unsold makes:")
    for make, count in unsold_summary.items():
        print(f"  {make}: {count} units")
    
    # Save unsold inventory list
    unsold_file = '/Users/abdullahabunasrah/Desktop/carz inc/uax_unsold_inventory.csv'
    unsold_vehicles[['Stock Number', 'Year_presale', 'Make_presale', 'Model_presale', 
                     'Mileage', 'Grade_presale', 'Run Number_presale', 'Lane_presale']].to_csv(unsold_file, index=False)
    print(f"\n✅ Unsold inventory saved to: {unsold_file}")