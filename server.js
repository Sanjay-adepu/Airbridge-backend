const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');
const B2 = require('backblaze-b2'); 

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ['http://localhost:5173', 'https://airbridge-gamma.vercel.app'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// 🔐 B2 credentials
const b2 = new B2({
  applicationKeyId: '005519a4923b56a0000000001',
  applicationKey: 'K005cQ5tUoYTHFRb3ZMqf6W9zexyMNA'
});

const BUCKET_NAME = 'droplin'; // 🔁 Change to your actual bucket name
let b2AuthTime = 0;
let b2Authorized = false;

// 🔁 Authorize B2 once every 30 minutes
async function authorizeB2() {
  if (!b2Authorized || Date.now() - b2AuthTime > 1000 * 60 * 30) {
    await b2.authorize();
    b2AuthTime = Date.now();
    b2Authorized = true;
  }
}

// 🧠 In-memory session store
const sessions = {};

// 🔑 Generate 6-digit alphanumeric code
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

// ✅ Upload metadata endpoint (text + file URLs)
app.post('/upload', async (req, res) => {
  const sessionId = generateCode();
  const { files = [], text = '', link = '' } = req.body;

  sessions[sessionId] = {
    files,
    text,
    link,
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
  };

  res.json({ code: sessionId, message: 'Upload registered' });
});

// ✅ ZIP Download endpoint
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

// ✅ QR Code generator
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// ✅ Preview metadata
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

// ✅ Get B2 upload URL for frontend
app.post('/b2-get-upload-url', async (req, res) => {
  const { fileName, contentType } = req.body;

  try {
    await authorizeB2();

    // Get bucket ID by name
    const { data: bucketList } = await b2.listBuckets();
    const bucket = bucketList.buckets.find(b => b.bucketName === BUCKET_NAME);

    if (!bucket) {
      return res.status(400).json({ message: 'Bucket not found' });
    }

    const bucketId = bucket.bucketId;

    // Get upload URL
    const { data: uploadData } = await b2.getUploadUrl({ bucketId });

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

// ✅ Auto-delete expired sessions every 10 minutes
setInterval(() => {
  for (const code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000);

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});