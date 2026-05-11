#!/usr/bin/env python3
import pandas as pd

print("Debugging Stock Number Matching\n" + "="*50)

# Load presale
presale = pd.read_csv('/Users/abdullahabunasrah/Downloads/edge_pipeline_presale_2026-04-29.csv')
print(f"\nPresale has {len(presale)} vehicles")
print("Column names:", list(presale.columns))

# Check stock number column
if 'Stock Number' in presale.columns:
    stocks = presale['Stock Number'].head(20)
    print("\nSample Stock Numbers from presale:")
    for s in stocks[:10]:
        print(f"  '{s}'")
else:
    print("\nNo 'Stock Number' column found!")
    
# Load post-sale  
postsale = pd.read_csv('/Users/abdullahabunasrah/Downloads/edgepipeline_postsale_uaxmemphis-all_20260429.csv')
print(f"\nPost-sale has {len(postsale)} vehicles")

if 'Stock #' in postsale.columns:
    post_stocks = postsale['Stock #'].head(20)
    print("\nSample Stock Numbers from post-sale:")
    for s in post_stocks[:10]:
        print(f"  '{s}'")

# Check for matches
pre_stocks = set(presale['Stock Number'].astype(str))
post_stocks = set(postsale['Stock #'].astype(str))
matches = pre_stocks.intersection(post_stocks)

print(f"\n{len(matches)} vehicles appear in BOTH presale and postsale")
if matches:
    print("Sample matches:", list(matches)[:5])