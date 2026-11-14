import { jest, test, expect, afterEach } from '@jest/globals';
import { PeerRoom } from '../../docs/js/network/room.js';
import { createRoomEnvelope, selectRoomRecipients, validateRoomEnvelope } from '../../docs/js/network/protocol.js';

const rooms = [];
afterEach(() => { for (const room of rooms.splice(0)) room.close(); jest.useRealTimers(); });

/** Deterministic headless network; signaling still flows through the room protocol. */
function createTestNetwork(count = 3) {
    const offers = new Map();
    const deliveries = [];
    const errors = [];
    let sequence = 0;
    function transportFactory(options) {
        const link = {
            options, connected: false, remote: null,
            send(packet) {
                if (!link.connected) throw new Error('Offline');
                deliveries.push(packet);
                queueMicrotask(() => link.remote.options.onMessage(structuredClone(packet)));
            },
            async createSignalOffer() { const id = `signal-${++sequence}`; offers.set(id, link); return { id }; },
            async answerSignalOffer(offer) {
                const remote = offers.get(offer.id); link.remote = remote; remote.remote = link;
                return offer;
            },
            async acceptSignalAnswer() {
                link.connected = link.remote.connected = true;
                queueMicrotask(() => { link.options.onStatusChange('connected'); link.remote.options.onStatusChange('connected'); });
            },
            close() { link.connected = false; }
        };
        return link;
    }
    const received = Array.from({ length: count }, () => []);
    const peers = Array.from({ length: count }, (_, index) => {
        const room = new PeerRoom({ selfId: `peer-${index}`, hostId: 'peer-0', transportFactory,
            randomId: () => `id-${++sequence}`, now: () => 1234,
            onMessage: message => received[index].push(message), onError: error => errors.push(error) });
        rooms.push(room); return room;
    });
    const members = peers.map(peer => peer.selfId);
    for (const peer of peers) peer.members = [...members];
    for (const peer of peers.slice(1)) {
        const hostLink = peers[0].createPeerLink(peer.selfId);
        const clientLink = peer.createPeerLink('peer-0');
        hostLink.remote = clientLink; clientLink.remote = hostLink;
        hostLink.connected = clientLink.connected = true;
    }
    return { peers, received, deliveries, errors };
}

const settleNetwork = async () => { for (let turn = 0; turn < 30; turn++) await Promise.resolve(); };
const envelope = overrides => createRoomEnvelope({ id: 'msg-1', senderId: 'peer-1', timestamp: 1234,
    type: 'CHAT_MSG', payload: { text: 'hello' }, ...overrides });

test('validates chat, private targets, UTF-8 byte limits and game envelopes', () => {
    expect(envelope({ payload: { text: 'a'.repeat(250) } }).payload.text).toHaveLength(250);
    for (const text of ['', '  ', 'a'.repeat(251), 12]) expect(() => envelope({ payload: { text } })).toThrow();
    expect(() => envelope({ targetId: '../invalid' })).toThrow();
    expect(() => validateRoomEnvelope({ ...envelope(), timestamp: NaN })).toThrow();
    expect(() => envelope({ type: 'GAME_ACTION', payload: { action: 'FIRE', data: '🔥'.repeat(5000) } })).toThrow();
    expect(envelope({ type: 'GAME_ACTION', payload: { action: 'FIRE', data: { x: 3 } } }).payload.data).toEqual({ x: 3 });
});

test('pure recipient selection routes client messages only through the host in star', () => {
    expect(selectRoomRecipients(envelope(), { selfId: 'peer-1', hostId: 'peer-0', topology: 'star', peers: ['peer-0', 'peer-2'] })).toEqual(['peer-0']);
    expect(selectRoomRecipients(envelope({ targetId: 'peer-2' }), { selfId: 'peer-0', hostId: 'peer-0', topology: 'star', peers: ['peer-1', 'peer-2', 'peer-3'] })).toEqual(['peer-2']);
});

test('star broadcasts exactly once and private traffic is delivered only to its target', async () => {
    const { peers, received, errors } = createTestNetwork(4);
    peers[1].sendChat('hello everyone'); await settleNetwork();
    expect(received.map(messages => messages.length)).toEqual([1, 1, 1, 1]);
    peers[1].sendChat('secret', 'peer-2'); await settleNetwork();
    expect(received.map(messages => messages.length)).toEqual([1, 2, 2, 1]);
    peers[3].sendGameAction('MOVE', { cell: 'A3' }, 'peer-0'); await settleNetwork();
    expect(received[0].at(-1).payload).toEqual({ action: 'MOVE', data: { cell: 'A3' } });
    expect(errors).toEqual([]);
});

test('rejects forged senders, malformed packets, unauthorized moves, and replay', async () => {
    const { peers, received } = createTestNetwork();
    await expect(peers[0].receivePacket('peer-2', { kind: 'application', message: envelope() })).rejects.toThrow('sender');
    await expect(peers[0].receivePacket('peer-1', null)).rejects.toThrow();
    peers[0].authorize = () => false;
    await expect(peers[0].receivePacket('peer-1', { kind: 'application', message: envelope() })).rejects.toThrow('permission');
    peers[0].authorize = () => true;
    await peers[0].receivePacket('peer-1', { kind: 'application', message: envelope() });
    await peers[0].receivePacket('peer-1', { kind: 'application', message: envelope() });
    expect(received[0]).toHaveLength(1);
});

test.each([2, 3, 6])('negotiates a full %i-peer mesh and continues after host loss', async count => {
    const { peers, received, errors } = createTestNetwork(count);
    peers[0].enableMesh(); await settleNetwork();
    expect(peers.map(peer => peer.topology)).toEqual(Array(count).fill('mesh'));
    expect(peers.map(peer => peer.connectedPeers().length)).toEqual(Array(count).fill(count - 1));
    peers[1].sendChat('direct'); await settleNetwork();
    expect(received.map(messages => messages.length)).toEqual(Array(count).fill(1));
    if (count > 2) {
        for (const peer of peers.slice(1)) peer.removePeer('peer-0');
        peers[0].close(); peers[1].sendChat('host gone'); await settleNetwork();
        expect(received[2].at(-1).payload.text).toBe('host gone');
    }
    expect(errors).toEqual([]);
});

test('limits star to twelve and mesh to six; clients cannot trigger transition', async () => {
    const { peers } = createTestNetwork(12);
    expect(() => peers[0].enableMesh()).toThrow();
    expect(() => peers[1].enableMesh()).toThrow();
    await expect(peers[0].createInvitation('password')).rejects.toThrow();
});

test('times out partial mesh while retaining working star links', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    const { peers, received } = createTestNetwork();
    peers[1].offerMeshLink = async () => {}; // Model a blocked direct ICE path.
    peers[0].enableMesh(); await settleNetwork();
    expect(peers[0].topology).toBe('star');
    await jest.advanceTimersByTimeAsync(45000); await settleNetwork();
    expect(peers.map(peer => peer.epoch)).toEqual([null, null, null]);
    peers[2].sendChat('still connected'); await settleNetwork();
    expect(received.map(messages => messages.length)).toEqual([1, 1, 1]);
});

test('temporary disconnect retains link; terminal failure removes and closes it', () => {
    const { peers } = createTestNetwork();
    const link = peers[1].links.get('peer-0');
    peers[1].handleLinkStatus('peer-0', 'disconnected');
    expect(peers[1].links.get('peer-0')).toBe(link);
    peers[1].handleLinkStatus('peer-0', 'failed');
    expect(peers[1].links.has('peer-0')).toBe(false);
    expect(link.connected).toBe(false);
    expect(() => peers[1].sendChat('offline')).toThrow('disconnected');
});
