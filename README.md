# Covenant between web peers

The first implementation is a static, installable browser-to-browser text chat in `docs/index.html`. It follows the technical specification's six epics; see [implementation coverage](specs/IMPLEMENTATION_PROGRESS.md). The standalone `docs/p2p-game-example.html` remains an earlier game experiment.

## Run locally

Use Node 24+ for developer tooling:

```sh
npm ci
npm run serve
```

Open http://127.0.0.1:4173/covenant-between-web-peers/ in two tabs or browser profiles. The production app has no Node runtime or build step. Serve `docs/` over HTTPS on GitHub Pages or any static host. A phone visiting a LAN IP over plain HTTP will not have a secure context; use HTTPS for device testing.

## Connect and chat

1. Agree on a strong shared passphrase and share it separately from the links.
2. Select **Same network / Wi-Fi (skip STUN)** on both devices if they share a local network; otherwise use **Internet / different networks**. On device A, enter the passphrase and choose **Open channel**. Send its invitation link to B, or show the QR code.
3. On device B, open/paste/scan the invitation, enter the same passphrase, and choose **Use received link**. Send the reply back to A.
4. Keep A's original tab open. Paste or scan the reply there and choose **Use received link**. Opening the reply in a new tab loses the original peer connection and cannot finish the handshake.
5. Once both devices show Connected, send messages. **Start over** closes the connection and clears this tab's history, tokens, and passphrase.

QR scanners request camera access only when invoked and release it when closed or the page becomes hidden. If the browser denies clipboard access, copy the selected link manually. If a token exceeds single-QR capacity, use the link. Incoming fragments are removed from the address bar after capture; passphrases and messages are never persisted by the app. Display names are peer-supplied labels, not verified identities.

## Constraints

Public Google STUN discovers routes; it is infrastructure, although no custom backend/signaling service is needed. There is no TURN relay, so restrictive NATs, firewalls, VPNs, and some cellular networks can prevent a connection. Test your actual two-network device pair. WebRTC encrypts the data channel; AES-GCM protects compressed handshake metadata using PBKDF2-SHA-256, 310,000 iterations, a random 16-byte salt per token, and a random 12-byte IV. A strong passphrase matters because anyone holding a token can attempt offline password guesses.

Links expire after 30 minutes and replies are bound to the host's session. They contain encrypted SDP with the gathered ICE candidates. The app waits for complete gathering, but after 20 seconds will use existing candidates with a warning instead of discarding a potentially usable LAN route. Candidates discovered after that snapshot are not transmitted; if connection fails, exchange fresh links. If no candidates exist, setup fails with local-network permission and VPN guidance. Same-network mode skips public STUN entirely. A VPN may require an "allow LAN traffic" setting, or may need to be paused for a local connection, even if both devices use the same Wi-Fi.

Device clocks should be reasonably aligned. Session state stays in memory: reload/close requires a fresh exchange. A brief network disconnect may recover automatically; a failed connection requires a new exchange. Moving to another network also generally requires starting over.

The service worker caches only the app shell and local vendor libraries. Offline availability does not guarantee internet-free rendezvous or WAN connectivity: STUN and the chosen out-of-band path still need their networks. New app versions wait for old controlled tabs to close before activation so they do not disrupt a live conversation. Bump `CACHE`'s version in `docs/sw.js` when changing cached assets.

## Check

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Browser tests exercise real WebRTC between isolated Chromium contexts with STUN disabled for deterministic host-candidate local tests. They cover both directions of chat, text injection, reset/disconnect, wrong passphrase recovery, reply-in-new-tab guidance, QR encode/decode, synthetic camera scanning and track cleanup, camera denial, clipboard denial, oversized QR fallback, offline subpath caching, and a narrow viewport. Actual camera permission/scanning on iOS/Android, installation, and WAN traversal need device checks. GitHub Actions runs checks before uploading `docs/` to Pages; changes here are not published until committed and pushed.

## Extend

`RTCManager` emits `status`, `connected`, `disconnected`, `message`, and `error` events and exposes `send()` and `close()`. `ModuleRegistry.registerModule({ id, init, onMessage, onConnectionChange, destroy })` supplies `{ send, connected }` to `init`. The registry adds the module id to each outgoing envelope and routes incoming messages to the matching consumer. `send` is also assigned on the module; modules validate their own message bodies. The chat module is the first consumer. Future game modules can reuse this transport; adding audio would also require a media-track API and negotiation support.
