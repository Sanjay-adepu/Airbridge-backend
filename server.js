// ✅ server.js (Backend) const express = require('express'); const cors = require('cors'); const QRCode = require('qrcode'); const axios = require('axios'); const archiver = require('archiver');

const app = express(); const PORT = process.env.PORT || 5000;

app.use(cors({ origin: ['http://localhost:5173', 'https://airbridge-gamma.vercel.app'], credentials: true })); app.use(express.json({ limit: '10mb' }));

const sessions = {};

function generateCode() { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let code; do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (sessions[code]); return code; }

// ✅ Upload endpoint (only metadata) app.post('/upload', async (req, res) => { try { const { files, text, link } = req.body; const code = generateCode();

sessions[code] = {
  files,
  text: text || '',
  link: link || '',
  expiresAt: Date.now() + 2 * 60 * 1000
};

res.json({ code });

} catch (err) { console.error('Upload error:', err.message); res.status(500).json({ message: 'Upload failed' }); } });

// ✅ QR Code route app.get('/qrcode/:code', async (req, res) => { const url = https://airbridge-backend.vercel.app/preview/${req.params.code}; try { const qr = await QRCode.toDataURL(url); res.json({ qr }); } catch (err) { res.status(500).json({ message: 'QR generation failed' }); } });

// ✅ Preview route app.get('/preview/:code', (req, res) => { const session = sessions[req.params.code]; if (!session || Date.now() > session.expiresAt) return res.status(404).json({ message: 'Invalid or expired code' });

res.json(session); });

// ✅ Download ZIP app.get('/download/:code', async (req, res) => { const session = sessions[req.params.code]; if (!session || Date.now() > session.expiresAt) return res.status(404).json({ message: 'Invalid or expired code' });

const archive = archiver('zip', { zlib: { level: 9 } }); res.attachment(${req.params.code}.zip); archive.pipe(res);

for (const file of session.files) { try { const response = await axios.get(file.url, { responseType: 'stream' }); archive.append(response.data, { name: file.name }); } catch (err) { console.error(Error downloading ${file.name}:, err.message); } }

archive.finalize(); });

setInterval(() => { for (const code in sessions) { if (Date.now() > sessions[code].expiresAt) delete sessions[code]; } }, 60000);

app.listen(PORT, () => console.log(✅ Server running on port ${PORT}));

