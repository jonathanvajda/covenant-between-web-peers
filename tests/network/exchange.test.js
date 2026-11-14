import { test, expect } from '@jest/globals';
import { parseRoomExchangeText, formatRoomExchangeCode, identifyRoomExchangeType } from '../../docs/js/network/exchange.js';

test('non-URL codes and line-wrapped tokens round-trip without browser context', () => {
    const code = formatRoomExchangeCode('answer', 'aBc_123-xyz');
    expect(code).toBe('answer=aBc_123-xyz');
    expect(parseRoomExchangeText(' answer= aBc_123-\nxyz ')).toEqual({ type: 'answer', token: 'aBc_123-xyz' });
    expect(parseRoomExchangeText('aBc_123-xyz')).toEqual({ type: null, token: 'aBc_123-xyz' });
});

test('legacy links remain accepted and malformed or ambiguous codes are rejected', () => {
    expect(parseRoomExchangeText('https://example.org/chat#offer=abc_123')).toEqual({ type: 'offer', token: 'abc_123' });
    for (const input of ['', null, 'offer=abc&answer=def', 'answer=abc!', 'a'.repeat(70000)]) expect(() => parseRoomExchangeText(input)).toThrow();
    expect(() => formatRoomExchangeCode('other', 'abc')).toThrow();
});

test('authenticated contents determine reply purpose even with no URL or prefix', () => {
    const reply = { peerId: 'peer-1', token: 'abc_123' };
    const invite = { ...reply, hostId: 'host-1', version: 1 };
    expect(identifyRoomExchangeType(reply)).toBe('answer');
    expect(identifyRoomExchangeType(invite)).toBe('offer');
    expect(() => identifyRoomExchangeType(reply, 'offer')).toThrow('match');
    expect(() => identifyRoomExchangeType({ ...invite, hostId: 'peer-1' })).toThrow();
    expect(() => identifyRoomExchangeType({ ...reply, token: '<script>' })).toThrow();
});
