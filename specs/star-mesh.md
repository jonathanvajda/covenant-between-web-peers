
## Data and Battery Demands, State Management, and P2P Synchronization

### Example: Game State Sharing
When evaluating text-based payloads like Cluedo guesses (`{"suspect": "Plumb", "weapon": "Rope", "room": "Dining Room"}`) or Battleship moves (`{"action": "FIRE", "coord": "A3"}`), the network data volume is virtually zero.

However, maintaining an active P2P WebRTC connection does impose a continuous, minor overhead on battery and radio state.
#### 1. The Data Cost (Bandwidth & Plan Impact)
* **Byte Size**: A typical turn-based JSON payload for these games is roughly 100 to 300 bytes.
* **Cellular Data Impact**: Negligible. Even across a 2-hour game involving hundreds of turns, total data transfer will measure in the low kilobytes—far less than loading a single thumbnail image on a web page.
* **Local Wi-Fi**: Zero impact on your internet data cap, as the packets route directly peer-to-peer over local network routers without hitting external WAN bandwidth servers.
#### 2. The Battery Cost (Radio Wake-Locks & CPU)
While the *data* is tiny, the radios keep the battery cost active:
* Cellular / Wi-Fi Radio State: Mobile operating systems use a mechanism called `Radio Resource Control (RRC)`. When a packet is sent, the Wi-Fi or cellular chip jumps to a high-power "Active" state. Because WebRTC maintains a continuous connection, tiny background keepalive packets (STUN binding requests/responses or DTLS heartbeats) fire every few seconds to keep the NAT hole-punch alive.
* **The Drain**: This keeps the wireless radio from entering its deepest sleep state. On a mobile tablet, maintaining an idle WebRTC connection consumes roughly *1% to 3% battery life per hour*—noticeable, but very light compared to video streaming or running a heavy graphical game loop.
* **CPU Cost**: Near zero. Parsing a 200-byte JSON string once per turn takes microseconds of CPU time, meaning no thermal throttling or heavy battery drain from computation.
#### 3. Star Topology vs. Mesh: Battery Impact for 5+ Players
Because you are building a game for 5 or more players, your architectural choice directly dictates battery performance on mobile devices:
* **If you use a Full Mesh ($N=5 \rightarrow 4$ connections per device)**: Every device must maintain 4 separate WebRTC data channels and broadcast every outgoing chat or game action 4 times. This multiplies the radio overhead and packet processing fourfold, leading to faster battery drain and potential Wi-Fi congestion on weaker tablet antennas.
* **If you use a Star / Host-Mediated Topology (Host has 4 connections, Clients have 1)**:
  * For the Clients (Players 2–5): They only maintain one connection (to the Host). Their battery and radio overhead remain almost identical  to a 1-to-1 chat session.
  * For the Host (Player 1): Acts as the switchboard, maintaining 4 concurrent channels. The host's tablet will experience slightly higher battery drain, but it completely shields the other 4 players from the overhead.
## Summary
For text-based state updates in games like `Everything's Sus` (aka `Cluedo`), `Query Whom!` (aka `Guess Who`), or `Maritime Warship` (aka `Battleship`), bandwidth is a non-issue. The only real battery cost is the idle radio wake-lock required to keep a P2P socket alive across the network—a cost easily mitigated by using a Star Topology where clients maintain only a single connection to the host.


# Connection Specification: from Star to Mesh

## Specification 1: 1-to-1 Black-Box P2P Transport & Chat Core
This specification defines a reusable, game-agnostic 1-to-1 P2P transport layer designed for small state payloads (e.g., Battleship, Guess Who) and a built-in 250-character text chat channel.

### Architecture & Payload Flow
* Topology: 1-to-1 direct WebRTC `RTCDataChannel`.
* Handshake: Out-of-band via URL hash or QR code using AES-GCM encryption.
* Payload Structure: All messages are encapsulated in a strict JSON wrapper to allow the host application to route them without the transport layer needing to understand the game rules.

```JSON
{
  "type": "GAME_ACTION | CHAT_MSG",
  "senderId": "peer_abc123",
  "timestamp": 1778621100000,
  "payload": {
    "action": "FIRE_SHOT",
    "data": { "x": 3, "y": 4 }
  }
}
```

### Core API Specification (`P2PTransport`)
```JavaScript
class P2PTransport {
    constructor(options = { onMessage, onStatusChange }) {}
    
    // Lifecycle
    async generateOffer(roomPassword) {} // Returns encrypted string/QR payload
    async acceptOffer(offerToken, roomPassword) {} // Returns encrypted answer token
    async finalizeConnection(answerToken, roomPassword) {}
    
    // Transmission
    sendGameAction(actionType, actionData) {
        // Automatically wraps in JSON envelope, enforces size limits
    }
    sendChat(text) {
        // Enforces strict 250-character limit
        if (text.length > 250) throw new Error("Chat limit exceeded (250 chars max).");
        // Transmits over data channel
    }
    
    close() {}
}
```
## Specification 2: Star Topology (Host as Relay) for 12 Devices
This specification defines a star topology where one designated browser acts as a central hub (relay/referee) for up to 12 total connected devices. This is ideal for hidden-information multiplayer games like Cluedo or Coup.
### Architectural Rules
* **Hub-and-Spoke**: The Host maintains $N-1$ (up to 11) concurrent `RTCDataChannel` connections. Clients maintain exactly 1 connection (to the Host).
* Routing Logic: Clients never talk directly to each other
  * *Broadcast*: Client sends a payload to the Host $\rightarrow$ Host relays it to all connected clients.
  * *Private (Targeted)*: Client sends a payload to the Host with a target recipient ID $\rightarrow$ Host checks permissions and forwards it only to the targeted client.
  
### Connection & Handshake Flow
* **Host Initialization**: Host generates a single initial room offer token/QR code.
* **Client Joining**: Each joining client (Clients 2 through 12) scans that exact same Host QR code sequentially.
* **Host Multiplexing**: The Host handles incoming handshakes iteratively, assigning each client a unique `clientId` upon connection open.

Payload Envelope Spec
```JSON
{
  "envelopeType": "BROADCAST | PRIVATE",
  "senderId": "client_id_2",
  "targetId": "client_id_5", // null if BROADCAST
  "type": "GAME_MOVE",
  "payload": { ... }
}
```

## Specification 3: Mesh Bootstrap via Star Relay (Max 6 Devices)
This specification defines a hybrid initialization model: use the Star Topology (Host Relay) to bootstrap and exchange cryptographic connection metadata, allowing up to 6 devices to spin up a full direct mesh network without requiring out-of-band QR scans for every peer.

### Bootstrap Workflow
* **Star Phase**: Clients 2 through 6 join the room by scanning the Host's initial QR code, establishing standard star-topology data channels with the Host.
* **Discovery Broadcast**: Once all desired players have joined the room (up to 6 total), the Host broadcasts a "Mesh Initialization" packet containing the public WebRTC configuration fingerprints (SDP/ICE) of all connected peers.
* **Automatic Peer-to-Peer Bridging**:
  * Each browser receives the contact info for every other peer in the room.
  * Background scripts automatically initiate direct `RTCPeerConnection` handshakes between every combination of peers using the Host's data channels as a blindingly fast, automated signaling relay.
* **Transition to Full Mesh**: Once direct data channels are established between all pairs ($N(N-1)/2$ connections), the star relay channels are dropped, and the game proceeds on a fully decentralized mesh network.


## Problem cases to address
* Fault tolerance (reducing hard disconnects)
* Persistent disconnect (participant drops either intentionally or not, never returns)
* Reconnection (rejoining with relatively little effort after hard disconnect)
* Reauthentication (being able to declare yourself as a pre-existing participant and to be treated as such)