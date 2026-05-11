#!/usr/bin/env python3
import pandas as pd

# Load post-sale data
postsale_df = pd.read_csv('/Users/abdullahabunasrah/Downloads/edgepipeline_postsale_uaxmemphis-all_20260429.csv')
print(f"Post-sale has {len(postsale_df)} vehicles")

# Show sample stock numbers from post-sale
print("\nSample stock numbers from UAX post-sale:")
sample_stocks = postsale_df['Stock #'].head(20).tolist()
for stock in sample_stocks[:10]:
    print(f"  {stock}")

# Try to load your inventory data to check format
print("\n" + "="*50)
print("Checking for inventory data sources...")

# Check if we have a recent inventory export
import os
import glob

# Look for inventory files
inv_files = glob.glob('/Users/abdullahabunasrah/Desktop/carz inc/*.xlsx') + \
            glob.glob('/Users/abdullahabunasrah/Desktop/carz inc/*.csv') + \
            glob.glob('/Users/abdullahabunasrah/Downloads/*.xlsx') + \
            glob.glob('/Users/abdullahabunasrah/Downloads/*.csv')

print(f"\nFound {len(inv_files)} potential inventory files")

# Look for files with 'inventory' or 'stock' in name
for f in inv_files:
    fname = os.path.basename(f).lower()
    if 'inventory' in fname or 'stock' in fname or 'frazer' in fname:
        print(f"\nPotential inventory file: {f}")
        try:
            if f.endswith('.csv'):
                df = pd.read_csv(f)
            else:
                df = pd.read_excel(f)
            
            # Look for stock number column
            stock_cols = [c for c in df.columns if 'stock' in c.lower()]
            if stock_cols:
                print(f"  Has columns: {stock_cols}")
                print(f"  Total rows: {len(df)}")
                
                # Check if any match with UAX
                stock_col = stock_cols[0]
                df_stocks = set(df[stock_col].astype(str).str.strip())
                uax_stocks = set(postsale_df['Stock #'].astype(str).str.strip())
                matches = df_stocks.intersection(uax_stocks)
                
                if matches:
                    print(f"  ✅ MATCHES FOUND: {len(matches)} vehicles match UAX post-sale!")
                    print(f"  Sample matches: {list(matches)[:5]}")
                else:
                    print(f"  ❌ No matches with UAX data")
        except Exception as e:
            print(f"  Could not read: {e}")

print("\n" + "="*50)
print("SOLUTION:")
print("1. First sync your inventory in the extension (click 'Sync Inventory')")
print("2. OR upload your Frazer inventory .xlsx file in the extension")
print("3. THEN upload the UAX post-sale CSV")
print("\nThe extension needs your inventory loaded to know which vehicles are yours!")