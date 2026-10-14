import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, decryptPayload } from '../docs/js/core/crypto.js';
import { RTCManager, validateHandshake, HANDSHAKE_TTL } from '../docs/js/core/rtc-manager.js';
import { ModuleRegistry } from '../docs/js/core/module-registry.js';
import { parseHandshakeInput, makeHandshakeLink } from '../docs/js/core/bridge.js';

const secret = 'a separate strong secret';
const offer = () => ({ version: 1, type: 'offer', session: crypto.randomUUID(), createdAt: Date.now(), sdp: { type: 'offer', sdp: 'v=0\r\na=candidate:example\r\n'.repeat(30) } });

test('compressed Unicode JSON survives encryption; fresh salts and IVs produce unique tokens', async () => {
    const payload = { ...offer(), message: 'Hello 👋 世界' };
    const first = await encryptPayload(secret, payload);
    const second = await encryptPayload(secret, payload);
    assert.match(first, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(first, second);
    assert.ok(first.length < JSON.stringify(payload).length);
    assert.deepEqual(await decryptPayload(secret, first), payload);
    assert.deepEqual(await decryptPayload(secret, second), payload);
});
test('wrong secrets, ciphertext tampering, and header tampering fail authentication', async () => {
    const token = await encryptPayload(secret, offer());
    await assert.rejects(decryptPayload('wrong', token), /Cannot decrypt/);
    const bytes = Buffer.from(token, 'base64url');
    bytes[bytes.length - 5] ^= 1;
    await assert.rejects(decryptPayload(secret, bytes.toString('base64url')), /Cannot decrypt/);
    bytes[bytes.length - 5] ^= 1; bytes[1] ^= 1;
    await assert.rejects(decryptPayload(secret, bytes.toString('base64url')), /Cannot decrypt/);
});
test('malformed and oversized tokens and empty secrets are rejected', async () => {
    for (const token of ['', 'not a token', 'a'.repeat(65537), 'AQ']) await assert.rejects(decryptPayload(secret, token));
    await assert.rejects(encryptPayload('', offer()), /passphrase/);
    await assert.rejects(encryptPayload(secret, { body: 'a'.repeat(262145) }), /too large/);
});
test('uncompressed envelope remains compatible when CompressionStream is unavailable', async () => {
    const stream = globalThis.CompressionStream;
    try {
        globalThis.CompressionStream = undefined;
        const payload = { message: 'small' };
        const token = await encryptPayload(secret, payload);
        assert.equal(Buffer.from(token, 'base64url')[1], 0);
        assert.deepEqual(await decryptPayload(secret, token), payload);
    } finally { globalThis.CompressionStream = stream; }
});
test('links support project subpaths, fragments and raw tokens, and remove queries', () => {
    const link = makeHandshakeLink('https://example.com/project/?tracking=1#old', 'offer', 'abc_DEF-123');
    assert.equal(link, 'https://example.com/project/#offer=abc_DEF-123');
    for (const input of [link, '#offer=abc_DEF-123', 'offer=abc_DEF-123'])
        assert.deepEqual(parseHandshakeInput(input), { type: 'offer', token: 'abc_DEF-123' });
    assert.deepEqual(parseHandshakeInput('abc_DEF-123'), { type: null, token: 'abc_DEF-123' });
    for (const input of ['', '#offer=abc&answer=def', '#offer=', '#answer=a%20b', 'https://example.com/no-hash'])
        assert.throws(() => parseHandshakeInput(input));
});
test('handshakes validate version, type, expiry, and SDP', () => {
    const payload = offer();
    assert.equal(validateHandshake(payload, 'offer'), payload);
    for (const bad of [null, { ...payload, version: 2 }, { ...payload, type: 'answer' },
        { ...payload, createdAt: Date.now() - HANDSHAKE_TTL - 1 }, { ...payload, createdAt: Date.now() + 600000 },
        { ...payload, sdp: { type: 'offer', sdp: '<script>' } }]) assert.throws(() => validateHandshake(bad, 'offer'));
});

class FakeChannel {
    constructor() { this.readyState = 'connecting'; this.bufferedAmount = 0; this.sent = []; }
    send(message) { this.sent.push(message); }
    close() { this.readyState = 'closed'; }
}
class FakePeer extends EventTarget {
    static gathering = 'complete';
    constructor() { super(); this.iceGatheringState = FakePeer.gathering; this.iceConnectionState = 'new'; this.signalingState = 'stable'; }
    createDataChannel() { return new FakeChannel(); }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\na=candidate:complete' }; }
    async createAnswer() { return { type: 'answer', sdp: 'v=0\r\na=candidate:complete' }; }
    async setLocalDescription(sdp) { this.localDescription = sdp; this.signalingState = sdp.type === 'offer' ? 'have-local-offer' : 'stable'; }
    async setRemoteDescription(sdp) { this.remoteDescription = sdp; this.signalingState = sdp.type === 'offer' ? 'have-remote-offer' : 'stable'; }
    close() { this.closed = true; }
}
globalThis.RTCPeerConnection = FakePeer;

test('ICE gathering already complete resolves; answer must match live host session', async () => {
    const rtc = new RTCManager();
    const hostOffer = await rtc.createHostOffer();
    assert.match(hostOffer.sdp.sdp, /candidate/);
    const answer = { ...hostOffer, type: 'answer', sdp: { type: 'answer', sdp: 'v=0\r\n' } };
    await assert.rejects(rtc.handleAnswer({ ...answer, session: crypto.randomUUID() }), /another connection/);
    await rtc.handleAnswer(answer);
    await assert.rejects(rtc.handleAnswer(answer), /original host tab/);
    rtc.close();
    await assert.rejects(rtc.handleAnswer(answer), /original host tab/);
});
test('ICE completion events resolve and close cancels an in-flight gather', async () => {
    FakePeer.gathering = 'gathering';
    const rtc = new RTCManager();
    try {
        const pending = rtc.createHostOffer();
        await new Promise(resolve => setImmediate(resolve));
        rtc.pc.iceGatheringState = 'complete'; rtc.pc.dispatchEvent(new Event('icegatheringstatechange'));
        assert.equal((await pending).type, 'offer');
        const canceled = rtc.createHostOffer();
        await new Promise(resolve => setImmediate(resolve));
        rtc.close(); await assert.rejects(canceled, /closed/);
    } finally { FakePeer.gathering = 'complete'; rtc.close(); }
});
test('ICE timeout fails rather than publishing an incomplete offer', async () => {
    FakePeer.gathering = 'gathering';
    const rtc = new RTCManager({ gatherTimeout: 10 });
    try { await assert.rejects(rtc.createHostOffer(), /timed out/); }
    finally { FakePeer.gathering = 'complete'; rtc.close(); }
});
test('joiner preserves session and accepts only the expected data channel', async () => {
    const rtc = new RTCManager();
    const invitation = offer();
    const answer = await rtc.createJoinAnswer(invitation);
    assert.equal(answer.session, invitation.session);
    assert.equal(answer.type, 'answer');
    const invalid = new FakeChannel(); invalid.label = 'unexpected';
    rtc.pc.ondatachannel({ channel: invalid }); assert.equal(invalid.readyState, 'closed');
    const valid = new FakeChannel(); valid.label = 'p2p-channel';
    rtc.pc.ondatachannel({ channel: valid }); assert.equal(rtc.dataChannel, valid);
    rtc.close();
});
test('transport validates incoming messages, connection state, size, and backpressure', async () => {
    const rtc = new RTCManager();
    await rtc.createHostOffer();
    assert.throws(() => rtc.send({ body: 'hello' }), /Connect/);
    rtc.dataChannel.readyState = 'open'; rtc.pc.iceConnectionState = 'connected';
    rtc.send({ body: 'hello' }); assert.equal(rtc.dataChannel.sent.length, 1);
    assert.throws(() => rtc.send({ body: 'x'.repeat(17000) }), /too large/);
    rtc.dataChannel.bufferedAmount = 70000;
    assert.throws(() => rtc.send({ body: 'hello' }), /busy/);
    let errors = 0; let received;
    rtc.addEventListener('error', () => errors++);
    rtc.addEventListener('message', event => { received = event.detail; });
    rtc.dataChannel.onmessage({ data: '{bad' });
    rtc.dataChannel.onmessage({ data: 'x'.repeat(17000) });
    rtc.dataChannel.onmessage({ data: JSON.stringify({ body: 'valid' }) });
    assert.equal(errors, 2); assert.deepEqual(received, { body: 'valid' });
    const pc = rtc.pc; const channel = rtc.dataChannel;
    rtc.close(); assert.equal(pc.closed, true); assert.equal(channel.readyState, 'closed');
});
test('registry routes modules by id, reports lifecycle, namespaces sends, and unregisters', () => {
    const transport = new EventTarget(); transport.connected = false;
    const sent = []; transport.send = payload => sent.push(payload);
    const registry = new ModuleRegistry(transport);
    const messages = []; const states = [];
    let api; let destroyed = false;
    const module = { id: 'chat', init(context) { api = context; }, onMessage(data) { messages.push(data); },
        onConnectionChange(state) { states.push(state); }, destroy() { destroyed = true; } };
    const unregister = registry.registerModule(module);
    assert.throws(() => registry.registerModule(module), /unique/);
    api.send({ body: 'hello', module: 'spoofed' }); assert.equal(sent[0].module, 'chat');
    for (const data of [{ module: 'other' }, { module: 'chat', body: 'hello' }, null]) transport.dispatchEvent(new CustomEvent('message', { detail: data }));
    assert.equal(messages.length, 1);
    transport.connected = true; transport.dispatchEvent(new Event('connected'));
    assert.deepEqual(states, [false, true]);
    unregister(); assert.equal(destroyed, true); assert.equal(registry.modules.size, 0);
});
