// ✅ BACKEND: server.js using Express and Firebase Admin SDK with Auto Delete const express = require('express'); const cors = require('cors'); const QRCode = require('qrcode'); const archiver = require('archiver'); const axios = require('axios');

// ✅ Firebase Admin SDK const admin = require('firebase-admin'); const serviceAccount = require('./firebase-service-account.json'); // Download from Firebase Console

admin.initializeApp({ credential: admin.credential.cert(serviceAccount), storageBucket: "droplin-89156.appspot.com" });

const bucket = admin.storage().bucket();

const app = express(); const PORT = process.env.PORT || 5000;

app.use(cors({ origin: ['http://localhost:5173', 'https://airbridge-gamma.vercel.app'], methods: ['GET', 'POST'], credentials: true })); app.use(express.json());

// 🧠 In-memory session store const sessions = {};

function generateCode() { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let code; do { code = Array.from({ length: 6 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join(''); } while (sessions[code]); return code; }

// ✅ Upload registration with file path tracking app.post('/upload', async (req, res) => { const sessionId = generateCode(); const { files = [], text = '', link = '' } = req.body;

const enrichedFiles = files.map(f => ({ ...f, path: f.url.split('/o/')[1]?.split('?')[0], uploadedAt: Date.now() }));

sessions[sessionId] = { files: enrichedFiles, text, link, expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes };

res.json({ code: sessionId, message: 'Upload registered' }); });

// ✅ Download ZIP endpoint app.get('/download/:code', async (req, res) => { const session = sessions[req.params.code]; if (!session || Date.now() > session.expiresAt) return res.status(404).json({ message: 'Invalid or expired code' });

const archive = archiver('zip', { zlib: { level: 9 } }); res.attachment(${req.params.code}.zip); archive.pipe(res);

for (const file of session.files) { try { const response = await axios.get(file.url, { responseType: 'stream' }); archive.append(response.data, { name: file.name }); } catch (err) { console.error('ZIP error:', err.message); } }

archive.finalize(); });

// ✅ QR Code endpoint app.get('/qrcode/:code', async (req, res) => { const url = https://airbridge-backend.vercel.app/preview/${req.params.code}; try { const qr = await QRCode.toDataURL(url); res.json({ qr }); } catch (err) { res.status(500).json({ message: 'QR generation failed' }); } });

// ✅ Preview endpoint app.get('/preview/:code', (req, res) => { const session = sessions[req.params.code]; if (!session || Date.now() > session.expiresAt) return res.status(404).json({ message: 'Invalid or expired code' });

res.json({ files: session.files, text: session.text, link: session.link }); });

// ✅ Firebase delete utility async function deleteFirebaseFile(path) { try { await bucket.file(decodeURIComponent(path)).delete(); console.log(🗑️ Deleted: ${path}); } catch (err) { console.error(⚠️ Failed to delete ${path}:, err.message); } }

// ✅ Periodic cleanup every 1 minute setInterval(async () => { const now = Date.now(); for (const code in sessions) { const session = sessions[code]; if (now > session.expiresAt) { for (const file of session.files || []) { if (file.path) await deleteFirebaseFile(file.path); } delete sessions[code]; console.log(♻️ Session ${code} expired and cleaned up.); } } }, 1 * 60 * 1000);

// ✅ Start server app.listen(PORT, () => { console.log(✅ Server running on port ${PORT}); });

