const express = require('express');
const cors = require('cors');
const multer = require('multer');
const AWS = require('aws-sdk');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const s3 = new AWS.S3({
  accessKeyId: "sFat404pOWVyOCAa9feLz62U5gM9l39ffY1BIlBd",
  secretAccessKey: "OTvQbifzJBk3DGXO",
  endpoint: "https://s3.tebi.io",
  region: "us-east-1",
  signatureVersion: 'v4',
});

const BUCKET_NAME = "airbridge-files";
const sessions = {};

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  } while (sessions[code]);
  return code;
}

// ✅ Direct Upload API (files/text/link - all handled here)
app.post('/upload', upload.array('files'), async (req, res) => {
  const sessionId = generateCode();
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
    uploadedFiles.push({ name: file.originalname, type: file.mimetype, url });
  }

  const text = req.body.text || '';
  const link = req.body.link || '';

  sessions[sessionId] = {
    files: uploadedFiles,
    text,
    link,
    expiresAt: Date.now() + 30 * 60 * 1000,
  };

  res.json({ code: sessionId, message: 'Upload successful' });
});

// Download ZIP
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
      console.error('ZIP error:', err.message);
    }
  }

  archive.finalize();
});

// Generate QR
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// Preview
app.get('/preview/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  res.json({
    files: session.files,
    text: session.text,
    link: session.link,
  });
});

// Cleanup
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) delete sessions[code];
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});