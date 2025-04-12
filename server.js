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
app.use(cors({ origin: "https://airbridge-gamma.vercel.app", methods: ["GET", "POST"] }));

app.use(express.json());
app.use(express.static('public'));

// Memory store for uploaded sessions
const sessions = {};

// Storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.headers['x-session-id'] || generateCode();
    const uploadDir = path.join(__dirname, 'uploads', sessionId);
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const upload = multer({ storage });

// Helpers
const generateCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

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


// Upload Endpoint
app.post('/upload', (req, res, next) => {
  const contentType = req.headers['content-type'];

  if (contentType && contentType.startsWith('multipart/form-data')) {
    // Use multer only if files are uploaded
    upload.any()(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: 'Upload failed', error: err.message });
      }
      return handleUpload(req, res);
    });
  } else {
    // No files, just text or link
    express.urlencoded({ extended: true })(req, res, () => handleUpload(req, res));
  }
});

async function handleUpload(req, res) {
  const sessionId = req.headers['x-session-id'] || generateCode();
  const uploadDir = path.join(__dirname, 'uploads', sessionId);
  fs.mkdirSync(uploadDir, { recursive: true });

  // Save text or link if provided
  const text = req.body.text || '';
  const link = req.body.link ? `Link: ${req.body.link}` : '';
  if (text || link) {
    fs.writeFileSync(path.join(uploadDir, 'note.txt'), `${text}\n${link}`);
  }

  // Save uploaded files if any
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const dest = path.join(uploadDir, file.originalname);
      fs.renameSync(file.path, dest);
    }
  }

  const zipPath = path.join(__dirname, 'uploads', `${sessionId}.zip`);

  try {
    await createZip(uploadDir, zipPath);
    sessions[sessionId] = {
      zipPath,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    res.json({ code: sessionId, message: 'Uploaded successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to zip and store files.' });
  }
}




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
  const sessionDir = path.join(__dirname, 'uploads', code);
  const textFile = path.join(sessionDir, 'note.txt');

  if (fs.existsSync(textFile)) {
    const data = fs.readFileSync(textFile, 'utf-8');
    return res.json({ content: data });
  }

  return res.status(404).json({ message: 'No text or link found' });
});

// Cleanup expired sessions (optional: run every 10 mins)
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      const zip = sessions[code].zipPath;
      const dir = path.join(__dirname, 'uploads', code);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.unlinkSync(zip);
      } catch (e) {}
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});