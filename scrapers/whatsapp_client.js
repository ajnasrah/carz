/**
 * WhatsApp Client for Carz Inc
 * Uses whatsapp-web.js to connect to WhatsApp Web
 * Communicates with whatsapp_server.py
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const app = express();
app.use(express.json());

// Enable CORS for browser extensions
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

const PORT = 7750;
const PYTHON_SERVER = 'http://localhost:7749';

// Configure WhatsApp client with persistent session
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './whatsapp_session'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Track connection status
let isConnected = false;
let groupChats = {};
const GROUP_NAMES = {
    'seller': 'Carz inc',
    'bodyshop': 'Body shop',
    'mechanic': 'Mechanic',
    'ready': 'Ready to sell'
};

// Generate QR code for authentication
client.on('qr', (qr) => {
    console.log('Scan this QR code with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

// Client ready
client.on('ready', async () => {
    console.log('✅ WhatsApp client is ready!');
    isConnected = true;
    
    // Find all target groups
    const chats = await client.getChats();
    
    for (const [key, groupName] of Object.entries(GROUP_NAMES)) {
        const group = chats.find(chat => chat.isGroup && chat.name === groupName);
        if (group) {
            groupChats[key] = group;
            console.log(`✅ Found group: ${groupName}`);
            console.log(`   Group ID: ${group.id._serialized}`);
        } else {
            console.log(`⚠️ Group "${groupName}" not found`);
        }
    }
    
    // List all available groups for reference
    console.log('\n📋 All available groups:');
    chats.filter(c => c.isGroup).forEach(c => {
        console.log(`   - ${c.name}`);
    });
});

// Handle authentication failure
client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    isConnected = false;
});

// Handle disconnection
client.on('disconnected', (reason) => {
    console.log('❌ Client disconnected:', reason);
    isConnected = false;
});

// Listen for new messages in real-time
client.on('message', async (msg) => {
    const chat = await msg.getChat();
    
    // Check if message is from any of our monitored groups
    if (chat.isGroup) {
        const groupType = Object.keys(GROUP_NAMES).find(
            key => groupChats[key] && groupChats[key].id._serialized === chat.id._serialized
        );
        
        if (groupType) {
            try {
                const messageData = {
                    type: msg.type,
                    body: msg.body,
                    timestamp: new Date(msg.timestamp * 1000).toISOString(),
                    author: msg.author || msg.from,
                    chatName: chat.name,
                    groupType: groupType  // 'seller', 'bodyshop', or 'mechanic'
                };
                
                // Handle media messages
                if (msg.hasMedia) {
                    const media = await msg.downloadMedia();
                    messageData.media = media.data; // base64 encoded
                    messageData.mimetype = media.mimetype;
                }
                
                // Forward to Python server
                await fetch(`${PYTHON_SERVER}/webhook/whatsapp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(messageData)
                });
                
                console.log(`📨 [${groupType}] Message from ${messageData.author}`);
            } catch (error) {
                console.error('Error processing message:', error);
            }
        }
    }
});

// API Endpoints

// Check connection status
app.get('/status', (req, res) => {
    const groupStatus = {};
    for (const [key, name] of Object.entries(GROUP_NAMES)) {
        groupStatus[key] = {
            name: name,
            found: !!groupChats[key]
        };
    }
    
    res.json({
        connected: isConnected,
        groups: groupStatus
    });
});

// Scrape messages from group(s)
app.post('/scrape', async (req, res) => {
    if (!isConnected) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }
    
    try {
        const { start, end, limit = 100, groupType = 'all' } = req.body;
        
        // Determine which groups to scrape
        let groupsToScrape = [];
        if (groupType === 'all') {
            groupsToScrape = Object.entries(groupChats).filter(([k, v]) => v);
        } else if (groupChats[groupType]) {
            groupsToScrape = [[groupType, groupChats[groupType]]];
        } else {
            return res.status(404).json({ error: `Group type "${groupType}" not found` });
        }
        
        if (groupsToScrape.length === 0) {
            return res.status(404).json({ error: 'No groups found to scrape' });
        }
        
        const allMessages = [];
        
        for (const [type, chat] of groupsToScrape) {
            console.log(`Scraping ${GROUP_NAMES[type]}...`);
            
            // Fetch messages
            const messages = await chat.fetchMessages({ limit });
            
            // Filter by date if provided
            let filteredMessages = messages;
            if (start || end) {
                const startDate = start ? new Date(start) : new Date(0);
                const endDate = end ? new Date(end) : new Date();
                
                filteredMessages = messages.filter(msg => {
                    const msgDate = new Date(msg.timestamp * 1000);
                    return msgDate >= startDate && msgDate <= endDate;
                });
            }
            
            // Process messages
            for (const msg of filteredMessages) {
                const messageData = {
                    type: msg.type,
                    body: msg.body,
                    timestamp: new Date(msg.timestamp * 1000).toISOString(),
                    author: msg.author || msg.from,
                    groupType: type,
                    chatName: GROUP_NAMES[type]
                };
                
                // Download media if present
                if (msg.hasMedia && msg.type === 'image') {
                    try {
                        const media = await msg.downloadMedia();
                        messageData.media = media.data; // base64
                        messageData.mimetype = media.mimetype;
                    } catch (error) {
                        console.error('Error downloading media:', error);
                    }
                }
                
                allMessages.push(messageData);
            }
        }
        
        res.json({
            success: true,
            messages: allMessages,
            count: allMessages.length,
            groups: groupsToScrape.map(([type]) => GROUP_NAMES[type])
        });
        
    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add or update a group to monitor
app.post('/set-group', async (req, res) => {
    const { groupName, groupType } = req.body;
    
    if (!isConnected) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }
    
    if (!groupType || !['seller', 'bodyshop', 'mechanic'].includes(groupType)) {
        return res.status(400).json({ error: 'Invalid groupType. Must be: seller, bodyshop, or mechanic' });
    }
    
    const chats = await client.getChats();
    const newGroup = chats.find(chat => chat.isGroup && chat.name === groupName);
    
    if (newGroup) {
        groupChats[groupType] = newGroup;
        GROUP_NAMES[groupType] = groupName;
        res.json({ success: true, message: `Set ${groupType} group to: ${groupName}` });
    } else {
        res.status(404).json({ error: `Group "${groupName}" not found` });
    }
});

// List available groups
app.get('/groups', async (req, res) => {
    if (!isConnected) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }
    
    const chats = await client.getChats();
    const groups = chats
        .filter(c => c.isGroup)
        .map(c => ({ name: c.name, id: c.id._serialized }));
    
    res.json({ groups });
});

// Send test message (for debugging)
app.post('/send-test', async (req, res) => {
    if (!isConnected || !groupChat) {
        return res.status(503).json({ error: 'Not ready to send' });
    }
    
    try {
        await groupChat.sendMessage('🤖 WhatsApp integration test from Carz Inc system');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Shutdown endpoint
app.post('/shutdown', async (req, res) => {
    console.log('🛑 Shutdown request received');
    res.json({ message: 'WhatsApp client shutting down' });
    
    // Close WhatsApp connection
    if (client) {
        await client.destroy();
    }
    
    // Exit after response is sent
    setTimeout(() => {
        process.exit(0);
    }, 100);
});

// Start Express server
const server = app.listen(PORT, () => {
    console.log(`📡 WhatsApp client API running on port ${PORT}`);
    console.log(`📝 Monitoring groups:`, Object.values(GROUP_NAMES).join(', '));
    console.log(`🔗 Python server expected at: ${PYTHON_SERVER}`);
});

// Initialize WhatsApp client
console.log('🚀 Starting WhatsApp client...');
client.initialize();