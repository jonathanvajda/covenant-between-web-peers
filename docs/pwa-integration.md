# Star and mesh rooms in your PWA

Open [the chatroom](./star-mesh.html) from a static HTTPS host or localhost. No build step or production npm dependency is needed. Open it in your preferred browser on each device, agree on a passphrase, and select the appropriate network path. The host creates the room and sends an invitation code. Each client applies that code and returns a response code to the original host tab. Wait for the connection before choosing **Invite next person**. **Cancel this invitation** releases an unfinished handshake.

Choose **Create a room** to host, or **Join a room** if someone sent you an invitation. The host sets a passphrase and chooses **Create room & invite first person**. Only the active invitation's sending and receiving steps appear. Guests see only invitation input, then their response to return. Connected hosts choose **Invite next person** to start a fresh, numbered invitation with an empty response box. Connected guests have no host invitation controls. QR/file receiving methods and mesh settings live in expandable sections beside their relevant step.

An invitation/QR is for **one person** and cannot invite four different devices. Four guests require four different invitations. The host has **one pending invitation at a time**; finish or cancel it before creating another. Each response is bound to the exact invitation and RTC session that created it. Cancelling invalidates that pending connection. The UI rejects an old/cancelled response without changing the current invitation or existing conversations. These controls are derived from the role and invitation lifecycle by the pure `js/network/room-flow.js` helper.

## Exchange codes without navigating

The default output is plain text, `offer=ENCRYPTED_TOKEN` or `answer=ENCRYPTED_TOKEN`, rather than a URL. Use **Copy code** and paste into email or messaging, **Share code** to invoke your device's share sheet with text only, or **Save code file** to send a `.txt` attachment. Share falls back to copying if unavailable; if clipboard permission is denied, the code remains selectable for manual copying. A WebRTC code contains actual encrypted connection metadata, so it is much longer than Query Whom's game-seed code. There is no short-code lookup server.

On the receiving device, return to the already-open browser/PWA tab. Paste into the received-code box, choose **Paste code**, or expand **Receive using a file or QR code** to load a file or scan. With the passphrase entered, paste, file load, camera scan, and QR image import apply the code automatically. Otherwise enter the passphrase and choose **Join using this invitation**. Hosts use **Connect this person** for the response to their current invitation. Manually typed codes use those same buttons. Wrapped lines and whitespace are accepted; case matters. Bare encrypted tokens and previous full URL formats remain supported, including replies without an `answer=` prefix. Decrypted contents determine whether the code joins a room or completes a pending host handshake.

Camera scanning and **Read QR image** accept the same non-URL code; image import works with a saved screenshot and needs no webcam. **Enlarge QR** helps when scanning another display. If the code exceeds QR capacity, use text or a file instead. Code files are limited to approximately 68 KiB and QR images to 10 MiB. After successful code application the input clears. Once the channel opens, the outgoing invitation/response is removed, the participant appears as connected, and the host's empty response box is ready for the next participant. Invalid codes remain available to correct or retry.

An **Optional link** section retains link copying. Pasting a link applies it inside the current room. A fragment arriving in the same open page is captured and applied to its existing room when the passphrase is present; it does not create a new host session. The fragment is removed from the address bar. A reply opened in a fresh tab cannot access the original tab's in-memory WebRTC connection; the UI directs the user back to the original host. Opening links in Gmail/Messenger's embedded browser likewise cannot transfer a running connection to Chrome. Prefer code/file exchange while keeping the intended browser tab open.

Star supports twelve devices including the host. With two through six connected devices, the host can choose **Turn on mesh**. Existing host edges become ordinary mesh edges; they are not closed, since a full mesh still needs host-to-client connections. Each client pair negotiates its own SDP through the encrypted host channels. Application messages continue through the star during setup. Only after all peers report ready does the host commit mesh routing. If setup does not finish in 45 seconds, partial client-to-client edges close and the room remains a star.

## Module boundaries

| Module | Responsibility | Headless use |
| --- | --- | --- |
| `js/network/protocol.js` | Pure envelope creation, validation, recipient selection | No globals beyond standard JS / TextEncoder |
| `js/network/transport.js` | One WebRTC link and password-encrypted offer/answer exchange | Inject `managerFactory`; browser RTC is the default |
| `js/network/room.js` | Membership, permissions, routing, deduplication, mesh coordination | Inject `transportFactory`, `now`, `randomId`; no DOM |
| `js/network/exchange.js` | Pure text-code formatting, parsing and authenticated-purpose validation | No DOM or navigation |
| `js/star-mesh-app.js` | Chatroom DOM, clipboard, camera, QR and exchange UI | Browser only |

`RTCManager` and `crypto.js` remain shared with the original two-peer chat. Imports are native ES modules; serve `.js` with a JavaScript content type. Keep relative module paths intact when copying `js/network/` and `js/core/` into another PWA.

## Start a host and join it

```js
import { PeerRoom } from './js/network/room.js';

const hostId = crypto.randomUUID();
const host = new PeerRoom({
    selfId: hostId,
    hostId,
    onMessage: applyApplicationMessage,
    onState: state => renderConnectionState(state),
    onError: error => displayConnectionError(error.message)
});

const invitation = await host.createInvitation(sharedPassword);
// Transfer invitation to ONE client over your chosen out-of-band bridge.
// Treat its peerId as the assigned participant identity, not an account identity.
const client = new PeerRoom({
    selfId: invitation.peerId,
    hostId: invitation.hostId,
    onMessage: applyApplicationMessage,
    onError: error => displayConnectionError(error.message)
});
const reply = await client.answerInvitation(invitation, sharedPassword);
// Transfer reply back to the ORIGINAL host instance.
await host.acceptReply(reply, sharedPassword);
// Wait for onState to report the peer as connected before sending.
```

In an actual app these host/client statements run on separate devices. The example's rendering/application callbacks are provided by your app. Invitation and reply objects include an internally encrypted SDP token, but their outer IDs are plain objects: protect the entire exchange at your UI boundary. The demo uses `encryptPayload(password, invitationOrReply)` then `formatRoomExchangeCode(type, token)` from `network/exchange.js`; optional links use `makeHandshakeLink(baseUrl, type, token)`. The receiver uses `parseRoomExchangeText`, `decryptPayload`, and `identifyRoomExchangeType` before calling room methods. This authenticates the assigned IDs along with the token and checks external type hints against the decrypted data. The underlying handshake expires after 30 minutes and is bound to the original RTC session. Never log passwords or exchange tokens.

A single SDP offer cannot establish several independent browser connections. This implementation intentionally uses a new offer per client instead of the reusable host QR described in `specs/star-mesh.md`. A stable room landing link could be added later, but it would still need a mechanism to deliver fresh per-client signaling data.

## Send chat and game actions

```js
room.sendChat('Ready?');                       // Broadcast, at most 250 UTF-16 code units
room.sendChat('Your turn', anotherPeerId);    // Private
room.sendGameAction('FIRE_SHOT', { x: 3, y: 4 });
room.sendGameAction('PRIVATE_HAND', hand, anotherPeerId);

function applyApplicationMessage(message) {
    if (message.type === 'CHAT_MSG') return appendChat(message);
    // Validate game-specific payloads before passing them into a pure reducer.
    if (!isValidGameAction(message.payload)) return;
    gameState = reduceGameState(gameState, message.payload, message.senderId);
    renderGame(gameState);
}
```

Messages use `{version, id, senderId, timestamp, envelopeType, targetId, type, payload}`. `type` is `CHAT_MSG` or `GAME_ACTION`; private messages identify one `targetId`, broadcasts use `null`. The total serialized UTF-8 envelope is limited to 16 KiB, including game data. Game actions have a nonempty action name of at most 64 code units. Use JSON-compatible data; cyclic values and BigInt cannot be serialized. Received content is untrusted; validate your game schema, turn ownership, and legal transitions yourself.

Each sender sees its own message immediately. A star host forwards a private message but does not deliver it to its application callback unless it is the target. The host can inspect private traffic: this is hop-by-hop WebRTC encryption, not participant-to-participant encryption through the host. Mesh private messages go directly to their target. Do not use broadcast for secret game state.

The optional synchronous `authorize(message)` callback can reject application traffic. A star host applies this before relaying. Clients should also validate moves locally. In mesh the host no longer controls traffic: authorization must be enforced by every recipient. A password grants room access; it does not provide verified user identities or protection from an authorized malicious host.

## Choose topology for your game

Prefer star when a trusted host owns the authoritative game state or hidden information. Clients send an intent privately to the host; the host validates it, applies a pure state reducer, and sends an allowed public update or a private view to each participant. The transport does not implement authority or consensus for you.

Call `host.enableMesh()` only when everyone has joined and no invitation is pending. `onState` exposes `topology`, `transitioning`, `members`, and locally `connected` peer IDs. In star a client's connected list normally contains only the host, even though membership lists everyone. Mesh creates N−1 links per participant and N(N−1)/2 links total. New joins and switching back to star after a committed mesh are not supported; create a fresh room to change the group.

For a cooperative game using mesh, keep deterministic game logic separate from networking. Include action sequence numbers, a game/round ID, and any required state version in your payload. Supply snapshot synchronization, acknowledgments and conflict resolution in your application. Ordered reliable delivery applies to a single WebRTC channel; there is no global ordering across senders, transaction guarantee, durable history, or replay after reload. Sending successfully means queued locally, not acknowledged by the remote application. Backpressure errors can occur; do not retry an action blindly if some peers already received it. Use application action IDs and acknowledgment/retry logic for reliable game turns.

## Disconnect and recovery behavior

- Brief ICE `disconnected` states retain the connection so browser ICE recovery can succeed. No heartbeat, retry loop, ICE restart, or delivery queue is added.
- Terminal `failed` links are closed and removed. In star the host broadcasts updated membership. A disconnected host blocks client sends until its link recovers; a failed host requires a new room.
- In mesh, surviving direct links continue carrying messages after host loss. There is no coordinator election or distributed membership consensus. Membership may retain disconnected peers; inspect the local connected list. Private sends to a disconnected mesh recipient throw; broadcasts reach only currently open links.
- Rejoin in star uses a fresh invitation and a fresh participant ID. Reload loses history and identity. Reauthentication, resuming a previous player, persistent identity, and host migration remain future work. Do not restore a player merely because someone claims an old peer ID; design an authenticated resume credential and game-specific recovery policy first.
- Call `room.close()` when leaving. It closes links and cancels the mesh timer. Failed/abandoned invitations can be released with `cancelPendingInvitations()`.

## Headless integration and tests

`PeerRoom` imports no DOM code. Supply a `transportFactory({onMessage, onStatusChange, onError})` returning one independent link with:

```js
{
    connected, // live boolean
    generateOffer(password), acceptOffer(token, password),
    finalizeConnection(token, password),
    createSignalOffer(), answerSignalOffer(offer), acceptSignalAnswer(answer),
    send(packet), close()
}
```

Offer/answer methods return promises. Deliver parsed packet objects to `onMessage`; report `connected`, `disconnected`, or `failed` via `onStatusChange`. `send` throws when unavailable. The production adapter uses `RTCManager`; headless tests use an in-memory network. A real Node headless runtime needs your own WebRTC adapter; Node alone has no built-in `RTCPeerConnection`. Inject a deterministic `randomId` and `now` to make simulations reproducible. Keep IDs unique and limited to 1–64 ASCII letters, digits, underscores or hyphens.

Run `npm test` for existing tests plus the Jest network suite, `npm run check` for assets and module syntax, and `npm run test:browser` for Chromium integration. The real-browser room test joins three isolated contexts, verifies star broadcasts and private delivery, commits mesh, and chats after the host tab closes. Six-peer mesh and twelve-peer star limits are covered headlessly. Run physical-device tests for Wi-Fi, WAN, backgrounding, camera permissions, and mobile installation; local Chromium does not prove NAT traversal or battery estimates.

## PWA packaging

Cache these module files, the chatroom HTML, and any imported core/vendor files in your service worker. This repository's `sw.js` does that and increments its cache version. Updates wait until previous tabs close. Another PWA should merge the files into its own app-shell list and keep its own manifest and worker lifecycle. Offline caching supplies the UI; network traversal and exchange still require usable connectivity. Public STUN is the default, TURN is not configured, and some networks cannot connect. Use `P2PTransport({ managerFactory: () => new RTCManager({ iceServers: yourServers }) })` through the room's `transportFactory` when your application needs different ICE settings.
