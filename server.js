
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const AWS = require('aws-sdk');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ 
  origin: [
    'http://localhost:5173',
    'https://airbridge-gamma.vercel.app'
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());

// Memory multer config
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Tebi S3 Config (using provided credentials)
const s3 = new AWS.S3({
  accessKeyId: "sFat404pOWVyOCAa9feLz62U5gM9l39ffY1BIlBd",
  secretAccessKey: "OTvQbifzJBk3DGXO",
  endpoint: "https://s3.tebi.io", // Tebi endpoint
  region: "us-east-1",
  signatureVersion: 'v4'
});
const BUCKET_NAME = "airbridge-files"; // Replace with your actual Tebi bucket name

// In-memory session store
const sessions = {};

// Generate unique 6-char code
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  } while (sessions[code]);
  return code;
}

// Upload files to Tebi
app.post('/upload', upload.array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || generateCode();
  const uploadedFiles = [];

  for (const file of req.files || []) {
    const key = `uploads/${Date.now()}-${file.originalname}`;
    await s3.putObject({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    }).promise();

    const url = `https://${BUCKET_NAME}.s3.tebi.io/${key}`;
    uploadedFiles.push({ url, name: file.originalname, type: file.mimetype });
  }

  sessions[sessionId] = {
    files: uploadedFiles,
    text: req.body.text || '',
    link: req.body.link || '',
    expiresAt: Date.now() + 30 * 60 * 1000
  };

  res.json({ code: sessionId, message: 'Uploaded to Tebi successfully' });
});

// Download as ZIP
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
      console.error('Archive error:', err.message);
    }
  }

  archive.finalize();
});

// QR code endpoint
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
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

// Cleanup expired sessions
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