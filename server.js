const express = require('express');
const multer = require('multer');
const cors = require('cors');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Cloudinary Configuration
cloudinary.config({
  cloud_name: "dg6eufdce",
  api_key: "515743163455136",
  api_secret: "0C88e38P3JqkVrIdwExy26xHe18"
});

// Multer Cloudinary Storage - allow all file types
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: 'uploads',
    resource_type: 'auto',
    public_id: `${Date.now()}-${file.originalname}`,
  }),
});
const upload = multer({ storage });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// In-memory sessions
const sessions = {};

// Upload Endpoint
app.post('/upload', upload.array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || uuidv4();
  const uploadedFiles = req.files.map(file => ({
    url: file.path,
    type: file.mimetype,
    name: file.originalname,
  }));

  const text = req.body.text || '';
  const link = req.body.link || '';

  sessions[sessionId] = {
    files: uploadedFiles,
    text,
    link,
    expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
  };

  res.json({ code: sessionId, message: 'Uploaded to Cloudinary successfully' });
});

// Generate QR Code
app.get('/qrcode/:code', async (req, res) => {
  const { code } = req.params;
  const url = `https://airbridge-backend.vercel.app/preview/${code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'Failed to generate QR code' });
  }
});

// Preview Files/Text/Link
app.get('/preview/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  res.json({
    files: session.files || [],
    text: session.text,
    link: session.link,
  });
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