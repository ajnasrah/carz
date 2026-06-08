# WhatsApp Integration Setup Guide

This guide covers WhatsApp integration for vehicle inspection data.

## Prerequisites

1. Node.js (v14 or higher)
2. Python 3.8+
3. WhatsApp account with access to the "Seller Group"

## Installation

### Step 1: Install Dependencies

```bash
cd /Users/abdullahabunasrah/Desktop/carz\ inc/scrapers

# Install Node.js dependencies
npm install

# Install Python dependencies
pip3 install -r requirements.txt
```

### Step 2: Configure WhatsApp Group Name

Edit `whatsapp_client.js` line 28:
```javascript
const GROUP_NAME = 'Seller Group'; // Change to your actual group name
```

## Running the System

### Method 1: Run Both Together (Recommended)

```bash
npm run dev
```

This starts both the WhatsApp client and Python server.

### Method 2: Run Separately

Terminal 1 - Start WhatsApp Client:
```bash
node whatsapp_client.js
```

Terminal 2 - Start Python Server:
```bash
python3 whatsapp_server.py
```

## First Time Setup

1. When you first run `node whatsapp_client.js`, a QR code will appear in the terminal
2. Open WhatsApp on your phone
3. Go to Settings > Linked Devices > Link a Device
4. Scan the QR code
5. The session will be saved locally in `./whatsapp_session/`

## How It Works

### Message Format
Messages in the WhatsApp group should follow this format:
```
123456
45000
Good
7.5
Front bumper has minor scratch
```

- Line 1: Last 6 of VIN
- Line 2: Miles
- Line 3: Condition
- Line 4: Tire score
- Line 5+: Optional notes

### Photo Association
- Send photos immediately after the vehicle text message
- Photos are automatically associated with the most recent VIN

## API Endpoints (Compatible with Chrome Extension)

The server runs on **localhost:7749** with these endpoints:

- `GET /status` - Check server and WhatsApp connection
- `POST /scrape` - Manually trigger message scraping
- `GET /queue` - Get queued vehicles
- `GET /vehicle/<vin6>/photos` - Get vehicle photos
- `POST /queue/mark-listed/<vin6>` - Mark as listed
- `POST /queue/mark-sold/<vin6>` - Mark as sold

## Chrome Extension Compatibility

The Chrome extensions will work without any changes! They connect to the same port (7749) and use the same API format.

## Troubleshooting

### WhatsApp Not Connecting
- Make sure your phone has internet
- Try deleting `./whatsapp_session/` folder and re-scanning QR code

### Group Not Found
1. Check available groups:
```bash
curl http://localhost:7750/groups
```

2. Update group name in `whatsapp_client.js`

### Messages Not Processing
- Check message format matches expected pattern
- View logs in both terminal windows
- Verify group name is correct

## Data Continuity
- Vehicle folders remain in the same location: `~/Library/Application Support/CarzInc/seller_group_output`
- Queue file (`queue.json`) format unchanged
- Chrome extensions work without modifications

## Testing

Send a test message to verify setup:
```bash
curl -X POST http://localhost:7750/send-test
```

Check server status:
```bash
curl http://localhost:7749/status
```

## Auto-Start on Login (Optional)

Create LaunchAgent:
```bash
cat > ~/Library/LaunchAgents/com.carzinc.whatsapp.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.carzinc.whatsapp</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/abdullahabunasrah/Desktop/carz inc/scrapers/whatsapp_client.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/whatsapp-client.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/whatsapp-client.error.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.carzinc.whatsapp.plist
```

## Security Notes

- WhatsApp session is stored locally in `./whatsapp_session/`
- No cloud services or external APIs required
- All data stays on your local machine
- Messages are only read from the specified group

## Support

For issues, check:
- Terminal output from both Node.js and Python processes
- `/tmp/whatsapp-client.log` if using LaunchAgent
- Chrome extension console for any API errors