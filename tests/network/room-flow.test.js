import { test, expect } from '@jest/globals';
import { deriveRoomConnectionFlow } from '../../docs/js/network/room-flow.js';

const derive = overrides => deriveRoomConnectionFlow({ role: null, hasRoom: false,
    exchangeType: null, answerAccepted: false, connectedCount: 0, topology: 'star', ...overrides });

test('role selection precedes setup and only a joiner receives an invitation', () => {
    expect(derive()).toMatchObject({ phase: 'choose', showChoice: true, showReceive: false, showChat: false });
    expect(derive({ role: 'host' })).toMatchObject({ showCreate: true, showReceive: false });
    expect(derive({ role: 'join' })).toMatchObject({ showCreate: false, showReceive: true });
});

test('only an active host invitation exposes answer controls, until its answer is accepted', () => {
    const state = { role: 'host', hasRoom: true, exchangeType: 'offer' };
    expect(derive(state)).toMatchObject({ phase: 'host-invitation', showReceive: true, showShare: true, showInvite: false });
    expect(derive({ ...state, answerAccepted: true })).toMatchObject({ phase: 'connecting', showReceive: false, showShare: false });
    expect(derive({ role: 'host', hasRoom: true, connectedCount: 1 })).toMatchObject({ showInvite: true, showReceive: false, showChat: true });
});

test('joining response and mesh phases expose no host invitation controls', () => {
    expect(derive({ role: 'join', hasRoom: true, exchangeType: 'answer' })).toMatchObject({ phase: 'join-response', showShare: true, showReceive: false, showInvite: false });
    expect(derive({ role: 'host', hasRoom: true, topology: 'mesh', connectedCount: 2 })).toMatchObject({ showInvite: false, showChat: true });
});
