#!/bin/bash

echo "🚀 WhatsApp Business API Setup for carzinc.ai"
echo "============================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Get your Supabase Service Role Key${NC}"
echo "1. Open: https://supabase.com/dashboard/project/yprihgygmreibcuybwoy/settings/api"
echo "2. Find the 'service_role' key (NOT the anon key)"
echo "3. It starts with 'eyJ' and is longer than the anon key"
echo ""
read -p "Enter your Supabase service_role key: " SUPABASE_KEY

if [ ! -z "$SUPABASE_KEY" ]; then
    echo "$SUPABASE_KEY" | vercel env add SUPABASE_SERVICE_KEY production
    echo -e "${GREEN}✓ Added SUPABASE_SERVICE_KEY to Vercel${NC}"
fi

echo ""
echo -e "${YELLOW}Step 2: Set up WhatsApp Business${NC}"
echo "1. Go to: https://developers.facebook.com"
echo "2. Click 'Create App'"
echo "3. Select 'Business' type"
echo "4. Name it: 'Carz Inc WhatsApp'"
echo "5. Add WhatsApp product to your app"
echo ""
echo "Press Enter when you've created the app..."
read

echo ""
echo -e "${YELLOW}Step 3: Get WhatsApp Credentials${NC}"
echo "In your app dashboard:"
echo "1. Go to WhatsApp > API Setup"
echo "2. You'll see a test phone number or can add your business number"
echo "3. Use a PERMANENT System User token (NOT the 24h temporary one)"
echo "   Business Settings > Users > System Users > Admin > Generate token"
echo "   with whatsapp_business_messaging + whatsapp_business_management"
echo ""
read -p "Enter your WhatsApp Access Token: " WA_TOKEN

echo ""
echo "Also grab your App Secret: App > Settings > Basic > App Secret"
read -p "Enter your WhatsApp App Secret: " WA_APP_SECRET
if [ ! -z "$WA_APP_SECRET" ]; then
    echo "$WA_APP_SECRET" | vercel env add WHATSAPP_APP_SECRET production
    echo -e "${GREEN}✓ Added WHATSAPP_APP_SECRET to Vercel${NC}"
fi

if [ ! -z "$WA_TOKEN" ]; then
    echo "$WA_TOKEN" | vercel env add WHATSAPP_ACCESS_TOKEN production
    echo -e "${GREEN}✓ Added WHATSAPP_ACCESS_TOKEN to Vercel${NC}"
fi

echo ""
echo "4. Copy the Phone Number ID (a long number)"
echo ""
read -p "Enter your Phone Number ID: " PHONE_ID

if [ ! -z "$PHONE_ID" ]; then
    echo "$PHONE_ID" | vercel env add WHATSAPP_PHONE_NUMBER_ID production
    echo -e "${GREEN}✓ Added WHATSAPP_PHONE_NUMBER_ID to Vercel${NC}"
fi

echo ""
echo -e "${YELLOW}Step 4: Configure Webhook${NC}"
echo "1. In your app, go to WhatsApp > Configuration"
echo "2. Click 'Edit' next to Webhook"
echo "3. Enter these details:"
echo "   Callback URL: https://carzinc.ai/api/whatsapp"
echo "   Verify Token: carz_whatsapp_verify_2024"
echo "4. Click 'Verify and Save'"
echo "5. Subscribe to 'messages' webhook field"
echo ""
echo "Press Enter when webhook is configured..."
read

echo ""
echo -e "${YELLOW}Step 5: Deploy Changes${NC}"
vercel --prod --yes

echo ""
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo ""
echo "Your webhook is live at: https://carzinc.ai/api/whatsapp"
echo ""
echo "To test:"
echo "1. Send a WhatsApp message to your business number with:"
echo "   021216"
echo "   75000"
echo "   Good"
echo "   8.5"
echo "2. Check Supabase inspections table for the new entry"
echo ""
echo "Need help? Check WHATSAPP_SETUP.md for troubleshooting"