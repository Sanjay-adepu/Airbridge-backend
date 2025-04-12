const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mega = require('mega');
const archiver = require('archiver');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 5000;

// Setup
app.use(cors({ origin: "https://airbridge-gamma.vercel.app", methods: ["GET", "POST"] }));

app.use(express.json());
app.use(express.static('public'));

// MEGA Login
const megaClient = mega({ email: 'adepusanjay444@gmail.com', password: 'Sanjay444@' });

// Memory store for uploaded sessions
const sessions = {};

// Helper to create a zip (you can still use this if needed for multi-file uploads)
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
app.post('/upload', multer().array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || generateCode();

  // Create a temporary directory to hold the files
  const uploadDir = path.join(__dirname, 'uploads', sessionId);
  fs.mkdirSync(uploadDir, { recursive: true });

  // Save note if provided
  if (req.body.text || req.body.link) {
    const textContent = req.body.text || '';
    const linkContent = req.body.link ? `Link: ${req.body.link}` : '';
    fs.writeFileSync(path.join(uploadDir, 'note.txt'), `${textContent}\n${linkContent}`);
  }

  try {
    // Upload files to MEGA
    const files = req.files;
    const megaFolder = megaClient.root; // You can choose a different folder in MEGA if needed
    const fileUploadPromises = files.map((file) => {
      return new Promise((resolve, reject) => {
        megaClient.upload(file.buffer, megaFolder, (error, fileInfo) => {
          if (error) {
            reject(error);
          } else {
            resolve(fileInfo);
          }
        });
      });
    });

    // Wait for all files to upload to MEGA
    const uploadedFiles = await Promise.all(fileUploadPromises);

    sessions[sessionId] = {
      uploadedFiles,
      expiresAt: Date.now() + 30 * 60 * 1000, // valid for 30 minutes
    };

    res.json({ code: sessionId, message: 'Files uploaded successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to upload files to MEGA.' });
  }
});

// Get QR Code for a code
app.get('/qrcode/:code', async (req, res) => {
  const { code } = req.params;
  const url = `https://airbridge-backend.onrender.com/download/${code}`; // Adjust URL accordingly
  const qr = await QRCode.toDataURL(url);
  res.json({ qr });
});

// Download by code (you can also link to MEGA file directly)
app.get('/download/:code', (req, res) => {
  const code = req.params.code;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  // Download the files from MEGA (you can return a direct download link to the user)
  const fileLinks = session.uploadedFiles.map(file => file.downloadUrl);
  res.json({ files: fileLinks });
});

// Cleanup expired sessions (optional: run every 10 minutes)
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});