const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 5000;

// Setup
app.use(cors());
app.use(express.json());

// Memory store for uploaded sessions
const sessions = {};

// Helpers
const generateCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const getUploadDir = (sessionId) => path.join('/tmp/uploads', sessionId);
const getZipPath = (sessionId) => path.join('/tmp/uploads', `${sessionId}.zip`);

const createZip = (folderPath, zipPath) => {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();

    output.on('close', () => resolve());
    archive.on('error', err => reject(err));
  });
};

// Storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.headers['x-session-id'] || generateCode();
    const uploadDir = getUploadDir(sessionId);
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const upload = multer({ storage });

// Upload Endpoint
app.post('/upload', upload.array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || generateCode();
  const uploadDir = getUploadDir(sessionId);
  fs.mkdirSync(uploadDir, { recursive: true });

  // Save note
  if (req.body.text || req.body.link) {
    const textContent = req.body.text || '';
    const linkContent = req.body.link ? `Link: ${req.body.link}` : '';
    fs.writeFileSync(path.join(uploadDir, 'note.txt'), `${textContent}\n${linkContent}`);
  }

  const zipPath = getZipPath(sessionId);

  try {
    await createZip(uploadDir, zipPath);

    sessions[sessionId] = {
      zipPath,
      expiresAt: Date.now() + 30 * 60 * 1000, // valid for 30 minutes
    };

    res.json({ code: sessionId, message: 'Files uploaded successfully' });
  } catch (err) {
    console.error('Zip Error:', err);
    res.status(500).json({ message: 'Failed to zip and store files.' });
  }
});

// Get QR Code for a code
app.get('/qrcode/:code', async (req, res) => {
  const { code } = req.params;
  const url = `https://airbridge-backend.onrender.com/download/${code}`;
  const qr = await QRCode.toDataURL(url);
  res.json({ qr });
});

// Download by code
app.get('/download/:code', (req, res) => {
  const code = req.params.code;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  res.download(session.zipPath);
});

// Preview text or link
app.get('/preview/:code', (req, res) => {
  const code = req.params.code;
  const sessionDir = getUploadDir(code);
  const textFile = path.join(sessionDir, 'note.txt');

  if (fs.existsSync(textFile)) {
    const data = fs.readFileSync(textFile, 'utf8');
    return res.json({ text: data });
  }

  return res.status(404).json({ message: 'No text or link found' });
});

// Cleanup expired sessions (every 10 minutes)
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      const zip = sessions[code].zipPath;
      const dir = getUploadDir(code);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.unlinkSync(zip);
      } catch (e) {
        console.error('Error during cleanup:', e);
      }
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000); // 10 minutes

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});