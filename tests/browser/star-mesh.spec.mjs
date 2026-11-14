import { test, expect } from '@playwright/test';

const password = 'room integration test separate secret';

async function joinRoomFromInvitation(host, client) {
    const invitation = await host.locator('#room-outgoing').inputValue();
    await client.goto(invitation);
    await client.locator('#room-password').fill(password);
    await client.locator('#room-network').selectOption('local');
    await client.locator('#use-room-token').click();
    await expect(client.locator('#room-outgoing')).toHaveValue(/#answer=/);
    await host.locator('#room-incoming').fill(await client.locator('#room-outgoing').inputValue());
    await host.locator('#use-room-token').click();
    await expect(client.locator('#room-status')).toContainText('1 links', { timeout: 15000 });
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
        await expect(host.locator('#room-outgoing')).toHaveValue(/#offer=/);
        await joinRoomFromInvitation(host, first);
        const oldLink = await host.locator('#room-outgoing').inputValue();
        await host.locator('#invite-peer').click();
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
