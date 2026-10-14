import { test, expect } from '@playwright/test';

const secret = 'a separate strong shared passphrase';
// Use real browser WebRTC with host candidates for deterministic local QA.
// Public STUN and two-network NAT traversal must also be checked on physical devices.
async function localRTC(context) {
    await context.addInitScript(() => {
        const NativePeer = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends NativePeer {
            constructor(config) { super({ ...config, iceServers: [] }); }
        };
    });
}
async function host(page) {
    await page.goto('./');
    await page.locator('#room-pass').fill(secret);
    await page.locator('#host').click();
    await expect(page.locator('#outgoing')).toHaveValue(/#offer=/);
    return page.locator('#outgoing').inputValue();
}
async function join(page, invitation) {
    await page.goto(invitation);
    await expect(page).not.toHaveURL(/#offer/);
    await page.locator('#room-pass').fill(secret);
    await page.locator('#process').click();
    await expect(page.locator('#outgoing')).toHaveValue(/#answer=/);
    return page.locator('#outgoing').inputValue();
}

test('real two-peer exchange, safe bidirectional chat, disconnect and reset', async ({ browser }) => {
    const a = await browser.newContext(); const b = await browser.newContext();
    await localRTC(a); await localRTC(b);
    const alice = await a.newPage(); const bob = await b.newPage();
    const errors = [];
    alice.on('pageerror', error => errors.push(error.message)); bob.on('pageerror', error => errors.push(error.message));
    try {
        const invitation = await host(alice);
        const reply = await join(bob, invitation);
        await alice.locator('#display-name').fill('Alice'); await bob.locator('#display-name').fill('Bob');
        await alice.locator('#incoming').fill(reply); await alice.locator('#process').click();
        await expect(alice.locator('#chat-input')).toBeEnabled({ timeout: 15000 });
        await expect(bob.locator('#chat-input')).toBeEnabled({ timeout: 15000 });
        await alice.locator('#chat-input').fill('Hello 👋 <img src=x onerror="window.hacked=true">');
        await alice.locator('#chat-form button').click();
        await expect(bob.locator('.message')).toHaveCount(1);
        await expect(bob.locator('.message')).toContainText('Alice');
        expect(await bob.locator('#chat-messages img').count()).toBe(0);
        expect(await bob.evaluate(() => window.hacked)).toBeUndefined();
        await bob.locator('#chat-input').fill('Hello back, Alice!'); await bob.locator('#chat-form button').click();
        await expect(alice.locator('.message')).toHaveCount(2);
        await expect(alice.locator('.message').last()).toContainText('Bob');
        await alice.locator('#reset').click();
        await expect(alice.locator('#chat-input')).toBeDisabled();
        await expect(alice.locator('.message')).toHaveCount(0);
        await expect(alice.locator('#room-pass')).toHaveValue('');
        await expect(bob.locator('#chat-input')).toBeDisabled({ timeout: 15000 });
        expect(errors).toEqual([]);
    } finally { await a.close(); await b.close(); }
});

test('wrong passphrase can be corrected, and a reply in a new tab explains recovery', async ({ browser }) => {
    const a = await browser.newContext(); const b = await browser.newContext();
    await localRTC(a); await localRTC(b);
    try {
        const alice = await a.newPage(); const bob = await b.newPage();
        const invitation = await host(alice);
        await bob.goto(invitation); await bob.locator('#room-pass').fill('wrong'); await bob.locator('#process').click();
        await expect(bob.locator('#error')).toContainText('Cannot decrypt');
        await bob.locator('#room-pass').fill(secret); await bob.locator('#process').click();
        await expect(bob.locator('#outgoing')).toHaveValue(/#answer=/);
        const reply = await bob.locator('#outgoing').inputValue();
        const freshTab = await a.newPage(); await freshTab.goto(reply);
        await expect(freshTab.locator('#notice')).toContainText('original host tab');
        await freshTab.locator('#room-pass').fill(secret); await freshTab.locator('#process').click();
        await expect(freshTab.locator('#error')).toContainText('original host tab');
        await expect(freshTab.locator('#incoming')).toHaveValue(/#answer=/);
    } finally { await a.close(); await b.close(); }
});

test('QR generation produces a decodable invitation with bundled scanner', async ({ page, context }) => {
    await localRTC(context);
    const invitation = await host(page);
    await page.locator('#show-qr').click();
    await expect(page.locator('#qr-dialog')).toBeVisible();
    await expect(page.locator('#qr-error')).toBeHidden();
    // Test the bundled decoder itself against the generator, including the quiet zone.
    const decoded = await page.evaluate(async () => {
        const original = document.querySelector('#qr-code canvas');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = original.width + 80;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(original, 40, 40);
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        const reader = document.createElement('div'); reader.id = 'file-reader'; document.body.append(reader);
        const scanner = new window.Html5Qrcode('file-reader', { formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE] });
        try { return await scanner.scanFile(new File([blob], 'invitation.png', { type: 'image/png' }), false); }
        finally { scanner.clear(); reader.remove(); }
    });
    expect(decoded).toBe(invitation);
    await page.locator('#close-qr').click();
    await expect(page.locator('#qr-dialog')).toBeHidden();
});

test('camera denial is recoverable and dialogs close cleanly', async ({ page }) => {
    await page.goto('./'); await page.locator('#scan').click();
    await expect(page.locator('#scanner-error')).toBeVisible({ timeout: 15000 });
    await page.locator('#close-scanner').click();
    await expect(page.locator('#scanner-dialog')).toBeHidden();
    await page.locator('#incoming').fill('invalid link'); await page.locator('#room-pass').fill(secret);
    await page.locator('#process').click(); await expect(page.locator('#error')).toContainText('Invalid');
});

test('camera scanner captures a synthetic QR stream and automatically generates a reply', async ({ browser }) => {
    const a = await browser.newContext(); const b = await browser.newContext();
    await localRTC(a); await localRTC(b);
    try {
        const alice = await a.newPage(); const bob = await b.newPage();
        await host(alice); await alice.locator('#show-qr').click();
        const qr = await alice.evaluate(() => document.querySelector('#qr-code canvas').toDataURL());
        await bob.goto('./'); await bob.locator('#room-pass').fill(secret);
        await bob.evaluate(async imageURL => {
            const image = new Image(); image.src = imageURL; await image.decode();
            // Match the source grid exactly; actual camera optics still need device QA.
            document.querySelector('#scanner-dialog').style.maxWidth = 'none';
            document.querySelector('#qr-reader').style.width = `${image.naturalWidth + 80}px`;
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = image.naturalWidth + 80;
            const ctx = canvas.getContext('2d');
            window.cameraStream = canvas.captureStream(10);
            // A capture stream needs frames painted after capture starts.
            window.cameraPaint = setInterval(() => {
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 40, 40);
            }, 100);
            Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => window.cameraStream });
        }, qr);
        await bob.locator('#scan').click();
        await expect(bob.locator('#outgoing')).toHaveValue(/#answer=/, { timeout: 15000 });
        await expect(bob.locator('#scanner-dialog')).toBeHidden();
        expect(await bob.evaluate(() => window.cameraStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
        await bob.evaluate(() => clearInterval(window.cameraPaint));
    } finally { await a.close(); await b.close(); }
});

test('clipboard denial and oversized QR retain a usable link', async ({ page, context }) => {
    await localRTC(context); const invitation = await host(page);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } } }));
    await page.locator('#copy').click();
    await expect(page.locator('#notice')).toContainText('Copy the selected link manually');
    await expect(page.locator('#outgoing')).toHaveValue(invitation);
    await page.evaluate(() => { document.querySelector('#outgoing').value = 'https://example.com/#offer=' + 'x'.repeat(5000); });
    await page.locator('#show-qr').click();
    await expect(page.locator('#qr-error')).toContainText('too large');
    await page.locator('#close-qr').click();
    await expect(page.locator('#outgoing')).toHaveValue(/x{5000}$/);
});

test('offline shell works at a GitHub Pages subpath without saving conversation data', async ({ page, context }) => {
    await page.goto('./');
    await expect(page.locator('#offline-status')).toContainText('ready for offline');
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const cached = await page.evaluate(async () => {
        const cache = await caches.open('covenant-peer-chat-v1'); return (await cache.keys()).map(request => request.url);
    });
    expect(cached.length).toBe(15); expect(cached.some(url => /[?#]/.test(url))).toBe(false);
    await context.setOffline(true); await page.reload();
    await expect(page.locator('h1')).toContainText('directly between you');
    await expect(page.locator('#host')).toBeEnabled();
    expect(await page.evaluate(() => typeof window.qrcode)).toBe('function');
    expect(await page.evaluate(() => typeof window.Html5Qrcode)).toBe('function');
    await context.setOffline(false);
});

test('touch layout fits a narrow phone viewport and send starts disabled', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 }); await page.goto('./');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#chat-input')).toBeDisabled();
    await expect(page.locator('#chat-form button')).toBeDisabled();
    await page.locator('#host').click(); await expect(page.locator('#error')).toContainText('passphrase');
});
