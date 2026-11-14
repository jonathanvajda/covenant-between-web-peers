/** Pure wire-protocol helpers. No browser, clock, or random-number dependencies. */
/**
 * @typedef {object} RoomEnvelope
 * @property {number} version Protocol version (1).
 * @property {string} id Unique per-message identifier.
 * @property {string} senderId Assigned room participant ID.
 * @property {number} timestamp Sender's epoch milliseconds; not an ordering guarantee.
 * @property {'CHAT_MSG'|'GAME_ACTION'} type Application channel.
 * @property {'BROADCAST'|'PRIVATE'} envelopeType Routing scope.
 * @property {string|null} targetId Private recipient, or null.
 * @property {{text?: string, action?: string, data?: *}} payload Application body.
 */
export const MAX_ROOM_BYTES = 16384;
export const isPeerId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);

/** Validate an application envelope before routing or delivering it.
 * @param {unknown} message Untrusted parsed JSON.
 * @returns {RoomEnvelope} The validated input.
 */
export function validateRoomEnvelope(message) {
    if (!message || message.version !== 1 || !isPeerId(message.id) || !isPeerId(message.senderId) ||
        !['CHAT_MSG', 'GAME_ACTION'].includes(message.type) ||
        !['BROADCAST', 'PRIVATE'].includes(message.envelopeType) ||
        (message.envelopeType === 'PRIVATE' ? !isPeerId(message.targetId) : message.targetId !== null) ||
        !Number.isSafeInteger(message.timestamp) || message.timestamp < 0 ||
        new TextEncoder().encode(JSON.stringify(message)).length > MAX_ROOM_BYTES) {
        throw new Error('Invalid room message.');
    }
    if (message.type === 'CHAT_MSG' && (typeof message.payload?.text !== 'string' ||
        !message.payload.text.trim() || message.payload.text.length > 250)) throw new Error('Chat requires 1–250 characters.');
    if (message.type === 'GAME_ACTION' && (typeof message.payload?.action !== 'string' ||
        !message.payload.action || message.payload.action.length > 64)) throw new Error('Invalid game action.');
    return message;
}

/** Construct a validated envelope from explicitly supplied identity and time.
 * @param {object} fields Envelope fields with no implicit clock or ID generation.
 * @returns {RoomEnvelope}
 */
export function createRoomEnvelope({ id, senderId, timestamp, type, payload, targetId = null }) {
    return validateRoomEnvelope({ version: 1, id, senderId, timestamp, type, payload,
        targetId, envelopeType: targetId === null ? 'BROADCAST' : 'PRIVATE' });
}

/** Return physical next hops; private data never travels through unrelated clients.
 * @param {RoomEnvelope} message Validated application message.
 * @param {{selfId:string, hostId:string, topology:string, peers:string[]}} routing Current open edges.
 * @returns {string[]} Next-hop peer IDs.
 */
export function selectRoomRecipients(message, { selfId, hostId, topology, peers }) {
    if (topology === 'star' && selfId !== hostId) return peers.includes(hostId) ? [hostId] : [];
    return peers.filter(id => id !== message.senderId &&
        (message.targetId === null || id === message.targetId));
}
