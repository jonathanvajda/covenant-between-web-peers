import { PeerRoom } from './network/room.js';
import { P2PTransport } from './network/transport.js';
import { RTCManager } from './core/rtc-manager.js';
import { encryptPayload, decryptPayload, MAX_TOKEN_LENGTH } from './core/crypto.js';
import { makeHandshakeLink } from './core/bridge.js';
import { parseRoomExchangeText, formatRoomExchangeCode, identifyRoomExchangeType } from './network/exchange.js';
import { createQRCodeCanvas, decodeQRCodeImage, startQRCodeVideoFallback } from './core/qr-code.js';

const element = id => document.getElementById(id);
let room;
let scanner;
let stopScannerFallback;
let busy = false;
let outgoingExchange;
const showError = error => {
    element('room-error').textContent = error?.message || String(error || 'Unable to complete this action.');
    element('room-error').hidden = false;
};
const showProgress = text => { element('room-progress').textContent = text; };

/** Erase consumed signaling data while leaving the current room alive. */
function clearOutgoingExchange() {
    outgoingExchange = null;
    element('room-outgoing').value = ''; element('room-outgoing-link').value = '';
    element('room-qr').replaceChildren(); element('room-large-qr').replaceChildren();
    element('room-share-panel').hidden = true;
    if (element('room-qr-dialog').open) element('room-qr-dialog').close();
}

/** Reflect completed handshakes once, instead of retaining a stale invitation/reply. */
function registerConnectedExchange(state) {
    if (!outgoingExchange || !state.connected.includes(outgoingExchange.remoteId)) return;
    const peerId = outgoingExchange.remoteId;
    clearOutgoingExchange();
    // A user may already be pasting the next code; never erase that newer input.
    showProgress(state.selfId === state.hostId
        ? `Participant ${peerId} connected. Choose Invite next peer; the response box is ready for their code.`
        : 'Connected to the room. Your response code has been applied by the host. You can chat now.');
}

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
    const pending = [...room.links.values()].some(link => !link.connected);
    element('invite-peer').disabled = busy || pending || !host || state.topology !== 'star' || state.transitioning || room.links.size >= 11;
    element('cancel-room-invite').disabled = busy || !host || !pending || state.transitioning || state.topology !== 'star';
    element('enable-mesh').disabled = busy || pending || !host || state.topology !== 'star' || state.transitioning || state.members.length < 2 || state.members.length > 6;
    const previous = element('room-recipient').value;
    element('room-recipient').replaceChildren(new Option('Everyone', ''));
    element('room-members').replaceChildren();
    for (const id of state.members) {
        const item = document.createElement('li');
        item.textContent = `${id}${id === state.selfId ? ' (you)' : ''}${id === state.hostId ? ' (host)' : ''}${state.connected.includes(id) ? ' — connected' : ''}${id !== state.selfId && !state.connected.includes(id) && state.topology === 'mesh' ? ' — disconnected' : ''}`;
        element('room-members').append(item);
        if (id !== state.selfId) element('room-recipient').append(new Option(id, id));
    }
    element('room-recipient').value = previous;
    element('room-incoming-label').textContent = host ? 'Next participant’s response code' : 'Received invitation or response code';
    registerConnectedExchange(state);
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
    const code = formatRoomExchangeCode(type, token);
    outgoingExchange = { type, remoteId: type === 'offer' ? payload.peerId : room.hostId, code };
    element('room-outgoing').value = code; element('room-outgoing-link').value = link;
    element('room-share-panel').hidden = false;
    element('room-share-title').textContent = type === 'offer' ? 'Send this invitation code to one peer' : 'Send this response code back to the host';
    element('room-qr').replaceChildren();
    try {
        element('room-qr').append(createQRCodeCanvas(code));
        element('room-qr-note').textContent = 'QR contains the same code, without a URL. Share the passphrase separately.';
    } catch {
        element('room-qr').replaceChildren(); element('room-qr-note').textContent = 'This code is too large for one QR. Copy, share, or save the code file instead.';
    }
    room.publishState();
}

async function inviteNextPeer() {
    const invitation = await room.createInvitation(element('room-password').value);
    await displayEncryptedExchange('offer', invitation);
    showProgress('Invitation ready. Send the code to one peer, then paste their response in the empty box above.');
}

async function useReceivedExchange() {
    const received = element('room-incoming').value;
    const { type: hint, token } = parseRoomExchangeText(received);
    const data = await decryptPayload(element('room-password').value, token);
    const type = identifyRoomExchangeType(data, hint);
    if (type === 'answer') {
        if (!room) throw new Error('Paste this reply in the original host tab.');
        await room.acceptReply(data, element('room-password').value);
        if (element('room-incoming').value === received) element('room-incoming').value = '';
        showProgress(`Response accepted for ${data.peerId}. Establishing connection…`);
        return;
    }
    if (room) throw new Error('Leave the current room before accepting an invitation.');
    initializeRoom(data.peerId, data.hostId);
    try {
        const reply = await room.answerInvitation(data, element('room-password').value);
        if (element('room-incoming').value === received) element('room-incoming').value = '';
        await displayEncryptedExchange('answer', reply);
        showProgress('Invitation accepted. Copy, share, or save your response code below and send it back to the host. Stay in this tab.');
    } catch (error) {
        room.close(); room = null;
        element('create-room').disabled = element('room-network').disabled = false;
        throw error;
    }
}

/** All receiving methods feed the current instance; none navigate to the received URL. */
async function receiveExchangeText(text) {
    element('room-incoming').value = text;
    if (element('room-password').value.trim()) return useReceivedExchange();
    showProgress('Code received. Enter the shared passphrase, then choose Apply received code.');
}

/** Clipboard denial retains a selectable code and gives a manual-copy fallback. */
async function copyExchangeText(id) {
    const field = element(id);
    if (!field.value) throw new Error('Create an invitation or response code first.');
    field.focus(); field.select();
    try { await navigator.clipboard.writeText(field.value); showProgress(id === 'room-outgoing' ? 'Code copied. Paste it into your messaging app as text.' : 'Optional link copied. Paste it into the existing room tab.'); }
    catch { showProgress('Automatic copying is unavailable. The text is selected; use your device’s Copy command.'); }
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
    room?.cancelPendingInvitations(); clearOutgoingExchange(); showProgress('Pending invitation cancelled. You can invite another peer.');
});
element('use-room-token').onclick = () => runRoomOperation(useReceivedExchange);
element('enable-mesh').onclick = () => runRoomOperation(() => room.enableMesh());
element('copy-room-token').onclick = () => runRoomOperation(() => copyExchangeText('room-outgoing'));
element('copy-room-link').onclick = () => runRoomOperation(() => copyExchangeText('room-outgoing-link'));
element('share-room-token').onclick = () => runRoomOperation(async () => {
    if (!outgoingExchange) throw new Error('Create an invitation or response code first.');
    if (!navigator.share) return copyExchangeText('room-outgoing');
    try { await navigator.share({ text: outgoingExchange.code }); showProgress('Code shared. Keep this room tab open.'); }
    catch (error) { if (error.name !== 'AbortError') await copyExchangeText('room-outgoing'); }
});
element('paste-room-token').onclick = () => runRoomOperation(async () => {
    let text;
    try { text = await navigator.clipboard.readText(); }
    catch { element('room-incoming').focus(); showProgress('Clipboard access is unavailable. Paste the code into the received-code box using your device’s Paste command.'); return; }
    await receiveExchangeText(text);
});
element('room-incoming').addEventListener('paste', event => {
    if (busy) return;
    const text = event.clipboardData?.getData('text');
    if (!text) return;
    event.preventDefault(); runRoomOperation(() => receiveExchangeText(text));
});
element('download-room-token').onclick = () => runRoomOperation(() => {
    if (!outgoingExchange) throw new Error('Create an invitation or response code first.');
    const url = URL.createObjectURL(new Blob([outgoingExchange.code], { type: 'text/plain' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `covenant-${outgoingExchange.type}-code.txt`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showProgress('Code file saved. Send the file to your peer; they can use Load code file in their existing room tab.');
});
element('upload-room-token').onclick = () => element('room-code-file').click();
element('room-code-file').onchange = () => runRoomOperation(async () => {
    const file = element('room-code-file').files[0]; element('room-code-file').value = '';
    if (!file) return;
    if (file.size > MAX_TOKEN_LENGTH + 4096) throw new Error('That code file is too large.');
    await receiveExchangeText(await file.text());
});
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
    stopScannerFallback?.(); stopScannerFallback = null;
    if (scanner && scanner.getState() !== Html5QrcodeScannerState.NOT_STARTED) await scanner.stop();
    scanner = null; element('room-scanner').close();
}
element('scan-room-token').onclick = () => runRoomOperation(async () => {
    element('room-scanner').showModal(); scanner = new Html5Qrcode('room-reader');
    const onDecoded = text => {
        runRoomOperation(async () => { await closeRoomScanner(); await receiveExchangeText(text); });
    };
    try {
        await scanner.start({ facingMode: 'environment' }, { fps: 8 }, onDecoded);
        if (scanner) stopScannerFallback = startQRCodeVideoFallback(() => element('room-reader').querySelector('video'), onDecoded);
    } catch (error) { await closeRoomScanner(); throw error; }
});
element('upload-room-qr').onclick = () => element('room-qr-file').click();
element('room-qr-file').onchange = () => runRoomOperation(async () => {
    const file = element('room-qr-file').files[0]; element('room-qr-file').value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a QR image smaller than 10 MB.');
    await closeRoomScanner();
    await receiveExchangeText(await decodeQRCodeImage(file));
});
element('enlarge-room-qr').onclick = () => runRoomOperation(() => {
    if (!outgoingExchange) return;
    element('room-large-qr').replaceChildren();
    try { element('room-large-qr').append(createQRCodeCanvas(outgoingExchange.code, 640)); }
    catch { throw new Error('Code is too large for a QR. Copy, share, or save it as a file.'); }
    element('room-qr-dialog').showModal();
});
element('close-large-room-qr').onclick = () => element('room-qr-dialog').close();
element('close-room-scanner').onclick = () => runRoomOperation(closeRoomScanner);
element('room-scanner').addEventListener('cancel', event => { event.preventDefault(); runRoomOperation(closeRoomScanner); });
function captureIncomingRoomLink() {
    if (!location.hash) return;
    const received = location.href;
    history.replaceState(null, '', location.pathname + location.search);
    if (busy) {
        element('room-incoming').value = received;
        showProgress('Another code arrived while working. It is in the received-code box; choose Apply received code when ready.');
        return;
    }
    runRoomOperation(() => receiveExchangeText(received));
}
window.addEventListener('hashchange', captureIncomingRoomLink);
document.addEventListener('visibilitychange', () => { if (document.hidden) closeRoomScanner().catch(showError); });
captureIncomingRoomLink();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(showError);
