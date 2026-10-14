const ITERATIONS = 310000;
const MAX_BYTES = 262144;
export const MAX_TOKEN_LENGTH = 65536;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export async function deriveKey(password, salt) {
    if (typeof password !== 'string' || !password.trim()) throw new Error('Enter the shared passphrase.');
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function transform(bytes, stream) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > MAX_BYTES) throw new Error('Handshake payload is too large.');
            chunks.push(value);
        }
    } finally { await reader.cancel(); }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
}

export async function encryptPayload(password, object) {
    let bytes = encoder.encode(JSON.stringify(object));
    if (bytes.length > MAX_BYTES) throw new Error('Handshake payload is too large.');
    // Header: protocol version, compression flag, 16-byte salt, 12-byte IV.
    const header = new Uint8Array(30);
    header[0] = 1;
    if (typeof CompressionStream !== 'undefined') {
        const compressed = await transform(bytes, new CompressionStream('deflate'));
        if (compressed.length < bytes.length) { bytes = compressed; header[1] = 1; }
    }
    crypto.getRandomValues(header.subarray(2, 18));
    crypto.getRandomValues(header.subarray(18, 30));
    const key = await deriveKey(password, header.subarray(2, 18));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM',
        iv: header.subarray(18), additionalData: header }, key, bytes));
    const envelope = new Uint8Array(header.length + encrypted.length);
    envelope.set(header); envelope.set(encrypted, header.length);
    const token = btoa(Array.from(envelope, byte => String.fromCharCode(byte)).join(''))
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    if (token.length > MAX_TOKEN_LENGTH) throw new Error('Handshake token is too large.');
    return token;
}

export async function decryptPayload(password, token) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token))
        throw new Error('Invalid handshake token. Paste the complete connection link.');
    const bytes = Uint8Array.from(atob(token.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
    if (bytes.length < 46 || bytes[0] !== 1 || bytes[1] > 1) throw new Error('Unsupported or incomplete handshake token.');
    const header = bytes.subarray(0, 30);
    const key = await deriveKey(password, header.subarray(2, 18));
    let plain;
    try {
        plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: header.subarray(18),
            additionalData: header }, key, bytes.subarray(30)));
    } catch { throw new Error('Cannot decrypt this link. Check the shared passphrase and the complete link.'); }
    if (header[1]) {
        if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress handshakes. Use a current browser.');
        plain = await transform(plain, new DecompressionStream('deflate'));
    }
    return JSON.parse(decoder.decode(plain));
}
