# First pathway: implementation coverage

Implemented in the technical specification's sequence, with a pure static production runtime.

| Epic / story | Implementation | Verification |
| --- | --- | --- |
| 1 / 1.1 Manifest and service worker | `docs/manifest.json`, PNG icons, `docs/sw.js`; app shell and vendor precache, relative scope | Asset checks, offline browser reload at project subpath |
| 1 / 1.2 ES modules and responsive layout | `docs/index.html`, `docs/css/styles.css`, `docs/js/app.js` | Module syntax, phone viewport, desktop browser flow |
| 2 / 2.1 PBKDF2 and AES-GCM | `docs/js/core/crypto.js`; random salts/IVs, authenticated envelope, AES-256 | Round trips, wrong password, tampered header/ciphertext |
| 2 / 2.2 Serialization and compression | JSON, native deflate streams, bounded expansion, Base64url | Unicode, compression, malformed/oversized inputs, uncompressed fallback |
| 3 / 3.1 Host offer | `RTCManager.createHostOffer()`; STUN or explicit LAN mode, ordered channel; complete ICE when available, bounded fallback with a warning if routes exist | ICE race/timeout/cancellation/no-candidate tests, real browser offer |
| 3 / 3.2 Joiner answer | `createJoinAnswer()` and `handleAnswer()`; session binding and expiry | Validation, wrong session, real two-peer exchange |
| 3 / 3.3 Data channel events | EventTarget lifecycle, receive parsing, bounded send and backpressure | Transport tests, disconnect/reset browser test |
| 4 / 4.1 QR and copy | Local QR generator, modal, clipboard/manual fallback, oversize guidance | Bundled scanner decodes generated invitation; clipboard denial and QR overflow tests |
| 4 / 4.2 Camera scanning | On-demand local scanner, automatic capture/processing, permission guidance and cleanup | Synthetic video QR capture generates reply and releases tracks; camera-denial test; physical camera test still needed |
| 5 / 5.1 Module interface | `docs/js/core/module-registry.js` | Routing, registration, lifecycle, namespaced send, unregister |
| 6 / 6.1 Chat UI | Scrolling log, display name, input and send; disabled while disconnected | Two browser contexts, responsive layout |
| 6 / 6.2 Chat payload | `{ module: 'chat', sender, timestamp, body }`, safe text rendering, local append after send | Bidirectional messages and HTML-injection test |

The historical game draft is preserved. Static QR bundles live in `docs/js/vendor/` with source/version/license/hash records. No production CDN fetches or build pipeline are required.

Remaining real-device acceptance: HTTPS installation/offline restart on iOS and Android; scan both invitation and reply with actual cameras; connect across distinct home/cellular networks; observe a restricted-network failure and start-over recovery. STUN-only architecture cannot guarantee arbitrary WAN connectivity.
