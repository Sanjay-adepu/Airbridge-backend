const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const cors = require('cors');
const QRCode = require('qrcode');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: "https://airbridge-gamma.vercel.app", methods: ["GET", "POST"] }));
app.use(express.json());
app.use(express.static('public'));

const sessions = {};

const generateCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

const createZip = (folderPath, zipPath) => {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`Zip created: ${zipPath} (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on('error', err => reject(err));
    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
};

// Google Drive Auth (inline service account)
const auth = new google.auth.GoogleAuth({
  credentials: {
    type: "service_account",
    project_id: "image-456803",
    private_key_id: "f76c3dd044564ec8a19e0a71b8819a3b3a331199",
    private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDEoCYLpcI9zx9h\nYROftgRMq4Go4/ZxAkrQR+tczEbKShGhfSqQc/SWaaezxSm9hhp/Wju90spUo6AO\naVcaFFMCwPRTxod+VU1ZJBPXbypI9W8Iawf08/V57KEuLCY0eJCqnRV3yryVgv+H\nsqY9UpF4DaCpFQaq4QE1kX70LkgFsd/+Zq9b9Vz1/5KCkDGMQTuTwadMySDKNuX0\neNzbbccB36Oo5tZxtAYi8MtPpDX2CHSeTNeviy0GttQ0OQXxInyMl7KdTy3AGtz2\nKrFXRhVfIe9PVB89jpQlddCB1nwRUhl86U2pY9OypZLgaFeiho3d8y2hmyqgV9nR\nXqy0UYd3AgMBAAECggEAUtz3C6OQh4HZRK2nmoAXscP5gZaIjjmcE8irXNFN6ARt\nB7R7EqN7aUQfg7hMje2NDyyUzrudvyux0UD9jyUPkrKEhSW+hjQmw7Fbl0fm9xZP\n86k/kjCZvAdIKfA7LZO9y9klafWLoiqxy5szSdaZLZH4qikNRUhLvSqS6Q70FUmS\nIBjE99Tx5E3RcYfbi3ybc5VETqHBLm6PJnRzOmQkmXE67yDbJxaA01BkYM0xuXLY\nlwbb6oEtKg56tlOYLmBCirfmSw/JogvIXCbmn1BApO5//K8iVlrb1yzht0ejLcbM\nQPZFv4XeQDSMLvc3VcuNVGOlZz8SsO7ovpd9EXc/wQKBgQD2aWSmvLGRO/NatGU6\nTFx5BRdlPU1AvfVo8Jc97Do8TnLNrIKrJv2fpQsX8g+FHfOA5XDA/9uWvyHpxLNS\nyY3jSpZ6h37F5gP0yxhYvMQrauDJ6OZJoax9DTdnndiSl6GEsMcm/zG9xVNcCFxA\nSwrFACJJ/1pxVQy9BVFPTquj4QKBgQDMRtDXtEKHTQKXAPpEEVWG6N04TRp/O0xd\nXugME/7poNxnMyBmpqLctccnJuEXEzGx3f8R/if+gdTPGmvAURxVmo54D2FzFARK\ngOQH9h+NRZkETIMISYRlxP4MA48IPpmopP6wywep4xltySOV036JT0JfCsGU7o07\nKrkyRNeWVwKBgGr/tO8aPNjd+XxHnTVFd1ottc0GY4dbdTdOUb5X16ncPsnEwTDk\ny3kJR9nsCIU7TkOIXf/Qml/JO0axXVTzpKMv/kvSjmAM02b20emmfmCEFnxWn7kV\ndTsQBCEAT8zH/yEJSlFKuyS2jM4H61cXvuNwfXM4aOORlOh3aKlRdgLBAoGAKjKO\nvaBNBeoQmOTozdrO0hmUaSb0TEgRlFAgmy4eQGCsZt0W2l2d0v3x79KGOOAMKfPz\n1uGrnVVwgn+wtn+K3Nwahg6XUNBXupQ5hrN+/Q3deBfeEX4uTV+OIykxCMD1uPKs\nchTetmdlP1qHcVHJF9A5o6xzJLLKlehTbWDvL+0CgYEAgEgYDVgw8LP6CyEfducW\nba05KdonrH9SHCOxbDoXTA04UYivWDTcz6dfpD9smxzO4GKq4ncqbPjl6VT3gXaV\niougmYelyDYAyBclnXXEh2yR+l4vZRkm6LyB80ApNycLMnxfo96Fs25lLvely6DR\nw+76cwPPSiCj7ry5ewzhqak=\n-----END PRIVATE KEY-----\n",
    client_email: "airbridge@image-456803.iam.gserviceaccount.com",
    client_id: "116554494355260770277",
  },
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});
const driveService = google.drive({ version: 'v3', auth });

// Upload to Drive
const uploadToGoogleDrive = async (zipPath, sessionId, res) => {
  try {
    const fileMetadata = { name: path.basename(zipPath) };
    const media = {
      mimeType: 'application/zip',
      body: fs.createReadStream(zipPath),
    };

    const result = await driveService.files.create({
      resource: fileMetadata,
      media,
      fields: 'id',
    });

    const fileId = result.data.id;

    await driveService.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const downloadUrl = `https://drive.google.com/uc?id=${fileId}&export=download`;

    sessions[sessionId] = {
      zipPath,
      googleDriveUrl: downloadUrl,
      expiresAt: Date.now() + 30 * 60 * 1000,
    };

    res.json({
      code: sessionId,
      message: 'Files uploaded and zipped successfully',
      googleDriveUrl: downloadUrl,
    });

  } catch (error) {
    console.error('Google Drive upload error:', error);
    res.status(500).json({ message: 'Failed to upload to Google Drive' });
  }
};

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.headers['x-session-id'] || generateCode();
    const uploadDir = path.join(__dirname, 'uploads', sessionId);
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Upload endpoint
app.post('/upload', upload.array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || generateCode();
  const uploadDir = path.join(__dirname, 'uploads', sessionId);
  fs.mkdirSync(uploadDir, { recursive: true });

  try {
    if (req.body.text || req.body.link) {
      const textContent = req.body.text || '';
      const linkContent = req.body.link ? `Link: ${req.body.link}` : '';
      fs.writeFileSync(path.join(uploadDir, 'note.txt'), `${textContent}\n${linkContent}`);
    }

    const uploadedFiles = fs.readdirSync(uploadDir);
    if (uploadedFiles.length === 0) {
      return res.status(400).json({ message: 'No files to zip.' });
    }

    const zipPath = path.join(__dirname, 'uploads', `${sessionId}.zip`);
    await createZip(uploadDir, zipPath);

    console.log('Zipping completed. Uploading to Google Drive...');
    await uploadToGoogleDrive(zipPath, sessionId, res);

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Failed to zip and store files.' });
  }
});

// QR Code endpoint
app.get('/qrcode/:code', async (req, res) => {
  const { code } = req.params;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  try {
    const qr = await QRCode.toDataURL(session.googleDriveUrl);
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ message: 'QR generation failed' });
  }
});

// Download redirect
app.get('/download/:code', (req, res) => {
  const code = req.params.code;
  const session = sessions[code];

  if (!session || Date.now() > session.expiresAt) {
    return res.status(404).json({ message: 'Invalid or expired code' });
  }

  res.redirect(session.googleDriveUrl);
});

// Clean expired sessions
setInterval(() => {
  for (let code in sessions) {
    if (Date.now() > sessions[code].expiresAt) {
      const zip = sessions[code].zipPath;
      const dir = path.join(__dirname, 'uploads', code);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.unlinkSync(zip);
      } catch (e) {
        console.warn(`Cleanup failed for session ${code}`, e);
      }
      delete sessions[code];
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});