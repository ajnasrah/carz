# WhatsApp Business API - Quick Setup Guide

## ✅ What I've Done:
1. Created webhook endpoint at `https://carzinc.ai/api/webhook/whatsapp`
2. Added verify token to Vercel: `carz_whatsapp_verify_2024`
3. Deployed to production

## 🔴 What You Need to Do Now:

### 1. Get Supabase Service Key (2 minutes)
**Tab opened**: https://supabase.com/dashboard/project/yprihgygmreibcuybwoy/settings/api

1. Look for **"service_role (secret)"** section
2. Click "Reveal" 
3. Copy the key (starts with `eyJ...`)
4. Run this command:
```bash
echo "YOUR_SERVICE_KEY_HERE" | vercel env add SUPABASE_SERVICE_KEY production
```

### 2. Create WhatsApp Business App (5 minutes)
**Tab opened**: https://developers.facebook.com

1. Click **"My Apps"** → **"Create App"**
2. Choose **"Business"** type
3. App name: **"Carz Inc WhatsApp"**
4. Click **"Set Up"** under WhatsApp

### 3. Get WhatsApp Credentials (2 minutes)
In the WhatsApp dashboard:

1. You'll see a **test phone number** like `+1 555 025 3483`
2. Copy the **"Temporary access token"** (starts with `EAAI...`)
3. Copy the **"Phone number ID"** (like `123456789012345`)

Run these commands:
```bash
# Add access token
echo "YOUR_ACCESS_TOKEN" | vercel env add WHATSAPP_ACCESS_TOKEN production

# Add phone number ID  
echo "YOUR_PHONE_NUMBER_ID" | vercel env add WHATSAPP_PHONE_NUMBER_ID production
```

### 4. Configure Webhook (3 minutes)
In Meta dashboard → WhatsApp → Configuration:

1. Click **"Edit"** next to Webhook
2. Enter:
   - **Callback URL**: `https://carzinc.ai/api/webhook/whatsapp`
   - **Verify Token**: `carz_whatsapp_verify_2024`
3. Click **"Verify and Save"**
4. Subscribe to: **"messages"**

### 5. Deploy Final Version
```bash
cd "/Users/abdullahabunasrah/Desktop/carz inc/inspection-app"
vercel --prod --yes
```

## 📱 Test It!
Send a WhatsApp message to your test number:
```
021216
75000
Good
8.5
Ready
```

Check Supabase → inspections table for the new entry!

## 🚨 Troubleshooting

**Webhook won't verify?**
- Make sure you deployed after adding env variables
- Check token is exactly: `carz_whatsapp_verify_2024`

**Messages not saving?**
- Check all 4 env variables are set in Vercel
- Redeploy: `vercel --prod --yes`

**Need the test number to work?**
- Add your personal WhatsApp as a test user in Meta dashboard