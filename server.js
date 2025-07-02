const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const archiver = require('archiver');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 5000;
const upload = multer(); // Memory storage

// CORS Setup
app.use(cors({
  origin: ['http://localhost:5173', 'https://airbridge-gamma.vercel.app'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// In-memory session store
const sessions = {};

// Generate random 6-digit session code
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');
  } while (sessions[code]);
  return code;
}

// 🟢 Upload file to GoFile directly
app.post('/gofileupload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Get best server
    const serverRes = await axios.get('https://api.gofile.io/getServer');
    const server = serverRes.data.data.server;

    // Prepare upload
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Upload to that server
    const uploadRes = await axios.post(`https://${server}.gofile.io/uploadFile`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    const fileUrl = uploadRes.data.data.downloadPage;

    return res.json({ url: fileUrl });

  } catch (err) {
    console.error('GoFile upload error:', err.message);
    return res.status(500).json({ error: 'GoFile upload failed' });
  }
});

// 🟢 Store metadata for preview and ZIP
app.post('/upload', async (req, res) => {
  const sessionId = generateCode();
  const { files = [], text = '', link = '' } = req.body;

  sessions[sessionId] = {
    files,
    text,
    link,
    expiresAt: Date.now() + 2 * 60 * 1000 // 2 minutes
  };

  res.json({ code: sessionId, message: 'Upload registered' });
});

// 🟢 Download ZIP for given code
app.get('/download/:code', async (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  const archive = archiver('zip', { zlib: { level: 9 } });
  res.attachment(`${req.params.code}.zip`);
  archive.pipe(res);

  for (const file of session.files) {
    try {
      const response = await axios.get(file.url, { responseType: 'stream' });
      archive.append(response.data, { name: file.name });
    } catch (err) {
      console.error('ZIP append error:', err.message);
    }
  }

  archive.finalize();
});

// 🟢 Preview metadata
app.get('/preview/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  res.json({
    files: session.files,
    text: session.text,
    link: session.link
  });
});

// 🟢 Generate QR code
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// 🟢 Auto-delete expired sessions
setInterval(() => {
  for (const code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      delete sessions[code];
    }
  }
}, 2 * 60 * 1000);

// 🟢 Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});