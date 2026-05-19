const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/info', (req, res) => {
  res.json({ ips: getLocalIPs(), port: PORT });
});

app.get('/qr', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('missing url');
    const dataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });
    res.json({ dataUrl });
  } catch {
    res.status(500).send('qr generation failed');
  }
});

const clients = new Map();

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function parseDeviceName(ua) {
  if (!ua) return null;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'Mac';
  if (/Android.*Mobile/i.test(ua)) return 'Android Phone';
  if (/Android/i.test(ua)) return 'Android Tablet';
  if (/Windows NT/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'Linux';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  return null;
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;

  // Parse UA from query string
  let ua = null;
  try {
    const url = new URL(req.url, 'http://localhost');
    ua = url.searchParams.get('ua');
    if (ua) ua = decodeURIComponent(ua);
  } catch {}

  const id = `${ip}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const parsed = parseDeviceName(ua);
  const name = parsed || `Device-${clients.size + 1}`;

  const client = { ws, id, name, ip };
  clients.set(id, client);

  // Send welcome first so the client knows its own ID before receiving the peer list
  ws.send(JSON.stringify({ type: 'welcome', id, name }));

  // Then broadcast peer list and notification to others
  broadcast({ type: 'peers', peers: getPeers() }, null);
  broadcast({ type: 'notification', message: `${name} joined` }, id);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(id, msg);
    } catch {
      for (const [cid, c] of clients) {
        if (cid !== id && c.ws.readyState === 1) {
          c.ws.send(data);
        }
      }
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    broadcast({ type: 'peers', peers: getPeers() }, null);
    broadcast({ type: 'notification', message: `${name} left` }, null);
  });
});

function handleMessage(senderId, msg) {
  const sender = clients.get(senderId);
  if (!sender) return;

  switch (msg.type) {
    case 'text':
      broadcast({
        type: 'text',
        from: sender.name,
        fromId: senderId,
        content: msg.content,
        iv: msg.iv,
        timestamp: Date.now()
      }, senderId);
      break;

    case 'file-meta':
      broadcast({
        type: 'file-meta',
        from: sender.name,
        fromId: senderId,
        fileName: msg.fileName,
        fileSize: msg.fileSize,
        fileType: msg.fileType,
        iv: msg.iv,
        encryptedKey: msg.encryptedKey
      }, senderId);
      break;

    case 'rename':
      sender.name = msg.name;
      broadcast({ type: 'peers', peers: getPeers() }, null);
      break;
  }
}

function broadcast(msg, excludeId) {
  const payload = JSON.stringify(msg);
  for (const [id, c] of clients) {
    if (id !== excludeId && c.ws.readyState === 1) {
      c.ws.send(payload);
    }
  }
}

function getPeers() {
  const peers = [];
  for (const [id, c] of clients) {
    peers.push({ id, name: c.name });
  }
  return peers;
}

const PORT = process.env.PORT || 3456;
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('LANShare running on:');
  console.log(`  http://localhost:${PORT}`);
  for (const ip of ips) {
    console.log(`  http://${ip}:${PORT}`);
  }
});
