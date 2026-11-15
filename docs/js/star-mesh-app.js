import { PeerRoom } from './network/room.js';
import { P2PTransport } from './network/transport.js';
import { RTCManager } from './core/rtc-manager.js';
import { encryptPayload, decryptPayload, MAX_TOKEN_LENGTH } from './core/crypto.js';
import { makeHandshakeLink } from './core/bridge.js';
import { parseRoomExchangeText, formatRoomExchangeCode, identifyRoomExchangeType } from './network/exchange.js';
import { createQRCodeCanvas, decodeQRCodeImage, startQRCodeVideoFallback } from './core/qr-code.js';
import { deriveRoomConnectionFlow } from './network/room-flow.js';

const element = id => document.getElementById(id);
let room;
let scanner;
let stopScannerFallback;
let busy = false;
let outgoingExchange;
let selectedRole = null;
let invitationNumber = 0;
let answerAccepted = false;
const showError = error => {
    element('room-error').textContent = error?.message || String(error || 'Unable to complete this action.');
    element('room-error').hidden = false;
};
const showProgress = text => { element('room-progress').textContent = text; };

/** Show only the next steps for the chosen role and the current invitation. */
function renderConnectionFlow() {
    const connectedCount = room?.connectedPeers().length || 0;
    const flow = deriveRoomConnectionFlow({ role: selectedRole, hasRoom: Boolean(room),
        exchangeType: outgoingExchange?.type || null, answerAccepted,
        connectedCount, topology: room?.topology || 'star' });
    const sections = {
        'room-role-choice': flow.showChoice, 'room-connection-panel': !flow.showChoice,
        'room-settings': flow.showSettings, 'room-create-actions': flow.showCreate,
        'room-host-actions': flow.showInvite, 'room-receive-panel': flow.showReceive,
        'room-share-panel': flow.showShare, 'room-cancel-actions': flow.showCancel,
        'room-members-panel': flow.showMembers, 'room-chat-panel': flow.showChat,
        'room-topology-options': flow.showTopology
    };
    for (const [id, visible] of Object.entries(sections)) element(id).hidden = !visible;
    element('room-connection-panel').dataset.phase = flow.phase;
    element('setup-heading').textContent = flow.hosting ? 'You are creating / hosting this room' : 'You are joining a room';
    const summaries = {
        'host-setup': '1. Set a passphrase, then create your room and its first invitation.',
        'join-setup': '1. Enter the host’s passphrase. 2. Apply their invitation below.',
        'host-invitation': `Invitation ${invitationNumber}: send it to ONE person, then apply only that person’s response below.`,
        connecting: `Invitation ${invitationNumber}: response accepted. Waiting for this person to connect.`,
        'join-response': '2. Send your response to the host. Keep this tab open while they apply it.',
        'host-ready': connectedCount ? 'Your room is connected. Invite another person when you are ready.' : 'Your room is ready. Create an invitation for one person.',
        joined: connectedCount ? 'You have joined the room. You can chat below.' : 'Waiting for the host connection. Keep this tab open.'
    };
    element('room-step-summary').textContent = summaries[flow.phase] || '';
    if (flow.phase === 'host-ready' && room?.topology === 'mesh')
        element('room-step-summary').textContent = 'Your mesh room is connected. All participants communicate directly; new invitations require a new room.';
    element('room-password-help').textContent = flow.hosting ? 'Choose a passphrase and tell your guests separately from the invitation.' : 'Use the passphrase the host gave you.';
    element('room-receive-heading').textContent = flow.hosting ? `2. Receive the response for Invitation ${invitationNumber}` : 'Apply the host’s invitation';
    element('room-incoming-label').textContent = flow.hosting ? `Response to Invitation ${invitationNumber} only` : 'Host’s invitation code';
    element('use-room-token').textContent = flow.hosting ? 'Connect this person' : 'Join using this invitation';
    element('room-code-help').textContent = flow.hosting
        ? 'Only the response to the invitation above is accepted here. A response from a cancelled or different invitation will be rejected.'
        : 'Paste the invitation, load its code file, or scan it. After it is accepted, you will get a response to send back to the host.';
    element('room-share-title').textContent = flow.hosting ? `1. Send Invitation ${invitationNumber} to one person` : '2. Send your response back to the host';
    element('room-share-help').textContent = flow.hosting
        ? 'This code and QR are for one person, not the whole group. Finish or cancel this invitation before creating another.'
        : 'Send this response to the host who invited you. They must apply it in their original room tab.';
    element('room-password').disabled = busy;
    element('room-network').disabled = busy || Boolean(room);
    element('create-room').disabled = busy || Boolean(room);
    element('use-room-token').disabled = busy;
    element('room-chat-form').querySelectorAll('input, button, select').forEach(control => { control.disabled = !connectedCount; });
    element('room-connection-panel').closest('.workspace').classList.toggle('room-setup-only', !flow.showChat);
}

function selectRoomRole(role) {
    if (room || busy) return;
    selectedRole = role;
    element('room-error').hidden = true;
    renderConnectionFlow();
    showProgress(role === 'host' ? 'You will host this room. Create the room to generate an invitation.' : 'You will join someone else’s room. Enter the host’s passphrase and invitation.');
    element('room-password').focus();
}

/** Erase consumed signaling data while leaving the current room alive. */
function clearOutgoingExchange() {
    outgoingExchange = null;
    answerAccepted = false;
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
        ? `Invitation ${invitationNumber} completed. Participant ${peerId} connected. Choose Invite next person to get a fresh invitation and empty response box.`
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
    registerConnectedExchange(state);
    renderConnectionFlow();
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
    element('room-incoming').value = '';
    answerAccepted = false;
    showProgress('Preparing a fresh invitation for one person…');
    const invitation = await room.createInvitation(element('room-password').value);
    invitationNumber++;
    await displayEncryptedExchange('offer', invitation);
    showProgress(`Invitation ${invitationNumber} ready. Send it to one person; receive that person’s response below. This QR cannot invite multiple people.`);
}

async function useReceivedExchange() {
    const received = element('room-incoming').value;
    const { type: hint, token } = parseRoomExchangeText(received);
    const data = await decryptPayload(element('room-password').value, token);
    const type = identifyRoomExchangeType(data, hint);
    if (type === 'answer') {
        if (!room) throw new Error('Paste this reply in the original host tab.');
        if (selectedRole !== 'host' || outgoingExchange?.type !== 'offer' || outgoingExchange.remoteId !== data.peerId || answerAccepted)
            throw new Error(`This response does not match the current invitation. Use only the response to Invitation ${invitationNumber}, or ask the person to use a fresh invitation.`);
        await room.acceptReply(data, element('room-password').value);
        answerAccepted = true;
        if (element('room-incoming').value === received) element('room-incoming').value = '';
        showProgress(`Response accepted for ${data.peerId}. Establishing connection…`);
        return;
    }
    if (selectedRole === 'host') throw new Error(room
        ? `This is an invitation code. Ask the person for their response to Invitation ${invitationNumber}; your room is still open.`
        : 'You chose to create a room. Start over and choose Join a room to use someone else’s invitation.');
    if (room) throw new Error('You have already joined a room. Stay in this tab and send your response to the host.');
    selectedRole = 'join';
    showProgress('Invitation verified. Preparing your response code…');
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
    if (!selectedRole && !room) { selectedRole = 'join'; renderConnectionFlow(); }
    if (element('room-password').value.trim()) return useReceivedExchange();
    showProgress('Code received. Enter the shared passphrase, then choose Join using this invitation.');
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
    renderConnectionFlow();
    try { await operation(); } catch (error) { showError(error); }
    finally { busy = false; room?.publishState(); renderConnectionFlow(); }
}

element('choose-create-room').onclick = () => selectRoomRole('host');
element('choose-join-room').onclick = () => selectRoomRole('join');

element('create-room').onclick = () => runRoomOperation(async () => {
    selectedRole = 'host';
    if (!element('room-password').value.trim()) throw new Error('Enter a shared passphrase.');
    const id = crypto.randomUUID(); initializeRoom(id, id); await inviteNextPeer();
});
element('invite-peer').onclick = () => runRoomOperation(inviteNextPeer);
element('cancel-room-invite').onclick = () => runRoomOperation(() => {
    if (outgoingExchange?.type === 'offer') room?.removePeer(outgoingExchange.remoteId);
    clearOutgoingExchange(); element('room-incoming').value = '';
    showProgress('Invitation cancelled. Its code and response are no longer valid. Choose Invite next person for a fresh invitation.');
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
renderConnectionFlow();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(showError);
