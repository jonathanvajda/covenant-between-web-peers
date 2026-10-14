import { MAX_TOKEN_LENGTH } from './crypto.js';

export function parseHandshakeInput(input) {
    let value = input.trim();
    if (!value || value.length > MAX_TOKEN_LENGTH + 4096) throw new Error('Paste a complete connection link or token.');
    if (value.includes('#')) value = value.slice(value.indexOf('#') + 1);
    if (value.startsWith('offer=') || value.startsWith('answer=')) {
        const params = new URLSearchParams(value);
        const type = params.has('offer') ? 'offer' : 'answer';
        if ([...params].length !== 1) throw new Error('Invalid connection link.');
        const token = params.get(type);
        if (!token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid handshake token.');
        return { type, token };
    }
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > MAX_TOKEN_LENGTH) throw new Error('Invalid connection link or token.');
    return { type: null, token: value };
}

export function makeHandshakeLink(base, type, token) {
    const url = new URL(base);
    url.search = '';
    url.hash = `${type}=${token}`;
    return url.href;
}
