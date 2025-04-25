const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const QRCode = require('qrcode');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ["https://airbridge-gamma.vercel.app", "http://localhost:5173"],
  methods: ["GET", "POST"]
}));
app.use(express.json());

cloudinary.config({
  cloud_name: 'dppiuypop',
  api_key: '412712715735329',
  api_secret: 'm04IUY0-awwtr4YoS-1xvxOOIzU'
});

// Memory store for uploaded sessions
const sessions = {};

const storage = multer.memoryStorage();
const upload = multer({ storage });

const generateCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

const uploadToCloudinary = (buffer, filename) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'auto', public_id: `uploads/${filename}` },
      (error, result) => {
        if (result) resolve(result.secure_url);
        else reject(error);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
};

app.post('/upload', upload.array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || generateCode();
  const uploadedUrls = [];

  try {
    for (const file of req.files) {
      const url = await uploadToCloudinary(file.buffer, file.originalname);
      uploadedUrls.push(url);
    }

    let note = '';
    if (req.body.text) note += req.body.text + '\n';
    if (req.body.link) note += `Link: ${req.body.link}`;

    if (note.trim()) {
      const noteBuffer = Buffer.from(note, 'utf-8');
      const noteUrl = await uploadToCloudinary(noteBuffer, `${sessionId}-note`);
      uploadedUrls.push(noteUrl);
    }

    sessions[sessionId] = {
      urls: uploadedUrls,
      expiresAt: Date.now() + 30 * 60 * 1000
    };

    res.json({ code: sessionId, message: 'Uploaded successfully', urls: uploadedUrls });

  } catch (err) {
    res.status(500).json({ message: 'Cloudinary upload failed', error: err.message });
  }
});

app.get('/qrcode/:code', async (req, res) => {
  const { code } = req.params;
  const url = `https://airbridge-gamma.vercel.app/download/${code}`;
  const qr = await QRCode.toDataURL(url);
  res.json({ qr });
});

app.get('/download/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }
  res.json({ urls: session.urls });
});

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