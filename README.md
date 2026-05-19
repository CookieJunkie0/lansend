# LANShare

End-to-end encrypted file and text sharing between devices on the same local network. No internet required, no accounts, no file size limits.

## Features

- **Text messaging** — real-time chat between all connected devices on the LAN
- **File transfer** — drag-and-drop or browse, chunked binary transfer with progress, no size limits
- **AES-256-GCM encryption** — shared passphrase derives a key via PBKDF2 (200k iterations); all text and file content is encrypted before it leaves the device
- **QR code sharing** — click the green dot to generate a QR code so phones/tablets can join without typing the URL
- **Device discovery** — sidebar shows every connected device with auto-detected name (iPhone, Windows PC, etc.)
- **Auto-reconnect** — WebSocket reconnects automatically with a 2-second backoff
- **Copy-to-clipboard** — click any message to copy it
- **Dark mode** — Apple-inspired native look on every platform
- **Mobile responsive** — single-column layout on small screens, iOS-safe viewport handling
- **Zero configuration** — no environment variables, no database, no external services

## Screenshot

```
┌──────────────────────────────────────────────────────────────┐
│  ● ● ●  LANShare                           ● Connected       │
├──────────────┬───────────────────────────────────────────────┤
│ THIS DEVICE  │                                               │
│ ┌──────────┐ │  ┌───────────────────────────────────────┐    │
│ │ You  ⚙   │ │  │ Ready to share                        │    │
│ └──────────┘ │  │                                       │    │
│              │  │  Open this page on another device on   │    │
│ DEVICES      │  │  the same network and set the same     │    │
│ ┌──────────┐ │  │  passphrase.                          │    │
│ │ iPhone   │ │  └───────────────────────────────────────┘    │
│ └──────────┘ │  ┌───────────────────────────────────────────┐│
│              │  │ Type a message...                      ▶ ││
│ ENCRYPTION   │  └───────────────────────────────────────────┘│
│ [  pass…  ] │                                               │
│ 🔒 No key   │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

## How it works

1. Run the server on any machine (laptop, desktop, Raspberry Pi).
2. Open the page from other devices on the same network — phones, tablets, other computers.
3. Optionally set a shared passphrase for encryption.
4. Send text or files. Everything is encrypted client-side with Web Crypto API.

## Quick start

```bash
git clone https://github.com/user/lanshare.git
cd lanshare
npm install
npm start
```

Open `http://localhost:3456` (or the LAN IP printed in the terminal) on each device.

## Requirements

- **Node.js** ≥ 18
- Devices must be on the same local network (same Wi-Fi, or wired + Wi-Fi on the same subnet)

## Encryption details

| Aspect | Choice |
|--------|--------|
| Key derivation | PBKDF2 with SHA-256, 200,000 iterations |
| Cipher | AES-256-GCM |
| IV | Random 96-bit, unique per message |
| Scope | Encrypts text content and file bytes before WebSocket transmission |

The passphrase never leaves your device. Encryption and decryption happen entirely in the browser using the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API).

**Important:** All devices must use the same passphrase. If passphrases don't match, messages and files will fail to decrypt.

## Project structure

```
lanshare/
├── server.js          # Express + WebSocket server
├── public/
│   ├── index.html     # UI shell
│   ├── app.js         # Client-side logic (WebSocket, encryption, UI)
│   └── style.css      # Apple dark-mode stylesheet
├── package.json
└── README.md
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3456`  | HTTP and WebSocket port |

```bash
PORT=8080 npm start
```

## API

The WebSocket protocol is JSON-framed. Binary frames carry file chunks.

### Server → Client

| Type | Fields | Description |
|------|--------|-------------|
| `welcome` | `id`, `name` | Assigned client ID and detected device name |
| `peers` | `peers[]` | Array of `{id, name}` for all connected devices |
| `notification` | `message` | Join/leave notifications |
| `text` | `from`, `content`, `iv`, `timestamp` | Encrypted text message |
| `file-meta` | `from`, `fileName`, `fileSize`, `fileType`, `iv` | File metadata before binary chunks arrive |

### Client → Server

| Type | Fields | Description |
|------|--------|-------------|
| `text` | `content`, `iv` | Encrypted text message |
| `file-meta` | `fileName`, `fileSize`, `fileType`, `iv` | File metadata before binary chunks |
| `rename` | `name` | Change this device's displayed name |

### HTTP

| Endpoint | Description |
|----------|-------------|
| `GET /info` | Returns `{ips, port}` for QR code generation |
| `GET /qr?url=...` | Returns `{dataUrl}` — QR code as a base64 PNG data URL |

## License

MIT
