/** Derive connection-screen visibility without browser or transport effects.
 * @param {{role:string|null, hasRoom:boolean, exchangeType:string|null, answerAccepted:boolean,
 * connectedCount:number, topology:string}} state Current room and invitation state.
 * @returns {object} Named phase and relevant sections.
 */
export function deriveRoomConnectionFlow({ role, hasRoom, exchangeType, answerAccepted, connectedCount, topology }) {
    const hosting = role === 'host';
    const invitation = hosting && exchangeType === 'offer';
    const phase = !role ? 'choose' : !hasRoom ? `${role}-setup`
        : invitation ? (answerAccepted ? 'connecting' : 'host-invitation')
        : exchangeType === 'answer' ? 'join-response' : hosting ? 'host-ready' : 'joined';
    return {
        phase, hosting, showChoice: !role, showSettings: Boolean(role) && !hasRoom,
        showCreate: hosting && !hasRoom,
        showReceive: invitation ? !answerAccepted : role === 'join' && !hasRoom,
        showShare: Boolean(exchangeType) && !answerAccepted,
        showInvite: hosting && hasRoom && !exchangeType && topology === 'star',
        showCancel: invitation, showMembers: hasRoom,
        showChat: connectedCount > 0, showTopology: hosting && connectedCount > 0
    };
}
