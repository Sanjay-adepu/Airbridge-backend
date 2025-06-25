
import React, { useState } from 'react';
import './Upload.css';
import Navbar from "./Navbar/Navbar.jsx";
import axios from 'axios';

const UploadInterface = () => {
const [selectedType, setSelectedType] = useState('files');
const [fileInputMode, setFileInputMode] = useState('files');
const [files, setFiles] = useState([]);
const [text, setText] = useState('');
const [link, setLink] = useState('');
const [code, setCode] = useState('');
const [qrImage, setQrImage] = useState('');
const [isProcessing, setIsProcessing] = useState(false);

const handleSubmit = async () => {
setIsProcessing(true);
const formData = new FormData();

if (selectedType === 'files') {
if (files.length === 0) {
alert("Please select at least one file.");
setIsProcessing(false);
return;
}
files.forEach(file => formData.append('files', file));
} else if (selectedType === 'text') {
if (!text.trim()) {
alert("Please enter some text.");
setIsProcessing(false);
return;
}
formData.append('text', text);
} else if (selectedType === 'link') {
if (!link.trim()) {
alert("Please enter a link.");
setIsProcessing(false);
return;
}
formData.append('link', link);
}

try {
const response = await axios.post('https://airbridge-backend.vercel.app/upload', formData, {
headers: { 'Content-Type': 'multipart/form-data' },
});

setCode(response.data.code);

const qrRes = await axios.get(https://airbridge-backend.vercel.app/qrcode/${response.data.code});
setQrImage(qrRes.data.qr);
} catch (error) {
console.error('Upload error:', error);
alert("Upload failed. Please try again.");
} finally {
setIsProcessing(false);
}

};

return (
<>
<Navbar />

<div className="upload-container">        
    {!code ? (        
      <>        
        <div className="instructions">        
          <h2 style={{      fontSize: '1.5rem',
fontWeight: '700',
color: '#008edcfe',
textAlign: 'center',
marginTop: '3rem',
marginBottom: '2rem',
fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
lineHeight: '1.2',
letterSpacing: '-0.5px'
}}>How to Upload</h2>

<p>      
1. Select the type of data you want to upload: <strong>Files</strong>, <strong>Text</strong>, or <strong>Link</strong>.<br />      
2. Based on your selection, provide the required input and click <strong>Submit</strong>.      
</p>      
<p className="file-info">      
<strong>File Upload Info:</strong><br />      
- You can select <strong>multiple files</strong> or an entire <strong>folder</strong>.<br />      
- Supported types: <strong>Images, PDFs, PPTs, Word Docs, MP3s, MP4s, APKs</strong>, and more.      
</p>      
<hr />      
</div>      <div className="option-container">        
          {['files', 'text', 'link'].map((type) => (        
            <button        
              key={type}        
              onClick={() => setSelectedType(type)}        
              className={`option-btn ${selectedType === type ? 'active' : ''}`}        
            >        
              {type.charAt(0).toUpperCase() + type.slice(1)}        
            </button>        
          ))}        
        </div>        <div className="dynamic-field">        
      {selectedType === 'files' && (        
        <div className="file-upload-mode">        
          <div className="toggle-mode">        
            <label>        
              <input        
                type="radio"        
                value="files"        
                checked={fileInputMode === 'files'}        
                onChange={() => setFileInputMode('files')}        
              />        
              Select Files        
            </label>        
            <label>        
              <input        
                type="radio"        
                value="folder"        
                checked={fileInputMode === 'folder'}        
                onChange={() => setFileInputMode('folder')}        
              />        
              Select Folder        
            </label>        
          </div>        
          <input        
            type="file"        
            multiple        
            {...(fileInputMode === 'folder' ? { webkitdirectory: 'true', directory: '' } : {})}        
            onChange={(e) => setFiles(Array.from(e.target.files))}        
            className="input-field"        
          />        
        </div>        
      )}        
  
      {selectedType === 'text' && (        
        <textarea        
          rows="4"        
          placeholder="Enter your message..."        
          value={text}        
          onChange={(e) => setText(e.target.value)}        
          className="textarea-field"        
        />        
      )}        
  
      {selectedType === 'link' && (        
        <input        
          type="url"        
          placeholder="Paste your link..."        
          value={link}        
          onChange={(e) => setLink(e.target.value)}        
          className="input-field"        
        />        
      )}        
    </div>        
  
    <button onClick={handleSubmit} className="submit-btn" disabled={isProcessing}>        
      {isProcessing ? 'Processing...' : 'Submit'}        
    </button>        
  </>        
) : (        
  <div className="result-card">        
    <h2 className="success-heading">Upload Successful</h2>        
    <div className="code-display">        
      <span className="label">Session Code:</span>        
      <span className="code-value">{code}</span>        
    </div>        
  
    {qrImage && (        
      <div className="qr-section" id="qr-section">        
        <h3>Your QR Code:</h3>        
        <img src={qrImage} alt="QR Code" className="qr-image" />        
        <button className="print-btn" onClick={() => window.print()}>        
          🖨️ Print QR        
        </button>        
      </div>        
    )}        
  </div>        
)}

  </div>        
</>      );
};

export default UploadInterface;

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
public_id: ${Date.now()}-${file.originalname},
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
const url = https://airbridge-backend.vercel.app/preview/${code};
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

// Cleanup expired sessions
setInterval(() => {
for (let code in sessions) {
if (Date.now() > sessions[code].expiresAt) {
delete sessions[code];
}
}
}, 10 * 60 * 1000); // every 10 min

app.listen(PORT, () => {
console.log(Server running on port ${PORT});
});