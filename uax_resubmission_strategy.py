#!/usr/bin/env python3
import pandas as pd
import numpy as np

# Load the data
merged_df = pd.read_csv('/Users/abdullahabunasrah/Desktop/carz inc/uax_merged_results.csv')
unsold_df = pd.read_csv('/Users/abdullahabunasrah/Desktop/carz inc/uax_unsold_inventory.csv')

# Get sold vehicles for pricing analysis
sold_df = merged_df[merged_df['Price'].notna()].copy()

# Calculate average prices by key characteristics
def get_comp_price(row, sold_data):
    """Find comparable sales for pricing guidance"""
    # Try exact make/model/year match first
    exact_match = sold_data[
        (sold_data['Make_presale'] == row['Make_presale']) &
        (sold_data['Model_presale'] == row['Model_presale']) &
        (abs(sold_data['Year_presale'] - row['Year_presale']) <= 1)
    ]
    
    if len(exact_match) > 0:
        return exact_match['Price'].median(), len(exact_match), 'Exact Match'
    
    # Try make/year match
    make_match = sold_data[
        (sold_data['Make_presale'] == row['Make_presale']) &
        (abs(sold_data['Year_presale'] - row['Year_presale']) <= 2)
    ]
    
    if len(make_match) > 0:
        return make_match['Price'].median(), len(make_match), 'Make/Year Match'
    
    # Try grade match if available
    if pd.notna(row.get('Grade_presale')):
        grade_match = sold_data[
            (abs(sold_data['Grade_presale'] - row['Grade_presale']) <= 0.3)
        ]
        if len(grade_match) > 0:
            return grade_match['Price'].median(), len(grade_match), 'Grade Match'
    
    # Fall back to year match
    year_match = sold_data[
        (abs(sold_data['Year_presale'] - row['Year_presale']) <= 1)
    ]
    if len(year_match) > 0:
        return year_match['Price'].median(), len(year_match), 'Year Match'
    
    return sold_data['Price'].median(), len(sold_data), 'Overall Median'

# Analyze unsold inventory
print("="*60)
print("ANALYZING UNSOLD INVENTORY FOR RESUBMISSION")
print("="*60)

# Add pricing estimates
unsold_df['Est_Price'] = 0
unsold_df['Comp_Count'] = 0
unsold_df['Match_Type'] = ''

for idx, row in unsold_df.iterrows():
    price, count, match_type = get_comp_price(row, sold_df)
    unsold_df.loc[idx, 'Est_Price'] = price
    unsold_df.loc[idx, 'Comp_Count'] = count
    unsold_df.loc[idx, 'Match_Type'] = match_type

# Categorize vehicles
unsold_df['Priority'] = 'Low'

# High priority: Good grade or high estimated value
high_value = unsold_df['Est_Price'] >= 7500
good_grade = unsold_df['Grade_presale'] >= 3.5
newer_year = unsold_df['Year_presale'] >= 2018

unsold_df.loc[high_value | (good_grade & newer_year), 'Priority'] = 'High'
unsold_df.loc[(unsold_df['Est_Price'] >= 5000) & (unsold_df['Est_Price'] < 7500), 'Priority'] = 'Medium'

# Lane recommendations based on sold data
lane_performance = sold_df.groupby('Lane_postsale').agg({
    'Price': ['mean', 'median', 'count'],
    'Grade_presale': 'mean'
}).round(0)

print("\n📊 LANE PERFORMANCE ANALYSIS")
print("-" * 40)
for lane in lane_performance.index:
    avg_price = lane_performance.loc[lane, ('Price', 'mean')]
    count = lane_performance.loc[lane, ('Price', 'count')]
    avg_grade = lane_performance.loc[lane, ('Grade_presale', 'mean')]
    print(f"Lane {int(lane)}: ${avg_price:,.0f} avg | {int(count)} sold | {avg_grade:.1f} avg grade")

# Assign recommended lanes
def recommend_lane(row):
    if row['Est_Price'] >= 15000:
        return 10  # Premium lane
    elif row['Est_Price'] >= 8000:
        return 2   # High-value lane
    elif row['Est_Price'] >= 5000:
        return 3   # Mid-value lane
    elif row['Est_Price'] >= 3000:
        return 4   # Standard lane
    else:
        return 1   # Value lane

unsold_df['Recommended_Lane'] = unsold_df.apply(recommend_lane, axis=1)

# IMMEDIATE ACTION LIST
print("\n🎯 IMMEDIATE RESUBMISSION TARGETS (HIGH PRIORITY)")
print("="*60)

high_priority = unsold_df[unsold_df['Priority'] == 'High'].sort_values('Est_Price', ascending=False)

for idx, vehicle in high_priority.head(20).iterrows():
    print(f"\nStock #{vehicle['Stock Number']}")
    print(f"  {vehicle['Year_presale']:.0f} {vehicle['Make_presale']} {vehicle['Model_presale']}")
    print(f"  Current Lane: {vehicle['Lane_presale']:.0f} → Recommend Lane: {vehicle['Recommended_Lane']}")
    print(f"  Grade: {vehicle['Grade_presale']:.1f}" if pd.notna(vehicle['Grade_presale']) else "  Grade: Not Available")
    print(f"  Est. Value: ${vehicle['Est_Price']:,.0f} (based on {int(vehicle['Comp_Count'])} {vehicle['Match_Type']})")
    print(f"  Action: RESUBMIT with ${vehicle['Est_Price']*0.85:,.0f} reserve")

# Summary statistics
print("\n📈 RESUBMISSION SUMMARY")
print("="*60)

priority_summary = unsold_df.groupby('Priority').agg({
    'Stock Number': 'count',
    'Est_Price': 'sum'
})
priority_summary.columns = ['Count', 'Total Est Value']

print(f"High Priority:   {priority_summary.loc['High', 'Count']:3.0f} vehicles | ${priority_summary.loc['High', 'Total Est Value']:,.0f} potential")
print(f"Medium Priority: {priority_summary.loc['Medium', 'Count']:3.0f} vehicles | ${priority_summary.loc['Medium', 'Total Est Value']:,.0f} potential")
print(f"Low Priority:    {priority_summary.loc['Low', 'Count']:3.0f} vehicles | ${priority_summary.loc['Low', 'Total Est Value']:,.0f} potential")
print(f"\nTOTAL POTENTIAL RECOVERY: ${unsold_df['Est_Price'].sum():,.0f}")

# Specific make/model opportunities
print("\n🚗 TOP UNSOLD BY MAKE")
print("-"*40)
make_analysis = unsold_df.groupby('Make_presale').agg({
    'Stock Number': 'count',
    'Est_Price': ['mean', 'sum']
}).round(0)
make_analysis.columns = ['Units', 'Avg Value', 'Total Value']
make_analysis = make_analysis.sort_values('Total Value', ascending=False).head(10)

for make in make_analysis.index:
    units = make_analysis.loc[make, 'Units']
    avg_val = make_analysis.loc[make, 'Avg Value']
    total_val = make_analysis.loc[make, 'Total Value']
    print(f"{make:12} | {units:2.0f} units | ${avg_val:,>7.0f} avg | ${total_val:,>9.0f} total")

# Grade optimization
print("\n🏆 GRADE-BASED OPPORTUNITIES")
print("-"*40)
graded_unsold = unsold_df[unsold_df['Grade_presale'].notna()].copy()
grade_brackets = pd.cut(graded_unsold['Grade_presale'], 
                        bins=[0, 2.0, 3.0, 3.5, 4.0, 5.0],
                        labels=['Poor (0-2)', 'Fair (2-3)', 'Good (3-3.5)', 'V.Good (3.5-4)', 'Excellent (4+)'])

for bracket in ['Excellent (4+)', 'V.Good (3.5-4)', 'Good (3-3.5)']:
    bracket_vehicles = graded_unsold[grade_brackets == bracket]
    if len(bracket_vehicles) > 0:
        print(f"\n{bracket}: {len(bracket_vehicles)} vehicles")
        for _, v in bracket_vehicles.head(3).iterrows():
            print(f"  • Stock #{v['Stock Number']}: {v['Year_presale']:.0f} {v['Make_presale']} {v['Model_presale']} | Est: ${v['Est_Price']:,.0f}")

# Save detailed resubmission list
resubmission_file = '/Users/abdullahabunasrah/Desktop/carz inc/uax_resubmission_list.csv'
unsold_df.sort_values(['Priority', 'Est_Price'], ascending=[True, False]).to_csv(resubmission_file, index=False)
print(f"\n✅ Detailed resubmission list saved to: {resubmission_file}")

# Create quick action CSV for high priority only
high_priority_file = '/Users/abdullahabunasrah/Desktop/carz inc/uax_high_priority_resubmit.csv'
high_priority[['Stock Number', 'Year_presale', 'Make_presale', 'Model_presale', 
               'Grade_presale', 'Lane_presale', 'Recommended_Lane', 'Est_Price']].to_csv(high_priority_file, index=False)
print(f"✅ High priority list saved to: {high_priority_file}")

print("\n" + "="*60)
print("🎬 NEXT STEPS:")
print("1. Review high priority vehicles in uax_high_priority_resubmit.csv")
print("2. Move vehicles to recommended lanes before next auction")
print("3. Set reserves at 85% of estimated values")
print("4. Consider bundling low-value vehicles in Lane 1")
print("="*60)