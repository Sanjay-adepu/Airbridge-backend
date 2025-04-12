const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mega = require('mega');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS
app.use(cors({
  origin: 'https://airbridge-gamma.vercel.app',
  methods: ['GET', 'POST'],
}));

app.use(express.json());
app.use(express.static('public'));

// Store temporary sessions in memory
const sessions = {};

// Generate unique code
const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// Login to MEGA
const loginToMega = ({ email, password }) => {
  return new Promise((resolve, reject) => {
    const storage = mega({ email, password }, err => {
      if (err) {
        console.error('MEGA login failed:', err);
        return reject(err);
      }
      resolve(storage);
    });
  });
};

// Upload route
app.post('/upload', multer().array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || generateCode();
  const uploadDir = path.join(__dirname, 'uploads', sessionId);
  fs.mkdirSync(uploadDir, { recursive: true });

  // Save text or link
  if (req.body.text || req.body.link) {
    const content = `${req.body.text || ''}\n${req.body.link ? `Link: ${req.body.link}` : ''}`;
    fs.writeFileSync(path.join(uploadDir, 'note.txt'), content);
  }

  try {
    const megaClient = await loginToMega({
      email: 'adepusanjay444@gmail.com',
      password: 'Sanjay444@'
    });

    const files = req.files || [];
    const fileUploadPromises = files.map(file => {
      return new Promise((resolve, reject) => {
        const uploadStream = megaClient.upload(file.originalname, file.size);
        uploadStream.end(file.buffer);

        uploadStream.on('complete', (fileInfo) => {
          resolve({
            name: fileInfo.name,
            handle: fileInfo.file,
            downloadUrl: `https://mega.nz/file/${fileInfo.file}`
          });
        });

        uploadStream.on('error', reject);
      });
    });

    const uploadedFiles = await Promise.all(fileUploadPromises);

    sessions[sessionId] = {
      uploadedFiles,
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
    };

    res.json({ code: sessionId, message: 'Files uploaded successfully' });
  } catch (err) {
    console.error('Upload failed:', err);
    res.status(500).json({ message: 'Failed to upload files to MEGA.' });
  }
});

// QR Code route
app.get('/qrcode/:code', async (req, res) => {
  const code = req.params.code;
  const url = `https://airbridge-backend.onrender.com/download/${code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'Failed to generate QR code' });
  }
});

// Download route
app.get('/download/:code', (req, res) => {
  const session = sessions[req.params.code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  const fileLinks = session.uploadedFiles.map(file => ({
    name: file.name,
    link: file.downloadUrl
  }));

  res.json({ files: fileLinks });
});

// Cleanup expired sessions every 10 mins
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});