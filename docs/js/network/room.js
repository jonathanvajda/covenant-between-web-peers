import { createRoomEnvelope, validateRoomEnvelope, selectRoomRecipients, isPeerId } from './protocol.js';
import { P2PTransport } from './transport.js';

/** Game-agnostic room coordinator. Effects are isolated behind transportFactory and callbacks.
 * @param {object} options
 * @param {string} options.selfId Unique ID for this room session.
 * @param {string} options.hostId Coordinator ID.
 * @param {Function} [options.authorize] Host permission check for application messages.
 * @param {Function} [options.transportFactory] Creates one independent link per peer.
 * @param {function(import('./protocol.js').RoomEnvelope):void} [options.onMessage] Application delivery.
 * @param {function(object):void} [options.onState] Serializable connection snapshot.
 * @param {function(Error):void} [options.onError] Invalid packets and asynchronous failures.
 * @param {function():string} [options.randomId] Unique identity/message/transition IDs.
 * @param {function():number} [options.now] Epoch milliseconds.
 */
export class PeerRoom {
    constructor({ selfId, hostId, onMessage = () => {}, onState = () => {}, onError = () => {},
        authorize = () => true, transportFactory = options => new P2PTransport(options),
        randomId = () => crypto.randomUUID(), now = () => Date.now() }) {
        if (!isPeerId(selfId) || !isPeerId(hostId)) throw new Error('Invalid peer identity.');
        Object.assign(this, { selfId, hostId, onMessage, onState, onError, authorize, transportFactory, randomId, now });
        this.links = new Map(); this.members = [hostId]; this.topology = 'star';
        this.seen = new Set(); this.ready = new Set(); this.epoch = null;
    }
    /** Publish a serializable state snapshot for UI or a headless consumer. */
    publishState() {
        this.onState({ selfId: this.selfId, hostId: this.hostId, topology: this.topology,
            members: [...this.members], connected: this.connectedPeers(), transitioning: Boolean(this.epoch) });
    }
    connectedPeers() { return [...this.links].filter(([, link]) => link.connected).map(([id]) => id); }
    /** Create a link bound to a known identity, preventing sender impersonation. */
    createPeerLink(peerId) {
        if (!isPeerId(peerId) || peerId === this.selfId || this.links.has(peerId)) throw new Error('Invalid or duplicate peer.');
        const link = this.transportFactory({
            onMessage: packet => Promise.resolve(this.receivePacket(peerId, packet)).catch(this.onError),
            onStatusChange: status => this.handleLinkStatus(peerId, status), onError: this.onError
        });
        this.links.set(peerId, link);
        return link;
    }
    handleLinkStatus(peerId, status) {
        if (this.epoch && ['disconnected', 'failed', 'closed'].includes(status)) this.abortInterruptedMesh();
        if (status === 'connected' && this.selfId === this.hostId && this.topology === 'star' && !this.epoch) {
            if (!this.members.includes(peerId)) this.members.push(peerId);
            this.broadcastControl({ kind: 'members', members: this.members });
        }
        if (status === 'failed' || status === 'closed') {
            this.removePeer(peerId);
            if (this.selfId === this.hostId) {
                this.members = this.members.filter(id => id !== peerId);
                if (this.epoch) this.cancelMesh();
                this.broadcastControl({ kind: 'members', members: this.members });
            }
        }
        this.checkMeshReadiness(); this.publishState();
    }
    /** Host: generate a fresh invitation for one joining participant. */
    async createInvitation(password) {
        if (this.selfId !== this.hostId || this.topology !== 'star' || this.epoch || this.links.size >= 11) throw new Error('Room cannot accept another participant.');
        if ([...this.links.values()].some(link => !link.connected)) throw new Error('Finish or cancel the pending invitation before inviting another peer.');
        const peerId = this.randomId();
        const link = this.createPeerLink(peerId);
        try { return { version: 1, hostId: this.hostId, peerId, token: await link.generateOffer(password) }; }
        catch (error) { this.removePeer(peerId); throw error; }
    }
    /** Client: answer an invitation; return the reply to the original host tab. */
    async answerInvitation(invitation, password) {
        if (invitation.version !== 1 || invitation.peerId !== this.selfId || invitation.hostId !== this.hostId) throw new Error('Invitation identity mismatch.');
        const link = this.createPeerLink(this.hostId);
        try { return { peerId: this.selfId, token: await link.acceptOffer(invitation.token, password) }; }
        catch (error) { this.removePeer(this.hostId); throw error; }
    }
    async acceptReply(reply, password) {
        if (this.selfId !== this.hostId || !this.links.has(reply.peerId)) throw new Error('No matching invitation in this tab.');
        await this.links.get(reply.peerId).finalizeConnection(reply.token, password);
    }
    /** Send chat with the spec's strict 250-character limit. */
    sendChat(text, targetId = null) { return this.sendApplication('CHAT_MSG', { text }, targetId); }
    /** Send arbitrary game data; the host application owns game rules and state. */
    sendGameAction(action, data, targetId = null) { return this.sendApplication('GAME_ACTION', { action, data }, targetId); }
    sendApplication(type, payload, targetId) {
        const message = createRoomEnvelope({ id: this.randomId(), senderId: this.selfId, timestamp: this.now(), type, payload, targetId });
        if (targetId !== null && (!this.members.includes(targetId) || targetId === this.selfId)) throw new Error('Choose a connected recipient.');
        if (this.topology === 'mesh' && targetId !== null && !this.links.get(targetId)?.connected) throw new Error('Recipient is disconnected.');
        if (this.selfId !== this.hostId && this.topology === 'star' && !this.links.get(this.hostId)?.connected) throw new Error('Host is disconnected.');
        if (!this.authorize(message)) throw new Error('Message permission denied.');
        this.routeApplication(message); this.rememberMessage(message.id); this.onMessage(message);
        return message;
    }
    routeApplication(message) {
        const recipients = selectRoomRecipients(message, { selfId: this.selfId, hostId: this.hostId, topology: this.topology, peers: this.connectedPeers() });
        for (const id of recipients) this.links.get(id).send({ kind: 'application', message });
    }
    rememberMessage(id) {
        this.seen.add(id);
        if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value);
    }
    async receivePacket(peerId, packet) {
        if (!packet || typeof packet.kind !== 'string') throw new Error('Invalid room packet.');
        if (packet.kind !== 'application') return this.receiveControl(peerId, packet);
        const message = validateRoomEnvelope(packet.message);
        const relayed = this.topology === 'star' && peerId === this.hostId;
        if ((!relayed && message.senderId !== peerId) || !this.members.includes(message.senderId)) throw new Error('Invalid sender identity.');
        if (this.seen.has(message.id)) return;
        if (!this.authorize(message)) throw new Error('Message permission denied.');
        this.rememberMessage(message.id);
        if (this.topology === 'star' && this.selfId === this.hostId) this.routeApplication(message);
        if (message.targetId === null || message.targetId === this.selfId) this.onMessage(message);
    }
    broadcastControl(packet) {
        for (const link of this.links.values()) if (link.connected) link.send(packet);
    }
    /** Host: negotiate every missing client pair, retaining star routing until commit. */
    enableMesh() {
        if (this.selfId !== this.hostId || this.topology !== 'star' || this.epoch || this.members.length < 2 || this.members.length > 6 || this.links.size !== this.members.length - 1 || this.connectedPeers().length !== this.members.length - 1) throw new Error('Mesh needs 2–6 connected participants and no pending invitations.');
        this.epoch = this.randomId(); this.ready.clear();
        this.broadcastControl({ kind: 'mesh-start', members: this.members, epoch: this.epoch });
        this.meshTimer = setTimeout(() => this.cancelMesh(), 45000);
        this.checkMeshReadiness(); this.publishState();
    }
    async receiveControl(peerId, packet) {
        if (packet.kind === 'signal') return this.receiveSignal(peerId, packet);
        if (packet.kind === 'mesh-failed' && this.selfId === this.hostId && packet.epoch === this.epoch) {
            this.cancelMesh(); return;
        }
        if (packet.kind === 'mesh-ready' && this.selfId === this.hostId && packet.epoch === this.epoch) {
            this.ready.add(peerId); this.checkMeshReadiness(); return;
        }
        if (peerId !== this.hostId || this.selfId === this.hostId) throw new Error('Only the host can control membership.');
        if (packet.kind === 'members' || packet.kind === 'mesh-start') {
            if (!Array.isArray(packet.members) || packet.members.length > 12 || new Set(packet.members).size !== packet.members.length ||
                !packet.members.every(isPeerId) || !packet.members.includes(this.selfId) || !packet.members.includes(this.hostId)) throw new Error('Invalid membership.');
            this.members = [...packet.members];
        }
        if (packet.kind === 'mesh-start') {
            if (this.members.length > 6 || !isPeerId(packet.epoch)) throw new Error('Invalid mesh request.');
            this.epoch = packet.epoch;
            this.meshTimer = setTimeout(() => this.cancelMesh(), 45000);
            for (const id of this.members.filter(id => id !== this.hostId && id > this.selfId)) await this.offerMeshLink(id);
            this.checkMeshReadiness();
        }
        if (packet.kind === 'mesh-commit' && packet.epoch === this.epoch) {
            clearTimeout(this.meshTimer); this.topology = 'mesh'; this.epoch = null;
        }
        if (packet.kind === 'mesh-cancel' && packet.epoch === this.epoch) this.cancelMesh();
        this.publishState();
    }
    async offerMeshLink(peerId) {
        const link = this.createPeerLink(peerId);
        const offer = await link.createSignalOffer();
        this.sendSignal(peerId, { offer });
    }
    sendSignal(targetId, data) {
        this.links.get(this.hostId).send({ kind: 'signal', senderId: this.selfId, targetId, epoch: this.epoch, ...data });
    }
    async receiveSignal(peerId, packet) {
        if (!this.epoch || packet.epoch !== this.epoch || !this.members.includes(packet.targetId) || !this.members.includes(packet.senderId)) throw new Error('Stale or invalid mesh signal.');
        if (this.selfId === this.hostId) {
            if (packet.senderId !== peerId || packet.targetId === this.hostId || packet.targetId === peerId) throw new Error('Invalid signaling route.');
            this.links.get(packet.targetId)?.send(packet); return;
        }
        if (peerId !== this.hostId || packet.targetId !== this.selfId || packet.senderId === this.selfId) throw new Error('Invalid signaling sender.');
        if (packet.offer) {
            if (packet.senderId > this.selfId) throw new Error('Unexpected mesh initiator.');
            const link = this.createPeerLink(packet.senderId);
            this.sendSignal(packet.senderId, { answer: await link.answerSignalOffer(packet.offer) }); return;
        }
        const link = this.links.get(packet.senderId);
        if (!link || !packet.answer) throw new Error('Unexpected mesh answer.');
        await link.acceptSignalAnswer(packet.answer);
    }
    checkMeshReadiness() {
        if (!this.epoch || this.members.some(id => id !== this.selfId && !this.links.get(id)?.connected)) return;
        if (this.selfId !== this.hostId) {
            this.links.get(this.hostId).send({ kind: 'mesh-ready', epoch: this.epoch }); return;
        }
        this.ready.add(this.selfId);
        if (this.members.some(id => !this.ready.has(id))) return;
        this.broadcastControl({ kind: 'mesh-commit', epoch: this.epoch });
        clearTimeout(this.meshTimer); this.epoch = null; this.topology = 'mesh'; this.publishState();
    }
    /** Abandon partial mesh links; established host edges remain the star. */
    cancelMesh() {
        if (!this.epoch) return;
        const epoch = this.epoch;
        clearTimeout(this.meshTimer); this.epoch = null;
        if (this.selfId === this.hostId) this.broadcastControl({ kind: 'mesh-cancel', epoch });
        else for (const id of [...this.links.keys()]) if (id !== this.hostId) this.removePeer(id);
        this.publishState();
    }
    /** Revoke readiness across the room when a transition loses any required edge. */
    abortInterruptedMesh() {
        if (this.selfId !== this.hostId && this.links.get(this.hostId)?.connected) {
            this.links.get(this.hostId).send({ kind: 'mesh-failed', epoch: this.epoch });
        }
        this.cancelMesh();
    }
    /** Remove a failed or abandoned link. Rejoin uses a fresh invitation and identity. */
    removePeer(peerId) {
        const link = this.links.get(peerId); this.links.delete(peerId); link?.close();
    }
    /** Release unfinished invitations without interrupting connected participants. */
    cancelPendingInvitations() {
        for (const [id, link] of this.links) if (!link.connected && !this.members.includes(id)) this.removePeer(id);
        this.publishState();
    }
    close() {
        clearTimeout(this.meshTimer); this.epoch = null;
        for (const id of [...this.links.keys()]) this.removePeer(id);
        this.members = [this.hostId]; this.publishState();
    }
}
