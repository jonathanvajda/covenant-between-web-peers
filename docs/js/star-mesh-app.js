import { PeerRoom } from './network/room.js';
import { P2PTransport } from './network/transport.js';
import { RTCManager } from './core/rtc-manager.js';
import { encryptPayload, decryptPayload } from './core/crypto.js';
import { parseHandshakeInput, makeHandshakeLink } from './core/bridge.js';

const element = id => document.getElementById(id);
let room;
let scanner;
let busy = false;
const showError = error => { element('room-error').textContent = error.message; element('room-error').hidden = false; };

/** Render data with textContent so peer-controlled content cannot become markup. */
function renderRoomMessage(message) {
    const article = document.createElement('article');
    article.className = `message${message.senderId === room.selfId ? ' mine' : ''}`;
    const author = document.createElement('strong');
    author.textContent = `${message.senderId}${message.targetId ? ` → ${message.targetId} (private)` : ''}`;
    const body = document.createElement('p'); body.textContent = message.payload.text;
    article.append(author, body); element('chat-messages').append(article);
    while (element('chat-messages').children.length > 300) element('chat-messages').firstElementChild.remove();
    article.scrollIntoView({ block: 'nearest' });
}

function renderRoomState(state) {
    element('room-status').textContent = `${state.topology}${state.transitioning ? ' / preparing mesh' : ''} · ${state.connected.length} links`;
    const host = state.selfId === state.hostId;
    element('invite-peer').disabled = busy || !host || state.topology !== 'star' || state.transitioning || room.links.size >= 11;
    element('enable-mesh').disabled = busy || !host || state.topology !== 'star' || state.transitioning || state.members.length < 2 || state.members.length > 6;
    const previous = element('room-recipient').value;
    element('room-recipient').replaceChildren(new Option('Everyone', ''));
    element('room-members').replaceChildren();
    for (const id of state.members) {
        const item = document.createElement('li');
        item.textContent = `${id}${id === state.selfId ? ' (you)' : ''}${id === state.hostId ? ' (host)' : ''}${id !== state.selfId && !state.connected.includes(id) && state.topology === 'mesh' ? ' — disconnected' : ''}`;
        element('room-members').append(item);
        if (id !== state.selfId) element('room-recipient').append(new Option(id, id));
    }
    element('room-recipient').value = previous;
}

function initializeRoom(selfId, hostId) {
    const localOnly = element('room-network').value === 'local';
    room = new PeerRoom({ selfId, hostId, onMessage: renderRoomMessage, onState: renderRoomState, onError: showError,
        transportFactory: options => new P2PTransport({ ...options,
            managerFactory: () => new RTCManager(localOnly ? { iceServers: [], gatherTimeout: 3000 } : {}) }) });
    element('room-network').disabled = true; element('create-room').disabled = true;
    room.publishState();
}

async function displayEncryptedExchange(type, payload) {
    const token = await encryptPayload(element('room-password').value, payload);
    const link = makeHandshakeLink(location.href, type, token);
    element('room-outgoing').value = link; element('room-qr').replaceChildren();
    try {
        new QRCode(element('room-qr'), { text: link, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.L });
        element('room-qr-note').textContent = 'Scan or copy this link. Share the passphrase separately.';
    } catch {
        element('room-qr').replaceChildren(); element('room-qr-note').textContent = 'This link is too large for a QR code. Copy the link instead.';
    }
}

async function inviteNextPeer() {
    const invitation = await room.createInvitation(element('room-password').value);
    await displayEncryptedExchange('offer', invitation);
}

async function useReceivedExchange() {
    const { type, token } = parseHandshakeInput(element('room-incoming').value);
    const data = await decryptPayload(element('room-password').value, token);
    if (type === 'answer') {
        if (!room) throw new Error('Paste this reply in the original host tab.');
        await room.acceptReply(data, element('room-password').value); return;
    }
    if (room) throw new Error('Leave the current room before accepting an invitation.');
    initializeRoom(data.peerId, data.hostId);
    const reply = await room.answerInvitation(data, element('room-password').value);
    await displayEncryptedExchange('answer', reply);
}

/** Serialize UI operations so invitation and mesh state cannot race. */
async function runRoomOperation(operation) {
    if (busy) return;
    busy = true; element('room-error').hidden = true;
    try { await operation(); } catch (error) { showError(error); }
    finally { busy = false; room?.publishState(); }
}

element('create-room').onclick = () => runRoomOperation(async () => {
    if (!element('room-password').value.trim()) throw new Error('Enter a shared passphrase.');
    const id = crypto.randomUUID(); initializeRoom(id, id); await inviteNextPeer();
});
element('invite-peer').onclick = () => runRoomOperation(inviteNextPeer);
element('cancel-room-invite').onclick = () => runRoomOperation(() => {
    room?.cancelPendingInvitations(); element('room-outgoing').value = ''; element('room-qr').replaceChildren();
});
element('use-room-token').onclick = () => runRoomOperation(useReceivedExchange);
element('enable-mesh').onclick = () => runRoomOperation(() => room.enableMesh());
element('copy-room-token').onclick = () => runRoomOperation(() => navigator.clipboard.writeText(element('room-outgoing').value));
element('leave-room').onclick = () => { if (!busy) { room?.close(); location.replace(location.pathname); } };
element('room-chat-form').onsubmit = event => {
    event.preventDefault();
    runRoomOperation(() => {
        if (!room) throw new Error('Create or join a room first.');
        room.sendChat(element('room-chat-input').value, element('room-recipient').value || null);
        element('room-chat-input').value = '';
    });
};
async function closeRoomScanner() {
    if (scanner?.isScanning) await scanner.stop();
    scanner = null; element('room-scanner').close();
}
element('scan-room-token').onclick = () => runRoomOperation(async () => {
    element('room-scanner').showModal(); scanner = new Html5Qrcode('room-reader');
    await scanner.start({ facingMode: 'environment' }, { fps: 8 }, async text => {
        element('room-incoming').value = text; await closeRoomScanner();
    });
});
element('close-room-scanner').onclick = () => runRoomOperation(closeRoomScanner);
element('room-scanner').addEventListener('cancel', event => { event.preventDefault(); runRoomOperation(closeRoomScanner); });
if (location.hash) {
    element('room-incoming').value = location.href;
    history.replaceState(null, '', location.pathname + location.search);
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(showError);
