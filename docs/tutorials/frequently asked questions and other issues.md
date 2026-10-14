If I set up a connection, what would be some common ways to break it?



If I change network? (E.g., device switches from cell data to wifi, or vice-versa)



If I reload tab? (E.g., refresh page, or more drastic would be to close and reopen browser)



If my computer goes to sleep/standby?



If my tab has transferred a lot of data without garbage collection? (E.g., hit some local RAM or Idb limit)



What else? Or which of these wouldn't?

Here is how each of your scenarios affects the P2P WebRTC connection, along with other common failure modes that will break or disrupt the session.

1. Changing Networks (Cellular ⇄ Wi-Fi)
Verdict: Yes, it breaks.

Why: When a tablet switches from Wi-Fi to cellular data (or vice versa), its local IP address changes, and its outer router port mapping (NAT binding) is completely rewritten. The underlying UDP socket pathways established by WebRTC are instantly invalidated.

Nuance: WebRTC has a mechanism called ICE Restart that can renegotiate a new path if implemented, but in a simple static web app without an active signaling server to pass the new ICE candidate, a network switch will permanently sever the connection, requiring a fresh handshake.

2. Reloading the Tab or Closing the Browser
Verdict: Yes, it breaks completely.

Why: WebRTC RTCPeerConnection objects, encryption keys, and data channels live entirely in ephemeral browser RAM. Refreshing the page or closing the browser destroys the JavaScript execution context.

Recovery: You must rerun the out-of-band handshake (QR code scan/link exchange) to establish a new session from scratch.

3. Computer/Tablet Goes to Sleep or Standby
Verdict: Yes, it breaks.

Why: When a device enters sleep mode, the operating system pauses CPU execution, powers down wireless network interfaces, and drops active network sockets. When the device wakes up, the Wi-Fi card takes a few seconds to reconnect, the local IP may have shifted, and the WebRTC connection state will have timed out and entered a failed state.

4. High Data Volume / RAM / Storage Limits
Verdict: It depends, but it can break things in two ways:

Data Channel Buffer Overflow: If you push data faster than the peer can consume it (common in high-throughput streaming or rapid RTS state bursts), WebRTC's internal send queue (bufferedAmount) will bloat. If it hits the browser's high-water mark limit, code execution can throw errors or drop messages unless you implement manual backpressure checks (dataChannel.bufferedAmountLowThreshold).

Tab Crashes (OOM): If your JavaScript code accumulates game state history, entity arrays, or uncollected objects in RAM without proper garbage collection, mobile browsers will eventually kill the tab with an "Out of Memory" (OOM) crash, which instantly terminates the connection. IndexedDB limits generally won't break an active session unless you are actively writing massive blobs to storage and block the main thread.

What Else Can Break It? (Additional Failure Modes)
5. Mobile Background Tab Suspension (Crucial for Tablets)
If a user switches away from your PWA tab to check a message, open the camera, or look at another app, mobile operating systems (iOS Safari and Android Chrome) aggressively freeze JavaScript execution and throttle network activity within seconds to save battery. Once frozen, UDP keepalives stop, and the peer connection will time out and drop.

6. Brief Wi-Fi Blips & The ICE Timeout Threshold
If a user experiences a minor Wi-Fi stutter, WebRTC handles temporary drops gracefully.

The connection state transitions from connected 
→ disconnected.

If the network recovers within a few seconds, it automatically heals back to connected.

However, if the interruption exceeds the ICE timeout threshold (typically around 5 to 10 seconds), the connection permanently dies and shifts to failed.

7. VPNs, Corporate Firewalls, or CGNAT Shifts
If one of the peers turns on a strict enterprise VPN or a privacy-routing tool midway through a session, it alters how UDP packets are encapsulated and routed. This frequently breaks existing STUN hole-punching paths, causing an abrupt disconnect that standard ICE handshakes cannot recover from without a complete restart.

If I set up a connection successfully, could another pathway be generated to provide fault tolerance?

Yes, fault tolerance can be implemented, but the degree of redundancy depends on whether you mean transport-level automatic failover (handled by the browser) or application-level state recovery (handled by your code).

Because your architecture is strictly serverless (no central server to reroute packets on the fly), fault tolerance operates under specific constraints:

1. Built-in Path Redundancy: ICE Candidate Pairs
Even though you establish a single logical connection, WebRTC does not rely on just one network path.

How it works: During the initial handshake, the browser gathers multiple ICE candidates (different local IPs, reflexive public IP/port mappings discovered via STUN, and potentially relay routes). It tests all combinations into "candidate pairs."

Fault Tolerance Benefit: Under the hood, WebRTC actively monitors the health of the active path. If minor micro-stutters occur, it can dynamically switch to a secondary candidate pair without dropping your data channel.

2. Multi-Homed Devices (Wi-Fi + Cellular Coexistence)
If a tablet has both Wi-Fi and Cellular data turned on simultaneously:

WebRTC will gather candidates from both network interfaces during the initial handshake.

If the Wi-Fi signal degrades severely, the browser's internal stack can attempt to migrate traffic to the cellular candidate pair on the fly.

Constraint: If the network switch forces a complete change in local subnet or public NAT routing that wasn't pre-gathered in the candidate pool, the connection will still stall unless an ICE Restart is triggered. However, triggering an ICE restart across the internet requires passing a new handshake token out-of-band (via QR/link), making a fully automated background switch tricky without a signaling server.

3. Application-Level Fault Tolerance: "Hot State" & Fast Re-Handshaking
For total network breaks (such as a device going to sleep, changing Wi-Fi networks, or refreshing a tab), no transport-layer protocol can magically keep a direct P2P socket alive.

Instead, robust PWA apps build application-level fault tolerance using a State Snapshot & Quick-Recovery Pattern:

Deterministic State Checkpoints: In your RTS game or chat app, periodically serialize a compressed hash or snapshot of the current game state into the tablet's local memory or localStorage.

Graceful Disconnect Detection: Listen to the rtcManager status change. When it hits disconnected, freeze the local game loop and display a non-intrusive modal: "Connection lost. Tap to quick-reconnect."

The 3-Second Re-Handshake: Because both tablets already know each other's cryptographic room keys and metadata, you can design a streamlined 1-tap QR code re-exchange. Tablet A generates a new short handshake token, Tablet B scans it, and the app instantly pushes the last saved state snapshot across the new data channel to sync them back up, bypassing a full game restart.

4. Data Channel Separation (Reliable vs. Unreliable Streams)
For an RTS game or streaming app, fault tolerance also applies to how data is delivered over the single connection:

Reliable Channel (TCP-like): Used for critical actions (e.g., starting a building, purchasing a unit). If a packet drops, WebRTC automatically retransmits it until it arrives.

Unreliable / Unordered Channel (UDP-like): Configured via WebRTC parameters (maxRetransmits: 0 or ordered: false), ideal for high-frequency minor updates (e.g., moving unit coordinates 30 times a second). If a coordinate packet drops due to network jitter, it is ignored, preventing lag buildup (head-of-line blocking) while newer packets keep flowing.