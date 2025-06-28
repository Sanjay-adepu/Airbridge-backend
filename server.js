const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// In-memory session store
const sessions = {};

// Generate 6-digit code
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (sessions[code]);
  return code;
}

// Upload metadata endpoint
app.post('/upload', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || generateCode();
  const { files, text, link } = req.body;

  if (!files?.length && !text && !link) {
    return res.status(400).json({ message: 'No upload data received' });
  }

  sessions[sessionId] = {
    files: files || [],
    text: text || '',
    link: link || '',
    expiresAt: Date.now() + 30 * 60 * 1000, // 30 mins
  };

  res.json({ code: sessionId, message: 'Metadata stored successfully' });
});

// Download ZIP
app.get('/download/:code', async (req, res) => {
  const code = req.params.code;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  const archive = archiver('zip', { zlib: { level: 9 } });
  res.attachment(`${code}.zip`);
  archive.pipe(res);

  for (const file of session.files) {
    try {
      const response = await axios.get(file.url, { responseType: 'stream' });
      archive.append(response.data, { name: file.name });
    } catch (err) {
      console.error('Error downloading:', file.name, err.message);
    }
  }

  archive.finalize();
});

// QR code generation
app.get('/qrcode/:code', async (req, res) => {
  const { code } = req.params;
  const url = `https://airbridge-backend.vercel.app/preview/${code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// Preview endpoint
app.get('/preview/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  res.json({
    files: session.files || [],
    text: session.text,
    link: session.link,
  });
});

// Auto-cleanup
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});