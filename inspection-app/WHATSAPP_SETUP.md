# WhatsApp Business API Setup for carzinc.ai

## Quick Setup Steps

### 1. Create WhatsApp Business App
1. Go to [Meta for Developers](https://developers.facebook.com)
2. Create a new app → Type: "Business" 
3. Add WhatsApp product to your app
4. Get a test phone number or add your business number

### 2. Get Your Credentials
From the WhatsApp dashboard, copy:
- **Access Token**: Long string starting with "EAAI..."
- **Phone Number ID**: Number like "123456789012345"

### 3. Add to Vercel Environment Variables
```bash
vercel env add WHATSAPP_VERIFY_TOKEN
# Enter: carz_whatsapp_verify_2024

vercel env add WHATSAPP_ACCESS_TOKEN
# Enter: Your access token from Meta

vercel env add WHATSAPP_PHONE_NUMBER_ID  
# Enter: Your phone number ID

vercel env add SUPABASE_SERVICE_KEY
# Enter: Service role key from Supabase dashboard
```

### 4. Deploy to Vercel
```bash
cd /Users/abdullahabunasrah/Desktop/carz\ inc/inspection-app
vercel --prod
```

### 5. Configure Webhook in Meta
1. Go to WhatsApp → Configuration → Webhooks
2. Set Callback URL: `https://carzinc.ai/api/webhook/whatsapp`
3. Set Verify Token: `carz_whatsapp_verify_2024`
4. Subscribe to: `messages`, `message_status`

### 6. Test the Integration
Send a test message with vehicle info:
```
021216
75000
Good condition
8.5
Ready for sale
```

## What This Does

✅ **Receives WhatsApp messages** at carzinc.ai  
✅ **Parses vehicle information** (VIN, mileage, condition)  
✅ **Downloads and saves photos** to Supabase Storage  
✅ **Updates inspections table** with vehicle data  
✅ **Tracks vehicle locations** (Body Shop, Mechanic)  

## Message Formats Supported

### Vehicle Inspection
```
VIN123  
85000  
Fair  
7.5  
Needs new tires  
```

### Location Update
```
021216 moved to body shop
```

### Photo with Caption
Send photo with caption containing VIN info

## Troubleshooting

**Webhook not verifying?**
- Check WHATSAPP_VERIFY_TOKEN matches exactly
- Ensure URL is https://carzinc.ai/api/webhook/whatsapp

**Messages not saving?**
- Check SUPABASE_SERVICE_KEY is set correctly
- Verify Supabase tables exist (inspections, vehicle_locations)

**Photos not uploading?**
- Create storage bucket "inspection-photos" in Supabase
- Set bucket to public if needed