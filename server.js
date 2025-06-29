const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const archiver = require('archiver');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: ['http://localhost:5173', 'https://airbridge-gamma.vercel.app'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// ✅ Supabase admin client
const supabase = createClient(
  
'https://ahqwlfgoxmepucldmpyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocXdsZmdveG1lcHVjbGRtcHljIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTE3MDQ4OCwiZXhwIjoyMDY2NzQ2NDg4fQ.5jRexF8EgyBcg4kv5Z7mgypOeE3NPcVVskN7_LcTQL4'


);

// 🧠 In-memory session store
const sessions = {};

// 🔑 Generate 6-character alphanumeric code
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

// ✅ Upload session registration
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

// ✅ ZIP download
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

// ✅ QR code preview
app.get('/qrcode/:code', async (req, res) => {
  const url = `https://airbridge-backend.vercel.app/preview/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// ✅ Preview endpoint
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

// ✅ Auto-delete Supabase bucket files (regardless of session) every 10 mins
setInterval(async () => {
  try {
    const { data: list, error: listError } = await supabase
      .storage
      .from('uploads')
      .list('', { limit: 1000 });

    if (listError) {
      console.error('❌ Failed to list files:', listError.message);
      return;
    }

    const pathsToDelete = list.map(file => file.name);
    if (pathsToDelete.length === 0) {
      console.log('ℹ️ No files to delete.');
      return;
    }

    const { error: deleteError } = await supabase
      .storage
      .from('uploads')
      .remove(pathsToDelete);

    if (deleteError) {
      console.error('❌ Failed to delete files:', deleteError.message);
    } else {
      console.log('✅ Deleted all files:', pathsToDelete);
    }
  } catch (err) {
    console.error('🔥 Unexpected error:', err.message);
  }

  // Also clear expired sessions
  for (const code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000); // every 10 minutes

// ✅ Optional manual delete trigger
app.get('/delete-all-uploads', async (req, res) => {
  try {
    const { data: list, error: listError } = await supabase
      .storage
      .from('uploads')
      .list('', { limit: 1000 });

    if (listError) return res.status(500).json({ message: 'List error', error: listError.message });

    const paths = list.map(file => file.name);
    if (paths.length === 0) return res.json({ message: 'No files to delete.' });

    const { error: deleteError } = await supabase.storage.from('uploads').remove(paths);
    if (deleteError) return res.status(500).json({ message: 'Delete error', error: deleteError.message });

    res.json({ message: 'Deleted all files', files: paths });
  } catch (err) {
    res.status(500).json({ message: 'Unexpected error', error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});