const express = require('express');
const cors = require('cors');
const AWS = require('aws-sdk');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ✅ Tebi S3 Config
const s3 = new AWS.S3({
  accessKeyId: "sFat404pOWVyOCAa9feLz62U5gM9l39ffY1BIlBd",
  secretAccessKey: "OTvQbifzJBk3DGXO",
  endpoint: "https://s3.tebi.io",
  region: "us-east-1",
  signatureVersion: 'v4',
});

const BUCKET_NAME = "airbridge-files";

// In-memory session store
const sessions = {};

// Generate 6-char code
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  } while (sessions[code]);
  return code;
}

// ✅ Generate Pre-signed URLs
app.post('/generate-upload-urls', async (req, res) => {
  try {
    const files = req.body.files || [];
    const urls = [];

    for (const file of files) {
      const key = `uploads/${Date.now()}-${file.name}`;
      const url = await s3.getSignedUrlPromise('putObject', {
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: file.type,
        Expires: 300, // 5 minutes
      });

      urls.push({
        uploadUrl: url,
        fileUrl: `https://${BUCKET_NAME}.s3.tebi.io/${key}`,
        name: file.name,
        type: file.type,
        key,
      });
    }

    res.json({ urls });
  } catch (err) {
    console.error('Error generating upload URLs:', err);
    res.status(500).json({ message: 'Failed to generate upload URLs' });
  }
});

// ✅ Receive metadata and store session
app.post('/register-upload', (req, res) => {
  const sessionId = generateCode();
  const { files, text = '', link = '' } = req.body;

  sessions[sessionId] = {
    files,
    text,
    link,
    expiresAt: Date.now() + 30 * 60 * 1000,
  };

  res.json({ code: sessionId });
});

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

app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

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

// Clean expired sessions
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) delete sessions[code];
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});