(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let ws = null;
  let myId = null;
  let myName = 'You';
  let cryptoKey = null;
  let connected = false;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const domMessages   = $('#messages');
  const domTextInput  = $('#textInput');
  const domBtnSend    = $('#btnSend');
  const domDeviceList = $('#deviceList');
  const domStatusDot  = $('.status-dot');
  const domStatusText = $('.status-text');
  const domLockStatus = $('#lockStatus');
  const domLockLabel  = $('#lockLabel');
  const domPassphrase = $('#passphrase');
  const domMyName     = $('#myName');
  const domMyIP       = $('#myIP');
  const domFileList   = $('#fileList');
  const domDropZone   = $('#dropZone');
  const domFileInput  = $('#fileInput');
  const domQrOverlay  = $('#qrOverlay');
  const domQrCode     = $('#qrCode');
  const domQrUrl      = $('#qrUrl');

  // ── WebSocket ──────────────────────────────────────────────────────────────
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ua = encodeURIComponent(navigator.userAgent);
    const url = `${proto}://${location.host}?ua=${ua}`;

    ws = new WebSocket(url);

    ws.onopen = () => {
      connected = true;
      setStatus('connected', 'Connected');
      domMyIP.textContent = location.hostname;
    };

    ws.onclose = () => {
      connected = false;
      setStatus('disconnected', 'Reconnecting...');
      setTimeout(connect, 2000);
    };

    ws.binaryType = 'arraybuffer';

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        handleBinaryChunk(e.data);
        return;
      }
      const msg = JSON.parse(e.data);
      handleServerMessage(msg);
    };
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function sendBinary(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  function setStatus(cls, text) {
    domStatusDot.className = 'status-dot ' + cls;
    domStatusText.textContent = text;
  }

  // ── Encryption ─────────────────────────────────────────────────────────────
  async function deriveKey(passphrase) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode('LANShare-v1-salt'),
        iterations: 200000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return key;
  }

  async function encryptText(plaintext) {
    if (!cryptoKey) return { ciphertext: plaintext, iv: null };
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      enc.encode(plaintext)
    );
    return {
      ciphertext: arrayBufferToBase64(encrypted),
      iv: arrayBufferToBase64(iv)
    };
  }

  async function decryptText(ciphertextB64, ivB64) {
    if (!cryptoKey || !ivB64) return ciphertextB64;
    try {
      const encrypted = base64ToArrayBuffer(ciphertextB64);
      const iv = base64ToArrayBuffer(ivB64);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        encrypted
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      return '[decryption failed — check passphrase]';
    }
  }

  async function encryptFile(arrayBuffer) {
    if (!cryptoKey) return { data: new Uint8Array(arrayBuffer), iv: null };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      arrayBuffer
    );
    return {
      data: new Uint8Array(encrypted),
      iv: arrayBufferToBase64(iv)
    };
  }

  async function decryptFile(encryptedBuf, ivB64) {
    if (!cryptoKey || !ivB64) return encryptedBuf;
    try {
      const iv = base64ToArrayBuffer(ivB64);
      return await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        encryptedBuf
      );
    } catch {
      throw new Error('decryption failed');
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function notify(text) {
    const el = document.createElement('div');
    el.className = 'notification';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  function copyToClipboard(text) {
    // Try modern API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        notify('Copied to clipboard');
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    ta.style.fontSize = '16px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      notify('Copied to clipboard');
    } catch {
      notify('Copy failed — tap and hold to select text manually');
    }
    document.body.removeChild(ta);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Server message handler ─────────────────────────────────────────────────
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        myId = msg.id;
        myName = msg.name || myName;
        domMyName.textContent = myName;
        break;

      case 'peers':
        renderPeers(msg.peers);
        break;

      case 'notification':
        notify(msg.message);
        break;

      case 'text':
        handleTextMessage(msg);
        break;

      case 'file-meta':
        handleFileMeta(msg);
        break;
    }
  }

  async function handleTextMessage(msg) {
    const plaintext = await decryptText(msg.content, msg.iv);
    addMessage(plaintext, 'received', msg.from, msg.timestamp);
  }

  // ── Messages UI ────────────────────────────────────────────────────────────
  function addMessage(text, type, from, timestamp) {
    const welcome = domMessages.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = 'message ' + type;
    div.title = 'Click to copy';

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.innerHTML = `<span>${escapeHtml(from || 'You')}</span><span class="message-time">${formatTime(timestamp || Date.now())}</span>`;
    div.appendChild(meta);

    const content = document.createElement('div');
    content.textContent = text;
    div.appendChild(content);

    // Click to copy
    div.addEventListener('click', () => {
      copyToClipboard(text);
    });

    domMessages.appendChild(div);
    domMessages.scrollTop = domMessages.scrollHeight;
  }

  function addFileMessage(entry, blobUrl) {
    const welcome = domMessages.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = 'message received';

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.innerHTML = `<span>${escapeHtml(entry.from)}</span><span class="message-time">${formatTime(Date.now())}</span>`;
    div.appendChild(meta);

    const content = document.createElement('div');
    content.className = 'message-file';
    content.innerHTML = `
      <div class="msg-file-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
          <polyline points="13,2 13,9 20,9"/>
        </svg>
      </div>
      <div class="msg-file-info">
        <span class="msg-file-name">${escapeHtml(entry.name)}</span>
        <span class="msg-file-size">${formatBytes(entry.size)}</span>
      </div>
      <button class="msg-file-dl">Download</button>
    `;
    div.appendChild(content);

    const btn = content.querySelector('.msg-file-dl');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = entry.name;
      a.click();
      btn.textContent = 'Downloaded';
      btn.disabled = true;
    });

    domMessages.appendChild(div);
    domMessages.scrollTop = domMessages.scrollHeight;
  }

  async function sendText() {
    const text = domTextInput.value.trim();
    if (!text) return;

    const { ciphertext, iv } = await encryptText(text);
    send({ type: 'text', content: ciphertext, iv });

    addMessage(text, 'sent', myName, Date.now());
    domTextInput.value = '';
    domTextInput.style.height = 'auto';
    domBtnSend.disabled = true;
  }

  // ── Peers ──────────────────────────────────────────────────────────────────
  function renderPeers(peers) {
    const others = peers.filter((p) => p.id !== myId);
    if (others.length === 0) {
      domDeviceList.innerHTML = '<div class="empty-state">No devices connected</div>';
      return;
    }

    domDeviceList.innerHTML = others
      .map((p) => {
        return `
        <div class="device-card other">
          <div class="device-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <rect x="5" y="2" width="14" height="20" rx="2"/>
              <line x1="12" y1="18" x2="12.01" y2="18"/>
            </svg>
          </div>
          <div class="device-info">
            <span class="device-name">${escapeHtml(p.name)}</span>
          </div>
        </div>`;
      })
      .join('');
  }

  // ── File sending ───────────────────────────────────────────────────────────
  function addFileCard(file) {
    const card = document.createElement('div');
    card.className = 'file-card out';
    const id = 'file-' + Date.now();
    card.id = id;
    card.innerHTML = `
      <div class="file-card-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
          <polyline points="13,2 13,9 20,9"/>
        </svg>
      </div>
      <div class="file-card-info">
        <div class="file-card-name">${escapeHtml(file.name)}</div>
        <div class="file-card-size">${formatBytes(file.size)}</div>
      </div>
      <button class="btn-file-send">Send</button>
    `;

    const btn = card.querySelector('.btn-file-send');
    btn.addEventListener('click', () => sendFile(file, btn, card));

    domFileList.appendChild(card);
  }

  async function sendFile(file, btnEl, card) {
    btnEl.disabled = true;
    btnEl.textContent = 'Encrypting...';

    try {
      const buf = await file.arrayBuffer();
      const { data: encrypted, iv } = await encryptFile(buf);

      btnEl.textContent = 'Sending...';

      send({
        type: 'file-meta',
        fileName: file.name,
        fileSize: encrypted.byteLength,
        fileType: file.type || 'application/octet-stream',
        iv
      });

      const CHUNK = 65536;
      for (let offset = 0; offset < encrypted.byteLength; offset += CHUNK) {
        const chunk = encrypted.slice(offset, offset + CHUNK);
        sendBinary(chunk);
      }

      btnEl.textContent = 'Sent';
      btnEl.disabled = true;
      card.style.borderColor = 'var(--green)';
      notify(`Sent: ${file.name}`);
    } catch (err) {
      btnEl.disabled = false;
      btnEl.textContent = 'Failed';
    }
  }

  // ── File receiving ─────────────────────────────────────────────────────────
  const incomingFiles = [];
  let receivingFile = null;

  function handleFileMeta(msg) {
    const entry = {
      name: msg.fileName,
      size: msg.fileSize,
      type: msg.fileType,
      iv: msg.iv || msg.encryptedKey,
      from: msg.from,
      chunks: [],
      received: 0,
      blobUrl: null
    };
    incomingFiles.push(entry);
    if (!receivingFile) receivingFile = entry;

    // Show a card in the file list immediately
    addReceivedFileCard(entry);
  }

  function addReceivedFileCard(entry) {
    const card = document.createElement('div');
    card.className = 'file-card in';
    const cid = 'recv-' + escapeHtml(entry.name) + '-' + Date.now();
    card.id = cid;
    card.innerHTML = `
      <div class="file-card-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7,10 12,15 17,10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </div>
      <div class="file-card-info">
        <div class="file-card-name">${escapeHtml(entry.name)}</div>
        <div class="file-card-size">${formatBytes(entry.size)} from ${escapeHtml(entry.from)}</div>
      </div>
      <button class="btn-file-download" disabled>Receiving...</button>
    `;
    domFileList.appendChild(card);

    // Store a callback to update this card when the file arrives
    entry._cardId = cid;
    entry._onComplete = (blobUrl) => {
      const c = document.getElementById(cid);
      if (c) {
        const btn = c.querySelector('.btn-file-download');
        btn.textContent = 'Download';
        btn.disabled = false;
        btn.addEventListener('click', () => {
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = entry.name;
          a.click();
          btn.textContent = 'Downloaded';
          btn.disabled = true;
        });
        c.style.borderColor = 'var(--green)';
      }

      // Also show in messages
      addFileMessage(entry, blobUrl);
    };
  }

  async function handleBinaryChunk(data) {
    if (!receivingFile) return;

    receivingFile.chunks.push(new Uint8Array(data));
    receivingFile.received += data.byteLength;

    // Update progress on the card
    const c = document.getElementById(receivingFile._cardId);
    if (c) {
      const pct = Math.round((receivingFile.received / receivingFile.size) * 100);
      const btn = c.querySelector('.btn-file-download');
      if (btn) btn.textContent = `${pct}%`;
    }

    if (receivingFile.received >= receivingFile.size) {
      const entry = receivingFile;
      const idx = incomingFiles.indexOf(entry);
      if (idx !== -1) incomingFiles.splice(idx, 1);
      receivingFile = incomingFiles[0] || null;

      // Reassemble
      const full = new Uint8Array(entry.size);
      let offset = 0;
      for (const chunk of entry.chunks) {
        full.set(chunk, offset);
        offset += chunk.byteLength;
      }
      entry.chunks = [];

      try {
        const decrypted = await decryptFile(full.buffer, entry.iv);
        const blob = new Blob([decrypted], { type: entry.type });
        entry.blobUrl = URL.createObjectURL(blob);

        if (entry._onComplete) {
          entry._onComplete(entry.blobUrl);
        }

        notify(`Received: ${entry.name} — click to download`);
      } catch {
        if (entry._onComplete) {
          const c = document.getElementById(entry._cardId);
          if (c) {
            const btn = c.querySelector('.btn-file-download');
            if (btn) { btn.textContent = 'Decrypt failed'; btn.disabled = true; }
          }
        }
        notify(`Received: ${entry.name} (decryption failed)`);
      }
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  domPassphrase.addEventListener('input', async () => {
    const val = domPassphrase.value;
    if (val.length > 0) {
      cryptoKey = await deriveKey(val);
      domLockStatus.classList.add('has-key');
      domLockLabel.textContent = 'Encryption active';
    } else {
      cryptoKey = null;
      domLockStatus.classList.remove('has-key');
      domLockLabel.textContent = 'No key set';
    }
  });

  domBtnSend.addEventListener('click', sendText);

  domTextInput.addEventListener('input', () => {
    domTextInput.style.height = 'auto';
    domTextInput.style.height = Math.min(domTextInput.scrollHeight, 120) + 'px';
    domBtnSend.disabled = domTextInput.value.trim().length === 0;
  });

  domTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  });

  // Dismiss keyboard on iOS when tapping outside the input
  document.addEventListener('click', (e) => {
    if (e.target !== domTextInput && document.activeElement === domTextInput) {
      domTextInput.blur();
    }
  });

  $('#btnRename').addEventListener('click', () => {
    const name = prompt('Device name:', myName);
    if (name && name.trim()) {
      myName = name.trim();
      domMyName.textContent = myName;
      send({ type: 'rename', name: myName });
    }
  });

  // Tabs
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      $('#tab-text').classList.toggle('hidden', target !== 'text');
      $('#tab-files').classList.toggle('hidden', target !== 'files');
    });
  });

  // File drop zone
  domDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    domDropZone.classList.add('drag-over');
  });

  domDropZone.addEventListener('dragleave', () => {
    domDropZone.classList.remove('drag-over');
  });

  domDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    domDropZone.classList.remove('drag-over');
    for (const file of e.dataTransfer.files) {
      addFileCard(file);
    }
  });

  domFileInput.addEventListener('change', () => {
    for (const file of domFileInput.files) {
      addFileCard(file);
    }
    domFileInput.value = '';
  });

  // QR code — show on green dot click, generated server-side
  $('.dot-green').addEventListener('click', async () => {
    let url = location.href;
    try {
      const resp = await fetch('/info');
      const info = await resp.json();
      if (info.ips && info.ips.length > 0) {
        url = `http://${info.ips[0]}:${info.port}`;
      }
    } catch {
      // fallback to current location
    }

    domQrUrl.textContent = url;
    domQrCode.innerHTML = '<p style="color:var(--text-tertiary);font-size:13px">Generating...</p>';

    try {
      const resp = await fetch('/qr?url=' + encodeURIComponent(url));
      const data = await resp.json();
      const img = document.createElement('img');
      img.src = data.dataUrl;
      img.width = 200;
      img.height = 200;
      img.style.borderRadius = 'var(--radius-md)';
      img.style.background = 'white';
      img.style.padding = '8px';
      domQrCode.innerHTML = '';
      domQrCode.appendChild(img);
    } catch {
      domQrCode.innerHTML = `<p style="color:var(--red);font-size:13px">QR generation failed</p><p style="color:var(--text-secondary);font-size:12px;word-break:break-all;text-align:center">${escapeHtml(url)}</p>`;
    }

    domQrOverlay.classList.remove('hidden');
  });

  $('#btnCloseQr').addEventListener('click', () => {
    domQrOverlay.classList.add('hidden');
  });

  domQrOverlay.addEventListener('click', (e) => {
    if (e.target === domQrOverlay) {
      domQrOverlay.classList.add('hidden');
    }
  });

  // ── Mobile viewport fix ───────────────────────────────────────────────────
  function fixViewport() {
    const app = document.querySelector('.app');
    if (!app) return;
    // Use the smaller of dvh or window inner height as the real visible height
    const vh = window.innerHeight;
    app.style.height = vh + 'px';
    app.style.maxHeight = vh + 'px';
  }

  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    || ('ontouchstart' in window && window.innerWidth < 768);

  if (isMobile) {
    fixViewport();
    window.addEventListener('resize', fixViewport);
    window.addEventListener('orientationchange', () => setTimeout(fixViewport, 100));
    // Re-fix after a short delay to handle browser chrome settling
    setTimeout(fixViewport, 300);
    setTimeout(fixViewport, 1000);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  connect();
})();
