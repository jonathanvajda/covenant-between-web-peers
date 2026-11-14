import { RTCManager } from '../core/rtc-manager.js';
import { encryptPayload, decryptPayload } from '../core/crypto.js';

/** A single encrypted-handshake WebRTC link, usable without a DOM.
 * Inject managerFactory to supply a headless RTC implementation.
 */
export class P2PTransport {
    constructor({ onMessage = () => {}, onStatusChange = () => {}, onError = () => {}, managerFactory = () => new RTCManager() } = {}) {
        this.manager = managerFactory();
        this.manager.addEventListener('message', event => onMessage(event.detail));
        this.manager.addEventListener('status', event => {
            // RTCManager closes its previous connection while initializing a new one.
            if (event.detail !== 'closed') onStatusChange(event.detail);
        });
        this.manager.addEventListener('error', event => onError(new Error(event.detail)));
        this.manager.addEventListener('disconnected', event => {
            // An ICE interruption can recover; an already closed data channel cannot.
            if (event.detail === 'closed' && this.manager.dataChannel?.readyState === 'closed') onStatusChange('failed');
        });
    }
    /** @returns {boolean} Whether the data channel can send. */
    get connected() { return this.manager.connected; }
    /** @param {string} password Shared out-of-band secret. */
    async generateOffer(password) { return encryptPayload(password, await this.manager.createHostOffer()); }
    /** @returns {Promise<string>} Encrypted answer token. */
    async acceptOffer(token, password) { return encryptPayload(password, await this.manager.createJoinAnswer(await decryptPayload(password, token))); }
    /** Complete the original pending connection. */
    async finalizeConnection(token, password) { await this.manager.handleAnswer(await decryptPayload(password, token)); }
    /** Send a JSON-compatible protocol packet. */
    send(packet) { this.manager.send(packet); }
    /** In-band signaling travels over an already encrypted host channel. */
    async createSignalOffer() { return this.manager.createHostOffer(); }
    async answerSignalOffer(offer) { return this.manager.createJoinAnswer(offer); }
    async acceptSignalAnswer(answer) { return this.manager.handleAnswer(answer); }
    /** Release ICE, channel, and pending gathering resources. */
    close() { this.manager.close(); }
}
