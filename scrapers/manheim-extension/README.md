# Manheim/OVE Scraper Chrome Extension

A Chrome extension to scrape vehicle listings and condition reports from Manheim.com and OVE.com, plus process downloaded PDF condition reports. Automatically downloads all images and details to your Downloads folder organized by VIN.

## Installation

1. **Add Extension Icons** (required before loading):
   - You need 3 icon files: `icon16.png`, `icon48.png`, and `icon128.png`
   - You can use any car-related icon or create simple placeholder icons
   - Place them in the `manheim-extension` folder

2. **Load Extension in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the folder: `/Users/abdullahabunasrah/Desktop/carz inc/scrapers/manheim-extension`

## Usage

### Option 1: Scrape Live Pages
1. Navigate to any Manheim or OVE listing/condition report page
2. Click the extension icon in Chrome toolbar
3. Click "Scrape This Page" button
4. Wait for the download to complete
5. Check your Downloads folder for a new folder named with the VIN

### Option 2: Upload PDF Condition Reports
1. Click the extension icon
2. Click "Upload PDF Condition Report" button
3. Select a downloaded Manheim condition report PDF
4. Wait for processing
5. Check your Downloads folder for the VIN folder with extracted data

## What Gets Downloaded

The extension creates a folder in Downloads named after the vehicle's VIN containing:

- `{VIN}_summary.txt` - Complete summary with:
  - VIN, vehicle info, odometer
  - Condition score
  - All damages and issues found
  - List of downloaded images

- `{VIN}_image_1.jpg`, `{VIN}_image_2.jpg`, etc. - All vehicle images from the page

## Features

- Extracts VIN automatically
- Captures vehicle year, make, model
- Downloads all vehicle images in high resolution
- Identifies damages and issues
- Records odometer reading
- Captures condition score
- Saves announcements and alerts
- Organizes everything in VIN-named folders

## Troubleshooting

**"Could not extract vehicle data" error:**
- Make sure you're on a Manheim listing or condition report page
- Some pages may have different layouts - the extension works best on standard CR pages

**Images not downloading:**
- Check your Chrome download settings
- Make sure downloads aren't being blocked
- Check that you have enough disk space

**Extension not appearing:**
- Make sure you added the icon files
- Check that Developer mode is enabled in chrome://extensions/
- Try reloading the extension

## Technical Details

- Built with Manifest V3
- Uses Chrome Extensions API
- Runs only on manheim.com domains
- No external servers - all processing happens locally
