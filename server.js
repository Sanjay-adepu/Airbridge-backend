const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const sessions = {};

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (sessions[code]);
  return code;
}

// ✅ Upload with UploadThing URLs
app.post('/upload', async (req, res) => {
  const { uploadedUrls = [], text = '', link = '' } = req.body;
  const sessionId = generateCode();

  const uploadedFiles = uploadedUrls.map(url => ({
    name: url.split('/').pop(),
    type: 'unknown',
    url,
  }));

  sessions[sessionId] = {
    files: uploadedFiles,
    text,
    link,
    expiresAt: Date.now() + 30 * 60 * 1000,
  };

  res.json({ code: sessionId, message: 'Upload successful' });
});

// ✅ QR Code
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
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

  res.json({
    files: session.files,
    text: session.text,
    link: session.link,
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
      console.error('ZIP error:', err.message);
    }
  }

  archive.finalize();
});

// ✅ Cleanup expired sessions
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) delete sessions[code];
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});