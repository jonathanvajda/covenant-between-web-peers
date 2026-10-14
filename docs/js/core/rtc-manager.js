// js/core/rtc-manager.js
export class RTCManager {
    constructor(onMessageCallback, onStatusChange) {
        this.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        this.pc = null;
        this.dataChannel = null;
        this.onMessageCallback = onMessageCallback;
        this.onStatusChange = onStatusChange;
    }

    initPeerConnection() {
        this.pc = new RTCPeerConnection(this.config);
        this.pc.oniceconnectionstatechange = () => {
            if (this.onStatusChange) this.onStatusChange(this.pc.iceConnectionState);
        };
    }

    async createHostOffer() {
        this.initPeerConnection();
        this.dataChannel = this.pc.createDataChannel("p2p-channel");
        this.setupDataChannelEvents();

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        return new Promise((resolve) => {
            this.pc.onicegatheringstatechange = () => {
                if (this.pc.iceGatheringState === 'complete') {
                    resolve({
                        sdp: this.pc.localDescription,
                        type: 'offer'
                    });
                }
            };
        });
    }

    async createJoinAnswer(offerPayload) {
        this.initPeerConnection();
        
        this.pc.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.setupDataChannelEvents();
        };

        await this.pc.setRemoteDescription(new RTCSessionDescription(offerPayload.sdp));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        return new Promise((resolve) => {
            this.pc.onicegatheringstatechange = () => {
                if (this.pc.iceGatheringState === 'complete') {
                    resolve({
                        sdp: this.pc.localDescription,
                        type: 'answer'
                    });
                }
            };
        });
    }

    async handleAnswer(answerPayload) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(answerPayload.sdp));
    }

    setupDataChannelEvents() {
        this.dataChannel.onopen = () => {
            if (this.onStatusChange) this.onStatusChange('connected');
        };
        this.dataChannel.onclose = () => {
            if (this.onStatusChange) this.onStatusChange('disconnected');
        };
        this.dataChannel.onmessage = (event) => {
            if (this.onMessageCallback) this.onMessageCallback(JSON.parse(event.data));
        };
    }

    send(dataObj) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(dataObj));
        }
    }
}