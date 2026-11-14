# Star and mesh rooms in your PWA

Open [the chatroom](./star-mesh.html) from a static HTTPS host or localhost. No build step or production npm dependency is needed. Open it on each device, agree on a passphrase, and select the appropriate network path. The host creates the room and sends an invitation. Each client uses the invitation and returns its reply to the original host tab. Wait for the connection before choosing **Invite next peer**. You can copy links or scan their QR codes; long links fall back to copy/paste. **Cancel pending invite** releases an unfinished handshake.

Star supports twelve devices including the host. With two through six connected devices, the host can choose **Turn on mesh**. Existing host edges become ordinary mesh edges; they are not closed, since a full mesh still needs host-to-client connections. Each client pair negotiates its own SDP through the encrypted host channels. Application messages continue through the star during setup. Only after all peers report ready does the host commit mesh routing. If setup does not finish in 45 seconds, partial client-to-client edges close and the room remains a star.

## Module boundaries

| Module | Responsibility | Headless use |
| --- | --- | --- |
| `js/network/protocol.js` | Pure envelope creation, validation, recipient selection | No globals beyond standard JS / TextEncoder |
| `js/network/transport.js` | One WebRTC link and password-encrypted offer/answer exchange | Inject `managerFactory`; browser RTC is the default |
| `js/network/room.js` | Membership, permissions, routing, deduplication, mesh coordination | Inject `transportFactory`, `now`, `randomId`; no DOM |
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

In an actual app these host/client statements run on separate devices. The example's rendering/application callbacks are provided by your app. Invitation and reply objects include an internally encrypted SDP token, but their outer IDs are plain objects: protect the entire exchange at your UI boundary. The demo uses `encryptPayload(password, invitationOrReply)` and `makeHandshakeLink(baseUrl, 'offer'Or'answer', token)`; the receiver uses `parseHandshakeInput` and `decryptPayload` before calling room methods. This authenticates the assigned IDs along with the token. The underlying handshake expires after 30 minutes and is bound to the original RTC session. Never log passwords or exchange tokens.

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
