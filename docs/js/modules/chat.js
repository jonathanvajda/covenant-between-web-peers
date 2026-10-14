export function createChatModule(container, { getSender, onError }) {
    const history = container.querySelector('#chat-messages');
    const input = container.querySelector('#chat-input');
    const form = container.querySelector('form');
    const button = container.querySelector('button');
    let send;
    const append = (sender, timestamp, body, local = false) => {
        const article = document.createElement('article');
        article.className = `message${local ? ' mine' : ''}`;
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        const author = document.createElement('strong');
        author.textContent = local ? `${sender} (you)` : sender;
        const time = document.createElement('time');
        time.dateTime = new Date(timestamp).toISOString();
        time.textContent = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const text = document.createElement('p');
        text.textContent = body;
        meta.append(author, time); article.append(meta, text); history.append(article);
        while (history.children.length > 300) history.firstElementChild.remove();
        history.scrollTop = history.scrollHeight;
    };
    const submit = event => {
        event.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        const payload = { sender: getSender().trim().slice(0, 48) || 'Peer', timestamp: Date.now(), body };
        try { send(payload); append(payload.sender, payload.timestamp, body, true); input.value = ''; input.focus(); }
        catch (error) { onError(error.message); }
    };
    return {
        id: 'chat',
        init(context) { send = context.send; form.addEventListener('submit', submit); },
        onConnectionChange(connected) { input.disabled = button.disabled = !connected; },
        onMessage(data) {
            if (typeof data.sender !== 'string' || data.sender.length > 48 ||
                typeof data.body !== 'string' || !data.body.trim() || data.body.length > 2000 ||
                !Number.isFinite(data.timestamp) || Math.abs(data.timestamp) > 8640000000000000) {
                onError('Ignored an invalid chat message.'); return;
            }
            append(data.sender, data.timestamp, data.body);
        },
        clear() { history.replaceChildren(); input.value = ''; },
        destroy() { form.removeEventListener('submit', submit); }
    };
}
