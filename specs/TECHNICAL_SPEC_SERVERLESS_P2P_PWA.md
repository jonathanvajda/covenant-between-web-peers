# Technical Specification: Serverless P2P Browser Communication Framework (PWA)
This document provides a comprehensive technical specification for building a client-side Progressive Web App (PWA) capable of establishing direct peer-to-peer (P2P) communication across the internet between two browser sessions (e.g., tablets or desktops on separate networks) using out-of-band handshaking (QR codes or copy-pasted URLs) and public STUN infrastructure.

## 1. Architectural Overview & Constraints
Deployment Target: Static website hosting (e.g., GitHub Pages, Netlify, AWS S3) supporting HTTPS.

Architecture: 100% Client-Side Processing. Zero backend compute runtime, database, or custom signaling server.

External Dependencies: Public STUN servers only (e.g., Google's public STUN infrastructure: `stun:stun.l.google.com:19302`).

Technology Stack: Pure Vanilla JavaScript (ES6+ modular architecture), HTML5, and CSS3. No Node.js runtime frameworks (React, Vue, Vite, or Webpack) in production. Node.js is restricted strictly to local developer tooling (ESLint, Babel AST parsers, and Jest for unit testing).

Modular Foundation: The core framework abstracts connection establishment, state serialization, encryption, and data channel transport behind a clean API so that downstream features (text chat, RTS games, audio streaming) can be plugged in as modular consumers.

## 2. File Structure & Vendor Code
The project uses a clean ES6 module structure loaded natively by modern mobile and desktop browsers (`type="module"`).

```
/
├── index.html                  # Main PWA entry point
├── manifest.json               # PWA Manifest configuration
├── sw.js                       # Service Worker for offline caching
├── css/
│   └── styles.css              # Core responsive styling
├── js/
│   ├── app.js                  # Application controller & UI binder
│   ├── core/
│   │   ├── crypto.js           # AES-GCM encryption/decryption & key derivation
│   │   └── rtc-manager.js      # WebRTC connection, ICE candidate gathering, DataChannel wrapper
│   └── modules/
│       └── chat.js             # First implementation module (Bi-directional text chat)
└── vendor/
    ├── qrcode.min.js           # Lightweight client-side QR generator (e.g., davidshimjs/qrcodejs)
    └── html5-qrcode.min.js     # Lightweight client-side QR scanner (e.g., mebjas/html5-qrcode)
```

Full List of Vendor Code Needed to Get Started
`qrcode.min.js`: Generates high-density QR code graphics on an HTML5 `<canvas>` element from the encrypted handshake token.

`html5-qrcode.min.js`: Uses the tablet's camera API to decode incoming handshake QR codes instantly.
*(Note: Both vendor libraries are standalone client-side JavaScript files placed directly in the /vendor/ directory, requiring no build steps or package managers).*


## 3. Epics and User Stories (Strictly Sequential)
The following sequential epics guide development toward a modular P2P foundation followed by the first chat implementation.

### Epic 1: Static PWA Foundation & Asset Bundling
Milestone: Establish a secure offline-capable static application container running pure vanilla JavaScript modules.

#### Story 1.1: PWA Manifest & Service Worker Setup

As a developer, I want a valid manifest.json and service worker (sw.js) so the web app can be installed on tablets as a progressive web app and work offline.

#### Story 1.2: ES6 Module Layout & CSS Grid Interface

As a user, I want a clean, touch-friendly UI layout styled with CSS Grid/Flexbox that scales cleanly across tablet viewports.

### Epic 2: Client-Side Cryptographic Handshake Engine
Milestone: Securely serialize, encrypt, and decrypt WebRTC configuration payloads using the browser's native Web Crypto API.

#### Story 2.1: Password-Based Key Derivation (PBKDF2 & AES-GCM)

As a developer, I need a utility (crypto.js) that takes a shared room passphrase, derives a 256-bit AES-GCM key via PBKDF2, and encrypts/decrypts arbitrary JSON objects.

#### Story 2.2: Payload Serialization and Compression

As a developer, I need functions to serialize SDP offers/answers and ICE candidate bundles into compressed Base64 strings suitable for URL hashes.

### Epic 3: WebRTC P2P Core Manager (RTCManager)
Milestone: Establish peer connections, interface with public STUN servers, manage NAT traversal, and expose a clean event-driven abstraction for data channels.

#### Story 3.1: Host Connection & Offer Generation

As a host user, I want the app to instantiate an RTCPeerConnection using public Google STUN servers, create an offer, gather complete ICE candidates, and output an encrypted handshake token.

#### Story 3.2: Joiner Connection & Answer Generation

As a joiner user, I want to input an encrypted host token, decrypt it, set the remote description, create a matching answer, and generate my own encrypted reply token.

#### Story 3.3: Data Channel Event Abstraction

As a developer, I want rtc-manager.js to emit clean lifecycle events (onConnected, onDisconnected, onMessage) so downstream features don't need to touch raw WebRTC APIs.

### Epic 4: Out-of-Band Bridge UI (QR & URL Hashing)
Milestone: Provide seamless mobile-to-mobile data transfer via camera scanning and clipboard sharing.

#### Story 4.1: QR Code Generation & Display Modal

As a host, I want my encrypted handshake token rendered automatically as a scannable QR code on screen alongside a "Copy Link" button.

#### Story 4.2: Camera QR Scanner Integration

As a joiner, I want to tap "Scan QR Code" to activate my tablet's camera, read the host's QR code, and automatically parse the connection string.

Epic 5: Modular Architecture Conformance & Abstract Extension Point
Milestone: Prove the modular foundation is fully decoupled from specific use cases (RTS, streaming, chat) by defining a standard plugin interface.

#### Story 5.1: Plugin Lifecycle Interface

As a developer, I want a standardized module registration hook (registerModule({ init, onMessage, send })) so that chat, future RTS state sync loops, or audio streaming modules can bind cleanly to the underlying RTCManager without modifying core logic.

### Epic 6: Implementation - Simple Bi-Directional Text Chat
Milestone: Deliver the first concrete application module built on top of the modular foundation.

#### Story 6.1: Chat UI Component

As a user, I want a scrolling message history window, an input text box, and a send button.

#### Story 6.2: Chat Payload Transmission

As a user, when I send a message, it should serialize { sender, timestamp, body }, transmit across the established RTCDataChannel, and render instantly on both peers' screens.

## 4. Technical Specifications for Implementation

### Core Module: `crypto.js`
See: `./docs/js/core/crypto.js`

### Core Module: `rtc-manager.js`
See: `./docs/js/core/rtc-manager.js`

### Application Module: `chat.js` (Modular Implementation Example)
See: `./docs/js/modules/chat.js`