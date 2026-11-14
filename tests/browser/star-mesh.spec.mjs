import { test, expect } from '@playwright/test';

const password = 'room integration test separate secret';

async function joinRoomFromInvitation(host, client) {
    const invitation = await host.locator('#room-outgoing').inputValue();
    await client.goto('./star-mesh.html');
    await client.locator('#room-password').fill(password);
    await client.locator('#room-network').selectOption('local');
    await client.locator('#room-incoming').fill(invitation);
    await client.locator('#use-room-token').click();
    await expect(client.locator('#room-outgoing')).toHaveValue(/^answer=/);
    await host.locator('#room-incoming').fill(await client.locator('#room-outgoing').inputValue());
    await host.locator('#use-room-token').click();
    await expect(client.locator('#room-status')).toContainText('1 links', { timeout: 15000 });
    await expect(host.locator('#room-incoming')).toHaveValue('');
    await expect(client.locator('#room-incoming')).toHaveValue('');
    await expect(host.locator('#room-share-panel')).toBeHidden();
    await expect(client.locator('#room-share-panel')).toBeHidden();
}

test('three real browsers chat in star, send privately, switch to mesh and survive host close', async ({ browser }) => {
    const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const errors = [];
    pages.forEach(page => page.on('pageerror', error => errors.push(error.message)));
    const [host, first, second] = pages;
    try {
        await host.goto('./star-mesh.html');
        await host.locator('#room-password').fill(password);
        await host.locator('#room-network').selectOption('local');
        await host.locator('#create-room').click();
        await expect(host.locator('#room-outgoing')).toHaveValue(/^offer=/);
        await joinRoomFromInvitation(host, first);
        const oldLink = await host.locator('#room-outgoing').inputValue();
        await host.locator('#invite-peer').click();
        await expect(host.locator('#room-outgoing')).toHaveValue(/^offer=/);
        await expect(host.locator('#room-outgoing')).not.toHaveValue(oldLink);
        await joinRoomFromInvitation(host, second);
        await expect(host.locator('#room-status')).toContainText('2 links');
        await first.locator('#room-chat-input').fill('hello star <img src=x>');
        await first.locator('#room-send').click();
        for (const page of pages) await expect(page.locator('.message')).toHaveCount(1);
        await expect(second.locator('#chat-messages img')).toHaveCount(0);
        const target = await second.locator('#room-members li').filter({ hasText: '(you)' }).innerText();
        await first.locator('#room-recipient').selectOption(target.split(' ')[0]);
        await first.locator('#room-chat-input').fill('private in star'); await first.locator('#room-send').click();
        await expect(second.locator('.message')).toHaveCount(2);
        await expect(host.locator('.message')).toHaveCount(1);
        await host.locator('#enable-mesh').click();
        for (const page of pages) await expect(page.locator('#room-status')).toHaveText('mesh · 2 links', { timeout: 20000 });
        await host.close();
        await first.locator('#room-recipient').selectOption('');
        await first.locator('#room-chat-input').fill('direct after host leaves'); await first.locator('#room-send').click();
        await expect(second.locator('.message').last()).toContainText('direct after host leaves');
        expect(errors).toEqual([]);
    } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('room fits a phone viewport and reports a send before joining', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('./star-mesh.html');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#room-chat-input').fill('not connected');
    await page.locator('#room-send').click();
    await expect(page.locator('#room-error')).toContainText('Create or join a room first');
});

async function createLocalRoom(page) {
    await page.goto('./star-mesh.html');
    await page.locator('#room-password').fill(password);
    await page.locator('#room-network').selectOption('local');
    await page.locator('#create-room').click();
    await expect(page.locator('#room-outgoing')).toHaveValue(/^offer=/);
}

test('downloads a plain code file, joins from it, and applies a reply link to the live host', async ({ browser }) => {
    const context = await browser.newContext();
    try {
        const host = await context.newPage(); const client = await context.newPage();
        await createLocalRoom(host);
        const invitation = await host.locator('#room-outgoing').inputValue();
        expect(invitation).not.toContain('http');
        const downloadEvent = host.waitForEvent('download');
        await host.locator('#download-room-token').click();
        const download = await downloadEvent;
        expect(download.suggestedFilename()).toBe('covenant-offer-code.txt');
        await client.goto('./star-mesh.html');
        await client.locator('#room-password').fill(password);
        await client.locator('#room-network').selectOption('local');
        await client.locator('#room-code-file').setInputFiles(await download.path());
        await expect(client.locator('#room-outgoing')).toHaveValue(/^answer=/);
        const replyLink = await client.locator('#room-outgoing-link').inputValue();
        const originalHostId = await host.locator('#room-members li').first().innerText();
        await host.evaluate(link => { location.hash = new URL(link).hash; }, replyLink);
        await expect(host.locator('#room-status')).toContainText('1 links');
        await expect(host.locator('#room-progress')).toContainText('connected');
        await expect(host.locator('#room-incoming')).toHaveValue('');
        await expect(host.locator('#room-outgoing')).toHaveValue('');
        await expect(host.locator('#room-members li').first()).toHaveText(originalHostId);
        await expect(host.locator('#invite-peer')).toBeEnabled();
        await expect(host).not.toHaveURL(/#/);
    } finally { await context.close(); }
});

test('plain-text native share, clipboard fallbacks, paste processing, and bare-token replies', async ({ browser }) => {
    const context = await browser.newContext();
    try {
        const host = await context.newPage(); const client = await context.newPage();
        await host.addInitScript(() => {
            Object.defineProperty(navigator, 'share', { value: async data => { window.sharedData = data; } });
            Object.defineProperty(navigator, 'clipboard', { value: {
                writeText: async () => { throw new Error('denied'); },
                readText: async () => { throw new Error('denied'); }
            } });
        });
        await createLocalRoom(host);
        const invitation = await host.locator('#room-outgoing').inputValue();
        await host.locator('#share-room-token').click();
        expect(await host.evaluate(() => window.sharedData)).toEqual({ text: invitation });
        await host.locator('#copy-room-token').click();
        await expect(host.locator('#room-progress')).toContainText('text is selected');
        await host.locator('#paste-room-token').click();
        await expect(host.locator('#room-progress')).toContainText('Clipboard access is unavailable');
        await client.goto('./star-mesh.html');
        await client.locator('#room-network').selectOption('local');
        await client.locator('#room-password').fill('incorrect password');
        await client.locator('#room-incoming').evaluate((input, text) => {
            const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
            input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        }, invitation);
        await expect(client.locator('#room-error')).toContainText('Cannot decrypt');
        await expect(client.locator('#room-incoming')).toHaveValue(invitation);
        await client.locator('#room-password').fill(password); await client.locator('#use-room-token').click();
        await expect(client.locator('#room-outgoing')).toHaveValue(/^answer=/);
        const reply = (await client.locator('#room-outgoing').inputValue()).slice('answer='.length);
        await host.locator('#room-incoming').evaluate((input, text) => {
            const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
            input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        }, reply);
        await expect(host.locator('#room-status')).toContainText('1 links');
        await expect(client.locator('#room-share-panel')).toBeHidden();
    } finally { await context.close(); }
});

test('imports an actual QR screenshot as a code without camera access', async ({ browser }) => {
    const context = await browser.newContext();
    try {
        const host = await context.newPage(); const client = await context.newPage();
        await createLocalRoom(host);
        const code = await host.locator('#room-outgoing').inputValue();
        await host.locator('#enlarge-room-qr').click();
        await expect(host.locator('#room-large-qr canvas')).toBeVisible();
        const image = await host.locator('#room-large-qr canvas').evaluate(canvas => canvas.toDataURL().split(',')[1]);
        await client.goto('./star-mesh.html');
        await client.locator('#room-qr-file').setInputFiles({ name: 'invitation.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
        await expect(client.locator('#room-incoming')).toHaveValue(code, { timeout: 15000 });
        await expect(client.locator('#room-progress')).toContainText('Code received');
        await expect(client.locator('#room-scanner')).not.toBeVisible();
    } finally { await context.close(); }
});
