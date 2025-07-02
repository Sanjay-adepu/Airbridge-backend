const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ['http://localhost:5173', 'https://airbridge-gamma.vercel.app'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// 🧠 In-memory session store
const sessions = {};

// 🔐 Generate 6-digit code
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

// ✅ Multer setup to handle file uploads
const upload = multer({ dest: 'uploads/' });

// ✅ Upload files to temp.sh
app.post('/tem', upload.array('files'), async (req, res) => {
  try {
    const uploadedFiles = [];

    for (const file of req.files) {
      const form = new FormData();
      form.append('file', fs.createReadStream(file.path), file.originalname);

      const tempRes = await axios.post('https://temp.sh/', form, {
        headers: form.getHeaders(),
      });

      uploadedFiles.push({
        name: file.originalname,
        type: file.mimetype,
        url: tempRes.data.trim()
      });

      fs.unlinkSync(file.path); // clean up local
    }

    res.json({ success: true, files: uploadedFiles });
  } catch (err) {
    console.error('Temp.sh upload failed:', err.message);
    res.status(500).json({ message: 'Upload to Temp.sh failed' });
  }
});

// ✅ Store file/text/link metadata in memory
app.post('/upload', (req, res) => {
  const code = generateCode();
  const { files = [], text = '', link = '' } = req.body;

  sessions[code] = {
    files,
    text,
    link,
    expiresAt: Date.now() + 2 * 60 * 1000 // ⏳ 2 minutes
  };

  res.json({ code, message: 'Upload registered' });
});

// ✅ Generate QR code for preview
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    console.error('QR generation failed:', err.message);
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// ✅ Preview data
app.get('/preview/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt)
    return res.status(404).json({ message: 'Invalid or expired code' });

  res.json({
    files: session.files,
    text: session.text,
    link: session.link
  });
});

// ✅ Download ZIP
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
      console.error(`Error adding ${file.name}:`, err.message);
    }
  }

  archive.finalize();
});

// ✅ Cleanup expired sessions every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const code in sessions) {
    if (sessions[code].expiresAt < now) {
      delete sessions[code];
    }
  }
}, 2 * 60 * 1000);

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});