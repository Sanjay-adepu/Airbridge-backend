const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const cors = require('cors');
const QRCode = require('qrcode');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 5000;

const SVC_ACCOUNT_PATH = path.join(__dirname, 'service-account.json');

app.use(cors({ origin: "https://airbridge-gamma.vercel.app", methods: ["GET", "POST"] }));
app.use(express.json());
app.use(express.static('public'));

const sessions = {};

const generateCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

const createZip = (folderPath, zipPath) => {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`Zip created: ${zipPath} (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on('error', err => reject(err));

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
};

// Authenticate with Google Drive
const auth = new google.auth.GoogleAuth({
  keyFile: SVC_ACCOUNT_PATH,
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});
const driveService = google.drive({ version: 'v3', auth });

// Upload to Google Drive
const uploadToGoogleDrive = async (zipPath, sessionId, res) => {
  try {
    const fileMetadata = {
      name: path.basename(zipPath),
    };
    const media = {
      mimeType: 'application/zip',
      body: fs.createReadStream(zipPath),
    };

    const result = await driveService.files.create({
      resource: fileMetadata,
      media,
      fields: 'id',
    });

    const fileId = result.data.id;

    // Make file public
    await driveService.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const downloadUrl = `https://drive.google.com/uc?id=${fileId}&export=download`;

    sessions[sessionId] = {
      zipPath,
      googleDriveUrl: downloadUrl,
      expiresAt: Date.now() + 30 * 60 * 1000,
    };

    res.json({
      code: sessionId,
      message: 'Files uploaded and zipped successfully',
      googleDriveUrl: downloadUrl,
    });

  } catch (error) {
    console.error('Google Drive upload error:', error);
    res.status(500).json({ message: 'Failed to upload to Google Drive' });
  }
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
    if (req.body.text || req.body.link) {
      const textContent = req.body.text || '';
      const linkContent = req.body.link ? `Link: ${req.body.link}` : '';
      fs.writeFileSync(path.join(uploadDir, 'note.txt'), `${textContent}\n${linkContent}`);
    }

    const uploadedFiles = fs.readdirSync(uploadDir);
    if (uploadedFiles.length === 0) {
      return res.status(400).json({ message: 'No files to zip.' });
    }

    const zipPath = path.join(__dirname, 'uploads', `${sessionId}.zip`);
    await createZip(uploadDir, zipPath);

    console.log('Zipping completed. Uploading to Google Drive...');
    await uploadToGoogleDrive(zipPath, sessionId, res);

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
    const qr = await QRCode.toDataURL(session.googleDriveUrl);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// Redirect to Drive
app.get('/download/:code', (req, res) => {
  const code = req.params.code;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  res.redirect(session.googleDriveUrl);
});

// Clean-up
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      const zip = sessions[code].zipPath;
      const dir = path.join(__dirname, 'uploads', code);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.unlinkSync(zip);
      } catch (e) {
        console.warn(`Cleanup failed for session ${code}`, e);
      }
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});