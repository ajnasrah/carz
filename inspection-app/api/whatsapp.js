export default function handler(req, res) {
  // Handle GET request for webhook verification
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    // Check if mode and token are correct
    if (mode && token) {
      if (mode === 'subscribe' && token === 'carz_whatsapp_verify_2024') {
        console.log('WEBHOOK_VERIFIED');
        // Return the challenge to verify
        res.status(200).send(challenge);
      } else {
        // Token doesn't match
        res.status(403).send('Forbidden');
      }
    } else {
      res.status(400).send('Bad Request');
    }
  } 
  // Handle POST request for incoming messages
  else if (req.method === 'POST') {
    const body = req.body;
    
    // Process the webhook data here
    console.log('Incoming webhook:', JSON.stringify(body, null, 2));
    
    // Return 200 OK to acknowledge receipt
    res.status(200).json({ status: 'ok' });
  } 
  // Handle other methods
  else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}