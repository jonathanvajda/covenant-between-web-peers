export const MAX_MESSAGE_BYTES = 16384;
export const HANDSHAKE_TTL = 30 * 60 * 1000;

export function validateHandshake(payload, type) {
    if (!payload || payload.version !== 1 || payload.type !== type ||
        typeof payload.session !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.session) ||
        !Number.isFinite(payload.createdAt) || payload.createdAt > Date.now() + 300000 ||
        Date.now() - payload.createdAt > HANDSHAKE_TTL ||
        payload.sdp?.type !== type || typeof payload.sdp.sdp !== 'string' ||
        payload.sdp.sdp.length > 200000 || !payload.sdp.sdp.startsWith('v=0')) {
        throw new Error('Invalid or expired handshake. Create a new connection and exchange fresh links.');
    }
    return payload;
}

export class RTCManager extends EventTarget {
    constructor({ iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }], gatherTimeout = 20000 } = {}) {
        super();
        this.config = { iceServers };
        this.gatherTimeout = gatherTimeout;
        this.pc = null;
        this.dataChannel = null;
        this.session = null;
        this.cancelGather = null;
        this.gatheringComplete = false;
        this.iceErrors = [];
    }
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    status(state) { this.emit('status', state); }
    get connected() { return this.dataChannel?.readyState === 'open' && ['connected', 'completed'].includes(this.pc?.iceConnectionState); }
    initPeerConnection() {
        this.close();
        const pc = this.pc = new RTCPeerConnection(this.config);
        this.gatheringComplete = false;
        this.iceErrors = [];
        // One interface/server may fail while another succeeds; never abort on this event.
        pc.onicecandidateerror = event => {
            this.iceErrors.push({ code: event.errorCode, url: event.url });
        };
        pc.oniceconnectionstatechange = () => {
            this.status(pc.iceConnectionState);
            if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) this.emit('disconnected', pc.iceConnectionState);
            else if (this.connected) this.emit('connected');
        };
        pc.ondatachannel = event => {
            if (this.dataChannel || event.channel.label !== 'p2p-channel') { event.channel.close(); return; }
            this.bindChannel(event.channel);
        };
        return pc;
    }
    bindChannel(channel) {
        this.dataChannel = channel;
        channel.onopen = () => { this.status('connected'); this.emit('connected'); };
        channel.onclose = () => { this.status('disconnected'); this.emit('disconnected', 'closed'); };
        channel.onerror = () => this.emit('error', 'The data channel encountered an error.');
        channel.onmessage = event => {
            try {
                if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > MAX_MESSAGE_BYTES)
                    throw new Error('Invalid or oversized peer message.');
                this.emit('message', JSON.parse(event.data));
            } catch { this.emit('error', 'Ignored an invalid peer message.'); }
        };
    }
    async gather(description) {
        const pc = this.pc;
        await pc.setLocalDescription(description);
        if (pc.iceGatheringState !== 'complete') {
            await new Promise((resolve, reject) => {
                const finish = error => {
                    clearTimeout(timer);
                    pc.removeEventListener('icegatheringstatechange', check);
                    this.cancelGather = null;
                    error ? reject(error) : resolve();
                };
                const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
                const timer = setTimeout(() => {
                    if (/^a=candidate:/m.test(pc.localDescription?.sdp || '')) finish();
                    else finish(new Error('No network routes were gathered. Allow local-network access in your browser and check whether your VPN permits LAN traffic, then try again.'));
                }, this.gatherTimeout);
                this.cancelGather = () => finish(new Error('Connection closed.'));
                pc.addEventListener('icegatheringstatechange', check);
                check();
            });
        }
        if (pc !== this.pc) throw new Error('Connection closed.');
        this.gatheringComplete = pc.iceGatheringState === 'complete';
        if (!/^a=candidate:/m.test(pc.localDescription?.sdp || ''))
            throw new Error('No network routes were gathered. Allow local-network access in your browser and check whether your VPN permits LAN traffic, then try again.');
        if (!this.gatheringComplete) {
            const publicRoute = /\btyp (srflx|relay)\b/.test(pc.localDescription.sdp);
            this.emit('warning', publicRoute
                ? 'Some route discovery requests timed out. This link includes the routes found so far; exchange it to try connecting.'
                : 'Public route discovery timed out. This link includes local routes; try it with your peer on the same Wi-Fi. A VPN may still block local traffic.');
        }
        return { version: 1, session: this.session, createdAt: Date.now(), type: pc.localDescription.type,
            sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } };
    }
    async createHostOffer() {
        const pc = this.initPeerConnection();
        this.session = crypto.randomUUID();
        this.bindChannel(pc.createDataChannel('p2p-channel', { ordered: true }));
        this.status('gathering');
        return this.gather(await pc.createOffer());
    }
    async createJoinAnswer(offer) {
        validateHandshake(offer, 'offer');
        const pc = this.initPeerConnection();
        this.session = offer.session;
        this.status('gathering');
        await pc.setRemoteDescription(offer.sdp);
        return this.gather(await pc.createAnswer());
    }
    async handleAnswer(answer) {
        validateHandshake(answer, 'answer');
        if (!this.pc || this.pc.signalingState !== 'have-local-offer')
            throw new Error('Paste the reply into the original host tab, which must stay open.');
        if (answer.session !== this.session) throw new Error('This reply belongs to another connection.');
        await this.pc.setRemoteDescription(answer.sdp);
        this.status('checking');
    }
    send(object) {
        if (!this.connected) throw new Error('Connect to your peer before sending.');
        const text = JSON.stringify(object);
        if (new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES) throw new Error('Message is too large.');
        if (this.dataChannel.bufferedAmount > 65536) throw new Error('The connection is busy. Try sending again shortly.');
        this.dataChannel.send(text);
    }
    close() {
        this.cancelGather?.();
        if (this.dataChannel) {
            this.dataChannel.onopen = this.dataChannel.onclose = this.dataChannel.onmessage = this.dataChannel.onerror = null;
            this.dataChannel.close();
        }
        if (this.pc) { this.pc.oniceconnectionstatechange = this.pc.ondatachannel = this.pc.onicecandidateerror = null; this.pc.close(); }
        this.pc = this.dataChannel = this.session = null;
        this.status('closed'); this.emit('disconnected', 'closed');
    }
}
