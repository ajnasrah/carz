module.exports = (req, res) => {
  // Handle webhook verification
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'carz_whatsapp_verify_2024') {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }
  
  // Handle incoming messages
  if (req.method === 'POST') {
    console.log('Message received:', req.body);
    return res.status(200).json({ status: 'ok' });
  }
  
  return res.status(405).send('Method Not Allowed');
};