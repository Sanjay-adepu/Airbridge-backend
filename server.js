const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const QRCode = require('qrcode');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ['http://localhost:5173', 'https://airbridge-gamma.vercel.app'],
  credentials: true
}));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// 🧠 Temporary session store (clears after 2 minutes)
const sessions = {};

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (sessions[code]);
  return code;
}

// ✅ Upload to Temp.sh via /upload
app.post('/upload', upload.array('files'), async (req, res) => {
  try {
    const uploadedFiles = [];

    for (const file of req.files) {
      const form = new FormData();
      form.append('file', file.buffer, { filename: file.originalname });

      const response = await axios.post('https://temp.sh/upload', form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity
      });

      uploadedFiles.push({
        name: file.originalname,
        url: response.data.trim()
      });
    }

    const code = generateCode();
    sessions[code] = {
      files: uploadedFiles,
      text: req.body.text || '',
      link: req.body.link || '',
      expiresAt: Date.now() + 2 * 60 * 1000 // auto-expire after 2 min
    };

    res.json({ code, files: uploadedFiles });

  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});

// ✅ QR Code endpoint
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://your-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// ✅ Preview
app.get('/preview/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt)
    return res.status(404).json({ message: 'Invalid or expired code' });

  res.json(session);
});

// ✅ ZIP Download
app.get('/download/:code', async (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt)
    return res.status(404).json({ message: 'Invalid or expired code' });

  const archive = archiver('zip', { zlib: { level: 9 } });
  res.attachment(`${req.params.code}.zip`);
  archive.pipe(res);

  for (const file of session.files) {
    try {
      const response = await axios.get(file.url, { responseType: 'stream' });
      archive.append(response.data, { name: file.name });
    } catch (err) {
      console.error(`Error downloading ${file.name}:`, err.message);
    }
  }

  archive.finalize();
});

// ✅ Auto-delete sessions every minute
setInterval(() => {
  for (const code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      delete sessions[code];
    }
  }
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});