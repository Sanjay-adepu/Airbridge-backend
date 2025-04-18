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

// MEGA credentials (use your actual credentials securely)
const megaEmail = 'adepusanjay444@gmail.com';
const megaPassword = 'Sanjay444@';

app.use(cors({ origin: "https://airbridge-gamma.vercel.app", methods: ["GET", "POST"] }));
app.use(express.json());
app.use(express.static('public'));

// Memory store for sessions
const sessions = {};

// Generate a random session code
const generateCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

// Create a zip file from a folder
const createZip = (folderPath, zipPath) => {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`Zip created successfully: ${zipPath} (${archive.pointer()} total bytes)`);
      resolve();
    });

    archive.on('error', err => {
      console.error('Archive error:', err);
      reject(err);
    });

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
};

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.headers['x-session-id'] || generateCode();
    const uploadDir = path.join(__dirname, 'uploads', sessionId);
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Upload endpoint
app.post('/upload', upload.array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || generateCode();
  const uploadDir = path.join(__dirname, 'uploads', sessionId);
  fs.mkdirSync(uploadDir, { recursive: true });

  try {
    // Save note if present
    if (req.body.text || req.body.link) {
      const textContent = req.body.text || '';
      const linkContent = req.body.link ? `Link: ${req.body.link}` : '';
      fs.writeFileSync(path.join(uploadDir, 'note.txt'), `${textContent}\n${linkContent}`);
    }

    // Check if files exist before zipping
    const uploadedFiles = fs.readdirSync(uploadDir);
    if (uploadedFiles.length === 0) {
      return res.status(400).json({ message: 'No files found to zip.' });
    }

    const zipPath = path.join(__dirname, 'uploads', `${sessionId}.zip`);
    await createZip(uploadDir, zipPath);

    console.log('Zipping completed. Starting MEGA upload...');

    // Upload to MEGA
    const client = mega({ email: megaEmail, password: megaPassword });
    client.upload(zipPath, (err, file) => {
      if (err) {
        console.error('MEGA upload failed:', err);
        return res.status(500).json({ message: 'Failed to upload file to MEGA' });
      }

      sessions[sessionId] = {
        zipPath,
        megaFileUrl: file.link,
        expiresAt: Date.now() + 30 * 60 * 1000,
      };

      res.json({
        code: sessionId,
        message: 'Files uploaded and zipped successfully',
        megaFileUrl: file.link
      });
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Failed to zip and store files.' });
  }
});

// QR Code endpoint
app.get('/qrcode/:code', async (req, res) => {
  const { code } = req.params;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  try {
    const qr = await QRCode.toDataURL(session.megaFileUrl);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'Failed to generate QR code' });
  }
});

// Download redirect
app.get('/download/:code', (req, res) => {
  const code = req.params.code;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  res.redirect(session.megaFileUrl);
});

// Cleanup expired sessions every 10 minutes
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      const zip = sessions[code].zipPath;
      const dir = path.join(__dirname, 'uploads', code);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.unlinkSync(zip);
      } catch (e) {
        console.warn(`Failed to delete session files for code: ${code}`, e);
      }
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});