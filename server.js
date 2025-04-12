const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const cors = require('cors');
const QRCode = require('qrcode');
const mega = require('mega');

const app = express();
const PORT = process.env.PORT || 5000;

// MEGA credentials (replace with your own credentials)
const megaEmail = 'adepusanjay444@gmail.com';
const megaPassword = 'Sanjay444@';

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
app.post('/upload', upload.array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || generateCode();
  const uploadDir = path.join(__dirname, 'uploads', sessionId);
  fs.mkdirSync(uploadDir, { recursive: true });

  // Save note
  if (req.body.text || req.body.link) {
    const textContent = req.body.text || '';
    const linkContent = req.body.link ? `Link: ${req.body.link}` : '';
    fs.writeFileSync(path.join(uploadDir, 'note.txt'), `${textContent}\n${linkContent}`);
  }

  const zipPath = path.join(__dirname, 'uploads', `${sessionId}.zip`);

  try {
    await createZip(uploadDir, zipPath);

    // Initialize MEGA client
    const client = mega({ email: megaEmail, password: megaPassword });

    // Upload the zip file to MEGA
    client.upload(zipPath, (err, file) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to upload file to MEGA' });
      }

      // Save the MEGA file URL
      sessions[sessionId] = {
        zipPath, 
        megaFileUrl: file.link, // URL to download the file from MEGA
        expiresAt: Date.now() + 30 * 60 * 1000 // valid for 30 minutes
      };

      res.json({ 
        code: sessionId, 
        message: 'Files uploaded successfully', 
        megaFileUrl: file.link
      });
    });

  } catch (err) {
    res.status(500).json({ message: 'Failed to zip and store files.' });
  }
});

// Get QR Code for a code
app.get('/qrcode/:code', async (req, res) => {
  const { code } = req.params;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  const qr = await QRCode.toDataURL(session.megaFileUrl);
  res.json({ qr });
});

// Download by code
app.get('/download/:code', (req, res) => {
  const code = req.params.code;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  // Redirect to MEGA file download link
  res.redirect(session.megaFileUrl);
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