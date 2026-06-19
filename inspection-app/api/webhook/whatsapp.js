/**
 * WhatsApp Business API Webhook Handler
 * Deployed at: https://carzinc.ai/api/webhook/whatsapp
 * 
 * This endpoint:
 * 1. Verifies webhook setup with Meta
 * 2. Receives WhatsApp messages
 * 3. Saves photos and inspection data directly to Supabase
 */

import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://yprihgygmreibcuybwoy.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Add this to Vercel env vars
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'carz_whatsapp_verify_2024';

// Initialize Supabase client with service role (for server-side operations)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// WhatsApp Cloud API configuration
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN; // Your WhatsApp Business API token
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

/**
 * Parse vehicle information from WhatsApp message
 */
function parseVehicleInfo(text) {
  const lines = text.trim().split('\n');
  
  // Try structured format first (VIN on line 1, miles on line 2, etc)
  if (lines.length >= 3) {
    const firstLine = lines[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    
    // Must be 5-7 alphanumeric AND contain at least one digit
    if (/^[A-Z0-9]{5,7}$/.test(firstLine) && /\d/.test(firstLine)) {
      const excludeWords = ['DETAIL', 'PEELED', 'CLOSED', 'TRYING', 'WORKS', 'BRING'];
      
      if (!excludeWords.includes(firstLine)) {
        let vinLast6 = firstLine;
        if (vinLast6.length === 7) {
          vinLast6 = /^[A-Z]/.test(firstLine) ? firstLine.slice(0, 6) : vinLast6.slice(-6);
        } else if (vinLast6.length === 5) {
          vinLast6 = '0' + vinLast6;
        }
        
        // Parse miles from second line
        let miles = 0;
        if (lines[1]) {
          const milesMatch = lines[1].replace(/,/g, '').match(/^(\d{3,6})$/);
          if (milesMatch) {
            miles = parseInt(milesMatch[1]);
          }
        }
        
        // Get condition from third line
        const condition = lines[2]?.trim() || "Unknown";
        
        // Get tire score from fourth line
        let tireCondition = null;
        if (lines[3]) {
          const tireMatch = lines[3].match(/(\d+(?:\.\d+)?)/);
          if (tireMatch) {
            tireCondition = parseFloat(tireMatch[1]);
          }
        }
        
        return {
          vin_last6: vinLast6,
          mileage: miles,
          condition: condition,
          tire_condition: tireCondition,
          notes: lines.slice(4).join(' ').substring(0, 500)
        };
      }
    }
  }
  
  return null;
}

/**
 * Download and save media from WhatsApp
 */
async function saveWhatsAppMedia(mediaId, vinLast6, messageId) {
  try {
    // Step 1: Get media URL from WhatsApp
    const mediaResponse = await fetch(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );
    
    if (!mediaResponse.ok) {
      throw new Error(`Failed to get media URL: ${mediaResponse.statusText}`);
    }
    
    const mediaData = await mediaResponse.json();
    const mediaUrl = mediaData.url;
    
    // Step 2: Download the media
    const imageResponse = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`
      }
    });
    
    if (!imageResponse.ok) {
      throw new Error(`Failed to download media: ${imageResponse.statusText}`);
    }
    
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBlob = new Blob([imageBuffer], { type: mediaData.mime_type || 'image/jpeg' });
    
    // Step 3: Upload to Supabase Storage
    const fileName = `${vinLast6}/${messageId}_${Date.now()}.jpg`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('inspection-photos')
      .upload(fileName, imageBlob, {
        contentType: mediaData.mime_type || 'image/jpeg',
        upsert: false
      });
    
    if (uploadError) {
      throw uploadError;
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('inspection-photos')
      .getPublicUrl(fileName);
    
    return publicUrl;
  } catch (error) {
    console.error('Error saving WhatsApp media:', error);
    return null;
  }
}

/**
 * Process incoming WhatsApp message
 */
async function processWhatsAppMessage(message) {
  try {
    const { from, id: messageId, timestamp, type } = message;
    
    // Handle text messages with vehicle info
    if (type === 'text' && message.text?.body) {
      const vehicleInfo = parseVehicleInfo(message.text.body);
      
      if (vehicleInfo) {
        // Check if inspection exists
        const { data: existing } = await supabase
          .from('inspections')
          .select('id')
          .eq('vin_last6', vehicleInfo.vin_last6)
          .single();
        
        if (existing) {
          // Update existing inspection
          await supabase
            .from('inspections')
            .update({
              mileage: vehicleInfo.mileage,
              condition: vehicleInfo.condition,
              tire_condition: vehicleInfo.tire_condition,
              notes: vehicleInfo.notes,
              whatsapp_updated_at: new Date().toISOString(),
              whatsapp_phone: from
            })
            .eq('id', existing.id);
        } else {
          // Create new inspection
          await supabase
            .from('inspections')
            .insert({
              vin_last6: vehicleInfo.vin_last6,
              mileage: vehicleInfo.mileage,
              condition: vehicleInfo.condition,
              tire_condition: vehicleInfo.tire_condition,
              notes: vehicleInfo.notes,
              source: 'whatsapp',
              whatsapp_phone: from,
              whatsapp_message_id: messageId,
              completed_at: new Date().toISOString()
            });
        }
        
        console.log(`✅ Saved inspection for VIN: ${vehicleInfo.vin_last6}`);
        return vehicleInfo.vin_last6;
      }
    }
    
    // Handle image messages
    if (type === 'image' && message.image) {
      const { id: mediaId, caption } = message.image;
      
      // Try to extract VIN from caption
      let vinLast6 = null;
      if (caption) {
        const vehicleInfo = parseVehicleInfo(caption);
        if (vehicleInfo) {
          vinLast6 = vehicleInfo.vin_last6;
          
          // Save vehicle info from caption
          await supabase
            .from('inspections')
            .upsert({
              vin_last6: vinLast6,
              mileage: vehicleInfo.mileage,
              condition: vehicleInfo.condition,
              notes: vehicleInfo.notes,
              source: 'whatsapp',
              whatsapp_phone: from,
              completed_at: new Date().toISOString()
            }, {
              onConflict: 'vin_last6'
            });
        }
      }
      
      // If we have a VIN, save the photo
      if (vinLast6 && mediaId) {
        const photoUrl = await saveWhatsAppMedia(mediaId, vinLast6, messageId);
        
        if (photoUrl) {
          // Add photo reference to inspection
          const { data: inspection } = await supabase
            .from('inspections')
            .select('id, photos')
            .eq('vin_last6', vinLast6)
            .single();
          
          if (inspection) {
            const photos = inspection.photos || [];
            photos.push({
              url: photoUrl,
              timestamp: new Date().toISOString(),
              source: 'whatsapp'
            });
            
            await supabase
              .from('inspections')
              .update({ photos })
              .eq('id', inspection.id);
            
            console.log(`📷 Saved photo for VIN: ${vinLast6}`);
          }
        }
      }
      
      return vinLast6;
    }
    
    // Handle location updates (Body Shop, Mechanic messages)
    if (type === 'text' && message.text?.body) {
      const text = message.text.body.toUpperCase();
      const vinMatch = text.match(/\b([A-Z0-9]{5,7})\b/);
      
      if (vinMatch) {
        let vinLast6 = vinMatch[1];
        if (vinLast6.length === 7) {
          vinLast6 = vinLast6.slice(-6);
        } else if (vinLast6.length === 5) {
          vinLast6 = '0' + vinLast6;
        }
        
        // Determine location based on keywords
        let location = null;
        if (text.includes('BODY') || text.includes('PAINT')) {
          location = 'body_shop';
        } else if (text.includes('MECHANIC') || text.includes('REPAIR')) {
          location = 'mechanic_shop';
        }
        
        if (location) {
          // Update vehicle location
          await supabase
            .from('vehicle_locations')
            .upsert({
              vin: vinLast6,
              physical_location: location,
              physical_source: 'whatsapp',
              location_updated_at: new Date().toISOString(),
              notes: { from: from, message: text.substring(0, 200) }
            }, {
              onConflict: 'vin'
            });
          
          console.log(`📍 Updated location for ${vinLast6} to ${location}`);
        }
      }
    }
    
  } catch (error) {
    console.error('Error processing WhatsApp message:', error);
  }
}

/**
 * Main webhook handler
 */
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Handle webhook verification (GET request from Meta)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    // Verify the token matches what we set
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified successfully');
      return res.status(200).send(challenge);
    } else {
      console.error('❌ Webhook verification failed');
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  
  // Handle incoming messages (POST request from WhatsApp)
  if (req.method === 'POST') {
    try {
      const body = req.body;
      
      // Extract messages from webhook payload
      if (body.entry && body.entry[0]?.changes && body.entry[0].changes[0]?.value?.messages) {
        const messages = body.entry[0].changes[0].value.messages;
        
        // Process each message
        for (const message of messages) {
          await processWhatsAppMessage(message);
        }
        
        // Return success immediately (WhatsApp requires quick response)
        return res.status(200).json({ status: 'received' });
      }
      
      // Mark message as read (optional)
      if (body.entry && body.entry[0]?.changes && body.entry[0].changes[0]?.value?.statuses) {
        // Handle status updates (delivered, read, etc.)
        return res.status(200).json({ status: 'ok' });
      }
      
      return res.status(200).json({ status: 'ok' });
      
    } catch (error) {
      console.error('Webhook error:', error);
      // Still return 200 to prevent WhatsApp from retrying
      return res.status(200).json({ status: 'error', message: error.message });
    }
  }
  
  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
}