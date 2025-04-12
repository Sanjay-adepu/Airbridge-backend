const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mega = require('mega');
const archiver = require('archiver');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: "https://airbridge-gamma.vercel.app", methods: ["GET", "POST"] }));
app.use(express.json());
app.use(express.static('public'));

// Temporary session memory
const sessions = {};

// Function to generate download codes
const generateCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// Function to login to MEGA
const loginToMega = ({ email, password }) => {
  return new Promise((resolve, reject) => {
    const storage = mega({ email, password }, err => {
      if (err) return reject(err);
      resolve(storage);
    });
  });
};

// Upload Endpoint
app.post('/upload', multer().array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || generateCode();
  const uploadDir = path.join(__dirname, 'uploads', sessionId);
  fs.mkdirSync(uploadDir, { recursive: true });

  if (req.body.text || req.body.link) {
    const textContent = req.body.text || '';
    const linkContent = req.body.link ? `Link: ${req.body.link}` : '';
    fs.writeFileSync(path.join(uploadDir, 'note.txt'), `${textContent}\n${linkContent}`);
  }

  try {
    const megaClient = await loginToMega({
      email: 'adepusanjay444@gmail.com',
      password: 'Sanjay444@'
    });

    const files = req.files;
    const fileUploadPromises = files.map((file) => {
      return new Promise((resolve, reject) => {
        const uploadStream = megaClient.upload({ name: file.originalname, size: file.size }, err => {
          if (err) return reject(err);
        });

        uploadStream.end(file.buffer);
        uploadStream.on('complete', resolve);
        uploadStream.on('error', reject);
      });
    });

    const uploadedFiles = await Promise.all(fileUploadPromises);

    sessions[sessionId] = {
      uploadedFiles,
      expiresAt: Date.now() + 30 * 60 * 1000, // valid for 30 minutes
    };

    res.json({ code: sessionId, message: 'Files uploaded successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to upload files to MEGA.' });
  }
});

// Get QR Code
app.get('/qrcode/:code', async (req, res) => {
  const { code } = req.params;
  const url = `https://airbridge-backend.onrender.com/download/${code}`;
  const qr = await QRCode.toDataURL(url);
  res.json({ qr });
});

// Download endpoint
app.get('/download/:code', (req, res) => {
  const code = req.params.code;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  const fileLinks = session.uploadedFiles.map(file => ({
    name: file.name,
    link: file.downloadUrl || `https://mega.nz/file/${file.handle}`
  }));

  res.json({ files: fileLinks });
});

// Cleanup expired sessions every 10 minutes
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