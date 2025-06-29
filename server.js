const express = require('express');
const cors = require('cors');
const multer = require('multer');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// ✅ Supabase Config
const supabase = createClient(
  'https://ahqwlfgoxmepucldmpyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocXdsZmdveG1lcHVjbGRtcHljIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTE3MDQ4OCwiZXhwIjoyMDY2NzQ2NDg4fQ.5jRexF8EgyBcg4kv5Z7mgypOeE3NPcVVskN7_LcTQL4'
);
const BUCKET = 'uploads';

const sessions = {};

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (sessions[code]);
  return code;
}

// ✅ Upload Endpoint (files/text/link)
app.post('/upload', upload.array('files'), async (req, res) => {
  const sessionId = generateCode();
  const uploadedFiles = [];

  for (const file of req.files || []) {
    const filePath = `${Date.now()}-${file.originalname}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (error) {
      console.error('Supabase upload error:', error.message);
      return res.status(500).json({ message: 'Upload failed', error });
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    uploadedFiles.push({ name: file.originalname, type: file.mimetype, url: data.publicUrl });
  }

  const text = req.body.text || '';
  const link = req.body.link || '';

  sessions[sessionId] = {
    files: uploadedFiles,
    text,
    link,
    expiresAt: Date.now() + 30 * 60 * 1000,
  };

  res.json({ code: sessionId, message: 'Upload successful' });
});

// ✅ Download ZIP
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

// ✅ QR code
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// ✅ Preview
app.get('/preview/:code', (req, res) => {
  const session = sessions[req.params.code];
  if (!session || Date.now() > session.expiresAt)
    return res.status(404).json({ message: 'Invalid or expired code' });

  res.json({
    files: session.files,
    text: session.text,
    link: session.link,
  });
});

// ✅ Cleanup expired sessions
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) delete sessions[code];
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});