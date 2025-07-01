const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');
const multer = require('multer');
const B2 = require('backblaze-b2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ['http://localhost:5173', 'https://airbridge-gamma.vercel.app'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() }); // Multer for Postman uploads

// 🔐 B2 credentials
const b2 = new B2({
  applicationKeyId: '005519a4923b56a0000000001',
  applicationKey: 'K005cQ5tUoYTHFRb3ZMqf6W9zexyMNA'
});

const BUCKET_NAME = 'droplin';
let b2AuthTime = 0;
let b2Authorized = false;

async function authorizeB2() {
  if (!b2Authorized || Date.now() - b2AuthTime > 1000 * 60 * 30) {
    await b2.authorize();
    b2AuthTime = Date.now();
    b2Authorized = true;
  }
}

// 🧠 In-memory session store
const sessions = {};

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');
  } while (sessions[code]);
  return code;
}

app.post('/upload', async (req, res) => {
  const sessionId = generateCode();
  const { files = [], text = '', link = '' } = req.body;

  sessions[sessionId] = {
    files,
    text,
    link,
    expiresAt: Date.now() + 10 * 60 * 1000
  };

  res.json({ code: sessionId, message: 'Upload registered' });
});

app.get('/download/:code', async (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt)
    return res.status(404).json({ message: 'Invalid or expired code' });

  const archive = archiver('zip', { zlib: { level: 9 } });
  res.attachment(`${req.params.code}.zip`);
  archive.pipe(res);

  for (const file of session.files) {
    try {
      const response = await axios.get(file.url, { responseType: 'stream' });
      archive.append(response.data, { name: file.name });
    } catch (err) {
      console.error('ZIP error:', err.message);
    }
  }

  archive.finalize();
});

app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

app.get('/preview/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt)
    return res.status(404).json({ message: 'Invalid or expired code' });

  res.json({
    files: session.files,
    text: session.text,
    link: session.link
  });
});

// ✅ /b2-get-upload-url (for frontend usage)
app.post('/b2-get-upload-url', async (req, res) => {
  const { fileName, contentType } = req.body;

  try {
    await authorizeB2();

    const { data: bucketList } = await b2.listBuckets();
    const bucket = bucketList.buckets.find(b => b.bucketName === BUCKET_NAME);
    if (!bucket) return res.status(400).json({ message: 'Bucket not found' });

    const { data: uploadData } = await b2.getUploadUrl({ bucketId: bucket.bucketId });
    const finalUrl = `https://f005.backblazeb2.com/file/${BUCKET_NAME}/${encodeURIComponent(fileName)}`;

    res.json({
      uploadUrl: uploadData.uploadUrl,
      authorizationToken: uploadData.authorizationToken,
      finalUrl
    });
  } catch (err) {
    console.error('B2 upload URL error:', err.message);
    res.status(500).json({ message: 'B2 upload URL error', error: err.message });
  }
});

// ✅ NEW: /b2 — Upload file directly using Postman (multipart/form-data)
app.post('/b2', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    await authorizeB2();

    const { data: bucketList } = await b2.listBuckets();
    const bucket = bucketList.buckets.find(b => b.bucketName === BUCKET_NAME);
    if (!bucket) return res.status(400).json({ message: 'Bucket not found' });

    const { data: uploadData } = await b2.getUploadUrl({ bucketId: bucket.bucketId });

    await axios.post(uploadData.uploadUrl, file.buffer, {
      headers: {
        Authorization: uploadData.authorizationToken,
        'X-Bz-File-Name': encodeURIComponent(file.originalname),
        'Content-Type': file.mimetype,
        'X-Bz-Content-Sha1': 'do_not_verify'
      }
    });

    // Instead of public URL, return a server-protected endpoint
    const privateAccessUrl = `https://airbridge-backend.vercel.app/b2-download/${encodeURIComponent(file.originalname)}`;

    res.json({
      message: 'File uploaded to private B2 bucket',
      fileName: file.originalname,
      url: privateAccessUrl
    });

  } catch (err) {
    console.error('B2 direct upload error:', err.message);
    res.status(500).json({ message: 'B2 direct upload failed', error: err.message });
  }
});




setInterval(() => {
  for (const code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});