import { test, expect } from '@playwright/test';

test('decodes a reproducible corpus of dense QR patterns', async ({ page }) => {
    await page.goto('./star-mesh.html');
    const failures = await page.evaluate(async () => {
        const { createQRCodeCanvas, decodeQRCodeImage } = await import('./js/core/qr-code.js');
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
        const prefixes = ['offer=', 'https://example.org/covenant-between-web-peers/#offer='];
        const variants = [280, 640].flatMap(width => prefixes.map(prefix => ({ width, prefix })));
        const failures = [];
        for (let seed = 1; seed <= 20; seed++) {
            const length = [600, 800, 1000, 1400, 2000][(seed - 1) % 5];
            let state = seed; let payload = '';
            for (let index = 0; index < length; index++) {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                payload += alphabet[state >>> 26];
            }
            for (const { width, prefix } of variants) {
                const text = prefix + payload;
                const canvas = createQRCodeCanvas(text, width);
                const blob = await new Promise(resolve => canvas.toBlob(resolve));
                try {
                    const decoded = await decodeQRCodeImage(new File([blob], 'pattern.png', { type: 'image/png' }));
                    if (decoded !== text) failures.push({ seed, length, width, prefix, error: 'Decoded different text' });
                } catch (error) { failures.push({ seed, length, width, prefix, error: String(error) }); }
            }
        }
        return failures;
    });
    expect(failures).toEqual([]);
});

test('unreadable images produce actionable errors and release temporary DOM resources', async ({ page }) => {
    await page.goto('./star-mesh.html');
    const message = await page.evaluate(async () => {
        const { decodeQRCodeImage } = await import('./js/core/qr-code.js');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
        const drawing = canvas.getContext('2d'); drawing.fillStyle = 'white'; drawing.fillRect(0, 0, 100, 100);
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        try { await decodeQRCodeImage(new File([blob], 'blank.png', { type: 'image/png' })); }
        catch (error) { return error.message; }
    });
    expect(message).toContain('paste/load the text code instead');
    await expect(page.locator('[id^="qr-image-"]')).toHaveCount(0);
});
