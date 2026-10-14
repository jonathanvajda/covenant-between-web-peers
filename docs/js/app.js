import { encryptPayload, decryptPayload } from './core/crypto.js';
import { RTCManager, validateHandshake } from './core/rtc-manager.js';
import { ModuleRegistry } from './core/module-registry.js';
import { parseHandshakeInput, makeHandshakeLink } from './core/bridge.js';
import { createChatModule } from './modules/chat.js';

const $ = id => document.getElementById(id);
const rtc = new RTCManager();
const registry = new ModuleRegistry(rtc);
const error = message => { $('error').textContent = message; $('error').hidden = !message; };
const notice = message => { $('notice').textContent = message; $('notice').hidden = !message; };
const chat = createChatModule($('chat'), { getSender: () => $('display-name').value, onError: error });
registry.registerModule(chat);
let busy = false;
let supported = true;
let role = null;
let scanner = null;
let scannerStart = null;
let stopScannerPromise = null;
let connectionTimer = null;
const labels = { closed: 'Ready to connect', new: 'Preparing connection', gathering: 'Gathering network routes',
    checking: 'Connecting to peer', connected: 'Connected', completed: 'Connected', disconnected: 'Disconnected', failed: 'Connection failed' };

function controls() {
    for (const id of ['host', 'join', 'process', 'scan']) $(id).disabled = busy || !supported;
    $('host').disabled ||= !!role;
    $('join').disabled ||= !!role;
    $('room-pass').disabled = busy || !!role;
    $('reset').disabled = busy;
}
function waitForConnection() {
    clearTimeout(connectionTimer);
    connectionTimer = setTimeout(() => {
        if (!rtc.connected) error('The peer has not connected. Confirm that the host used the reply in its original tab. If both links were exchanged, try another network; this app has no TURN relay.');
    }, 45000);
}
rtc.addEventListener('status', ({ detail }) => {
    $('connection-status').textContent = labels[detail] || detail;
    $('connection-status').dataset.state = detail;
    if (detail === 'failed') error('A direct connection could not be established. Try another network, then start over on both devices. Some networks require a TURN relay, which this app does not use.');
});
rtc.addEventListener('connected', () => {
    clearTimeout(connectionTimer); error(''); notice('Connected. Your messages now travel directly to your peer.');
    $('instructions').textContent = 'Channel open. Keep both tabs open while chatting.';
    $('chat-input').placeholder = 'Write a message';
});
rtc.addEventListener('disconnected', () => {
    $('chat-input').placeholder = 'Connect to start chatting';
    if (role) notice('The connection was interrupted. Wait briefly for recovery, or start over on both devices to exchange fresh links.');
});
rtc.addEventListener('error', ({ detail }) => error(detail));

async function run(action) {
    if (busy || !supported) return;
    busy = true; controls(); error(''); notice('');
    try { await action(); }
    catch (cause) {
        error(cause.message || 'Unable to complete this action.');
        // A failed setup cannot leave a hidden, partially initialized connection behind.
        if (!role) rtc.close();
    } finally { busy = false; controls(); }
}
function passphrase() {
    const value = $('room-pass').value;
    if (!value.trim()) throw new Error('Enter the shared passphrase first.');
    return value;
}
function showShare(type, token) {
    $('outgoing').value = makeHandshakeLink(location.href, type, token);
    $('share-title').textContent = type === 'offer' ? 'Your invitation' : 'Your reply';
    $('share-panel').hidden = false;
    $('share-qr').replaceChildren(); $('share-qr-error').hidden = true;
    try { $('share-qr').append(createQR($('outgoing').value)); }
    catch {
        $('share-qr-error').hidden = false;
        $('share-qr-error').textContent = 'This link is too large for a single QR code. Use Copy link instead.';
    }
    $('instructions').textContent = type === 'offer'
        ? 'Send this invitation to your peer. Keep this tab open, then paste or scan their reply above.'
        : 'Send this reply to the host. They must paste or scan it into their original tab. Keep this tab open.';
}
async function receive() {
    const secret = passphrase();
    const parsed = parseHandshakeInput($('incoming').value);
    const payload = await decryptPayload(secret, parsed.token);
    if (parsed.type && parsed.type !== payload.type) throw new Error('Connection link type does not match its encrypted payload.');
    if (payload.type === 'offer') {
        if (role) throw new Error('A connection is already active. Start over before joining a different channel.');
        validateHandshake(payload, 'offer');
        const answer = await rtc.createJoinAnswer(payload);
        const token = await encryptPayload(secret, answer);
        role = 'joiner'; showShare('answer', token);
    } else if (payload.type === 'answer') {
        await rtc.handleAnswer(payload);
        waitForConnection();
        $('instructions').textContent = 'Reply accepted. Establishing the direct connection…';
    } else { throw new Error('This is not an offer or answer.'); }
    $('incoming').value = '';
}
$('host').addEventListener('click', () => run(async () => {
    const secret = passphrase();
    const offer = await rtc.createHostOffer();
    const token = await encryptPayload(secret, offer);
    chat.clear(); role = 'host'; showShare('offer', token);
}));
$('join').addEventListener('click', () => {
    if ($('incoming').value.trim()) run(receive);
    else { $('incoming').focus(); notice('Paste the host’s invitation or scan its QR code, then choose “Use received link”.'); }
});
$('process').addEventListener('click', () => run(receive));
$('reset').addEventListener('click', () => {
    clearTimeout(connectionTimer); rtc.close(); role = null; chat.clear();
    $('incoming').value = $('outgoing').value = $('room-pass').value = '';
    $('share-panel').hidden = true; error(''); notice('');
    $('instructions').textContent = 'One person opens a channel. The other joins using the invitation and returns a reply.';
    controls();
});
$('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('outgoing').value); notice('Link copied. Send it to your peer using your preferred messaging app.'); }
    catch { $('outgoing').focus(); $('outgoing').select(); notice('Clipboard access is unavailable. Copy the selected link manually.'); }
});
function createQR(text) {
    const qr = window.qrcode(0, 'L');
    qr.addData(text, 'Byte'); qr.make();
    const count = qr.getModuleCount();
    const cell = 4;
    const border = 4;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = (count + border * 2) * cell;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) ctx.fillRect((col + border) * cell, (row + border) * cell, cell, cell);
    }
    return canvas;
}
$('show-qr').addEventListener('click', () => {
    $('qr-code').replaceChildren(); $('qr-error').hidden = true;
    $('qr-title').textContent = role === 'host' ? 'Scan this invitation' : 'Scan this reply';
    $('qr-dialog').showModal();
    try {
        $('qr-code').append(createQR($('outgoing').value));
    } catch {
        $('qr-code').replaceChildren(); $('qr-error').hidden = false;
        $('qr-error').textContent = 'This connection link is too large for a single QR code. Close this dialog and use Copy link instead.';
    }
});
$('close-qr').addEventListener('click', () => $('qr-dialog').close());

async function stopScanner() {
    if (stopScannerPromise) return stopScannerPromise;
    stopScannerPromise = (async () => {
        try {
            if (scannerStart) { try { await scannerStart; } catch { /* Permission error is shown by start handler. */ } }
            if (scanner?.isScanning) await scanner.stop();
            scanner?.clear();
        } catch { /* Camera may already have stopped after browser permission changes. */ }
        finally { scanner = null; scannerStart = null; }
    })();
    await stopScannerPromise;
    stopScannerPromise = null;
}
$('scan').addEventListener('click', async () => {
    if (scanner || stopScannerPromise) return;
    $('scanner-error').hidden = true;
    $('scanner-dialog').showModal();
    try {
        if (!navigator.mediaDevices?.getUserMedia || !window.Html5Qrcode) throw new Error('Camera scanning is unavailable. Paste the link instead.');
        scanner = new window.Html5Qrcode('qr-reader', { formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
        let captured = false;
        scannerStart = scanner.start({ facingMode: 'environment' }, { fps: 8 }, async text => {
            if (captured) return;
            try { parseHandshakeInput(text); }
            catch { $('scanner-error').textContent = 'This QR code is not a connection link.'; $('scanner-error').hidden = false; return; }
            captured = true; $('incoming').value = text;
            await stopScanner(); $('scanner-dialog').close();
            if ($('room-pass').value.trim()) await run(receive);
            else { notice('Link scanned. Enter your shared passphrase, then choose “Use received link”.'); $('room-pass').focus(); }
        });
        await scannerStart;
    } catch (cause) {
        $('scanner-error').textContent = `Cannot start camera: ${cause.message || cause}. You can paste the link instead.`;
        $('scanner-error').hidden = false;
        await stopScanner();
    }
});
$('close-scanner').addEventListener('click', () => $('scanner-dialog').close());
$('scanner-dialog').addEventListener('close', stopScanner);
document.addEventListener('visibilitychange', () => {
    if (document.hidden && $('scanner-dialog').open) $('scanner-dialog').close();
});

function consumeHash() {
    if (!location.hash) return;
    const fragment = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    try {
        const parsed = parseHandshakeInput(fragment);
        $('incoming').value = fragment;
        notice(parsed.type === 'answer'
            ? 'Reply received. It must be applied in the original host tab. If this is a new tab, copy the received link into that tab.'
            : 'Invitation received. Enter the shared passphrase, then choose “Use received link”.');
        $('room-pass').focus();
    } catch (cause) { error(cause.message); }
}
window.addEventListener('hashchange', consumeHash);
consumeHash();
window.addEventListener('pagehide', () => { rtc.close(); stopScanner(); });

if (!window.isSecureContext || !window.crypto?.subtle || !window.RTCPeerConnection) {
    supported = false;
    error('Use a browser with WebRTC and Web Crypto over HTTPS, or localhost for development. Opening this file directly is not supported.');
}
controls();
if (supported && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(async registration => {
        await navigator.serviceWorker.ready;
        $('offline-status').textContent = 'App assets are ready for offline use. New connections across the internet still need network access.';
        if (registration.waiting) notice('An app update is ready. Reload after your conversation to use it.');
    }).catch(() => { $('offline-status').textContent = 'Offline caching is unavailable in this browser. The app can still work while online.'; });
}
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install').hidden = false; });
$('install').addEventListener('click', async () => { await installPrompt?.prompt(); installPrompt = null; $('install').hidden = true; });
