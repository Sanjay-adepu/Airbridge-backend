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

// MEGA credentials
const megaEmail = 'adepusanjay444@gmail.com';
const megaPassword = 'Sanjay444@';

app.use(cors({ origin: "https://airbridge-gamma.vercel.app", methods: ["GET", "POST"] }));
app.use(express.json());
app.use(express.static('public'));

// Memory store for sessions
const sessions = {};

// Helpers
const generateCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

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

// Upload to MEGA
const uploadToMega = (zipPath, sessionId, res) => {
  mega({ email: megaEmail, password: megaPassword }, (err, storage) => {
    if (err) {
      console.error('MEGA login failed:', err);
      return res.status(500).json({ message: 'Failed to log into MEGA' });
    }

    const fileStream = fs.createReadStream(zipPath);
    const uploadedFile = storage.upload(path.basename(zipPath), fileStream);

    uploadedFile.on('complete', () => {
      const megaFileUrl = uploadedFile.link;

      sessions[sessionId] = {
        zipPath,
        megaFileUrl,
        expiresAt: Date.now() + 30 * 60 * 1000,
      };

      res.json({
        code: sessionId,
        message: 'Files uploaded and zipped successfully',
        megaFileUrl,
      });
    });

    uploadedFile.on('error', err => {
      console.error('MEGA upload failed:', err);
      res.status(500).json({ message: 'Failed to upload file to MEGA' });
    });
  });
};

// Multer setup
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
    // Optional text + link note
    if (req.body.text || req.body.link) {
      const textContent = req.body.text || '';
      const linkContent = req.body.link ? `Link: ${req.body.link}` : '';
      fs.writeFileSync(path.join(uploadDir, 'note.txt'), `${textContent}\n${linkContent}`);
    }

    // Check if files exist
    const uploadedFiles = fs.readdirSync(uploadDir);
    if (uploadedFiles.length === 0) {
      return res.status(400).json({ message: 'No files to zip.' });
    }

    const zipPath = path.join(__dirname, 'uploads', `${sessionId}.zip`);
    await createZip(uploadDir, zipPath);

    console.log('Zipping completed. Starting MEGA upload...');
    uploadToMega(zipPath, sessionId, res);

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Failed to zip and store files.' });
  }
});

// QR Code generator
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

// Redirect to MEGA link
app.get('/download/:code', (req, res) => {
  const code = req.params.code;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  res.redirect(session.megaFileUrl);
});

// Clean up expired sessions every 10 mins
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      const zip = sessions[code].zipPath;
      const dir = path.join(__dirname, 'uploads', code);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.unlinkSync(zip);
      } catch (e) {
        console.warn(`Failed to clean up for session ${code}`, e);
      }
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});