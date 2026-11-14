import { parseHandshakeInput } from '../core/bridge.js';
import { MAX_TOKEN_LENGTH } from '../core/crypto.js';
import { isPeerId } from './protocol.js';

/** Parse a code, wrapped plain text, legacy token, or optional invitation URL.
 * @param {string} input User-supplied exchange text.
 * @returns {{type:string|null, token:string}} Encrypted payload and optional type hint.
 */
export function parseRoomExchangeText(input) {
    if (typeof input !== 'string' || input.length > MAX_TOKEN_LENGTH + 4096) throw new Error('Choose a complete room code or link.');
    return parseHandshakeInput(input.replace(/\s/g, ''));
}

/** Build a non-navigable text code; no origin or browser session is embedded.
 * @param {'offer'|'answer'} type Exchange purpose.
 * @param {string} token Encrypted envelope.
 * @returns {string}
 */
export function formatRoomExchangeCode(type, token) {
    if (!['offer', 'answer'].includes(type)) throw new Error('Unknown room code type.');
    const code = `${type}=${token}`;
    parseRoomExchangeText(code);
    return code;
}

/** Infer purpose from authenticated decrypted data, including legacy bare tokens.
 * @param {object} data Decrypted invitation or reply.
 * @param {string|null} hint Untrusted external prefix.
 * @returns {'offer'|'answer'}
 */
export function identifyRoomExchangeType(data, hint = null) {
    if (!data || !isPeerId(data.peerId) || typeof data.token !== 'string' ||
        data.token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(data.token)) throw new Error('Invalid room code contents.');
    const type = Object.hasOwn(data, 'hostId') ? 'offer' : 'answer';
    if (type === 'offer' && (data.version !== 1 || !isPeerId(data.hostId) || data.hostId === data.peerId)) throw new Error('Invalid room invitation.');
    if (hint && hint !== type) throw new Error('Code type does not match its encrypted contents.');
    return type;
}
