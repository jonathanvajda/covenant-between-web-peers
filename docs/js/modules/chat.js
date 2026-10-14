// js/modules/chat.js
export function initChatModule(rtcManager, uiContainer) {
    uiContainer.innerHTML = `
        <div id="chat-messages" style="height: 300px; overflow-y: scroll; border: 1px solid #ccc; padding: 10px; margin-bottom: 10px;"></div>
        <input type="text" id="chat-input" placeholder="Type a message..." style="width: 75%; padding: 8px;" />
        <button id="chat-send" style="width: 20%; padding: 8px;">Send</button>
    `;

    const messagesEl = document.getElementById('chat-messages');
    const inputEl = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');

    const appendMessage = (sender, timestamp, body) => {
        const div = document.createElement('div');
        div.style.margin = "6px 0";
        div.innerHTML = `<strong>${sender}</strong> <span style="font-size: 0.8em; color: #666;">[${new Date(timestamp).toLocaleTimeString()}]</span>: ${body}`;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    sendBtn.onclick = () => {
        const text = inputEl.value.trim();
        if (!text) return;
        
        const payload = {
            module: 'chat',
            sender: 'Peer_' + Math.floor(Math.random() * 1000),
            timestamp: Date.now(),
            body: text
        };

        rtcManager.send(payload);
        appendMessage("You", payload.timestamp, payload.body);
        inputEl.value = '';
    };

    // Return message handler for incoming network packets
    return {
        onMessage: (data) => {
            if (data.module === 'chat') {
                appendMessage(data.sender, data.timestamp, data.body);
            }
        }
    };
}