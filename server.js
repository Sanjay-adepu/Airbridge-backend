const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');

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

// UploadThing token (do not expose this to frontend)
const UPLOADTHING_TOKEN = 'eyJhcGlLZXkiOiJza19saXZlXzY3Nzc0NDMyZmI4YmY4ZWRiODdkMTYwZGMzZGY5ZTRhNGM5ZjA3OGI4MzRkNjgwZjMyMmJjOWE2MTIwMzJmM2UiLCJhcHBJZCI6InJnMDdnbmtrbzYiLCJyZWdpb25zIjpbInNlYTEiXX0=';

// In-memory session store
const sessions = {};

// Generate random 6-character code
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  } while (sessions[code]);
  return code;
}

// UploadThing file deletion
const deleteUploadThingFile = async (fileKey) => {
  try {
    await axios.post(
      'https://uploadthing.com/api/deleteFile',
      { fileKey },
      {
        headers: {
          Authorization: `Bearer ${UPLOADTHING_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Deleted file: ${fileKey}`);
  } catch (err) {
    console.error(`Failed to delete file ${fileKey}:`, err.response?.data || err.message);
  }
};

// Save session info from frontend
app.post('/save', (req, res) => {
  const { files, text, link } = req.body;
  const code = generateCode();
  sessions[code] = {
    files: files.map(f => ({
      url: f.url,
      name: f.name,
      type: f.type,
      key: f.key // for UploadThing deletion
    })),
    text: text || '',
    link: link || '',
    expiresAt: Date.now() + 30 * 60 * 1000, // 30 mins
  };
  res.json({ code });
});

// Download ZIP
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
    } catch (e) {
      console.error('Error downloading:', file.name, e.message);
    }
  }

  archive.finalize();
});

// QR code
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch {
    res.status(500).json({ message: 'Failed to generate QR' });
  }
});

// Preview
app.get('/preview/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }
  res.json({ files: session.files, text: session.text, link: session.link });
});

// Cleanup: delete expired sessions & files from UploadThing
setInterval(() => {
  for (let code in sessions) {
    const session = sessions[code];
    if (Date.now() > session.expiresAt) {
      // Delete files from UploadThing
      if (session.files?.length) {
        session.files.forEach(file => {
          if (file.key) deleteUploadThingFile(file.key);
        });
      }
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000); // Every 10 minutes

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));