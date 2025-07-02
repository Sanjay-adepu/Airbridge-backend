const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const archiver = require('archiver');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 5000;

const upload = multer(); // memory storage

app.use(cors({
  origin: ['http://localhost:5173', 'https://airbridge-gamma.vercel.app'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// 🧠 Session store
const sessions = {};
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

// ✅ Upload metadata (text/files/links)
app.post('/upload', async (req, res) => {
  const sessionId = generateCode();
  const { files = [], text = '', link = '' } = req.body;

  sessions[sessionId] = {
    files,
    text,
    link,
    expiresAt: Date.now() + 2 * 60 * 1000
  };

  res.json({ code: sessionId, message: 'Upload registered' });
});

// ✅ Upload to Gofile.io
app.post('/tempupload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // 1. Get the best GoFile server
    const serverRes = await axios.get('https://api.gofile.io/getServer');
    const uploadServer = serverRes.data.data.server;

    // 2. Prepare form data
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    // 3. Post to GoFile
    const gofileRes = await axios.post(
      `https://${uploadServer}.gofile.io/uploadFile`,
      form,
      {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    if (gofileRes.data.status !== 'ok') {
      console.error('Gofile response:', gofileRes.data);
      return res.status(500).json({ error: 'Upload failed' });
    }

    const fileUrl = gofileRes.data.data.downloadPage;
    return res.json({ url: fileUrl });

  } catch (err) {
    console.error('GoFile upload error:', err.message);
    res.status(500).json({ error: 'GoFile upload error' });
  }
});

// ✅ Preview
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

// ✅ QR code
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// ✅ Download ZIP
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
      console.error('ZIP error:', err.message);
    }
  }

  archive.finalize();
});

// ✅ Auto-clean expired sessions
setInterval(() => {
  for (const code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      delete sessions[code];
    }
  }
}, 2 * 60 * 1000);

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});