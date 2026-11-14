/** Render the bundled QR encoder at whole-pixel module sizes with a quiet zone.
 * @param {string} text Exact text to transfer.
 * @param {number} [pixels] Preferred width; output keeps modules on whole pixels.
 * @returns {HTMLCanvasElement}
 */
export function createQRCodeCanvas(text, pixels = 280) {
    const qr = globalThis.qrcode(0, 'L'); qr.addData(text, 'Byte'); qr.make();
    const count = qr.getModuleCount();
    const border = 4;
    // Power-of-two module widths preserve the grid when a camera/image is halved.
    const cell = 2 ** Math.max(1, Math.floor(Math.log2(pixels / (count + border * 2))));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = (count + border * 2) * cell;
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = '#fff'; drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.fillStyle = '#000';
    for (let row = 0; row < count; row++) {
        for (let column = 0; column < count; column++) {
            if (qr.isDark(row, column)) drawing.fillRect((column + border) * cell, (row + border) * cell, cell, cell);
        }
    }
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Room code QR. The same code is available as text.');
    return canvas;
}

/** Decode QR symbols with bounded image-scale fallbacks for dense patterns.
 * A detector can miss a valid finder pattern at one sampling scale. These are
 * alternate representations of the same image, not retries of a failed handshake.
 * @param {File} file User-selected image.
 * @returns {Promise<string>} Decoded exchange text.
 */
export async function decodeQRCodeImage(file) {
    const container = document.createElement('div'); document.body.append(container);
    container.id = `qr-image-${crypto.randomUUID()}`;
    container.hidden = true;
    const reader = new Html5Qrcode(container.id, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], useBarCodeDetectorIfSupported: false
    });
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
        if (bitmap.width * bitmap.height > 16000000) throw new Error('QR image is too large. Crop it around the code first.');
        try { return await reader.scanFile(file, false); } catch { /* ZXing can miss valid dense finder patterns. */ }
        for (const scale of [1, 0.5, 0.4, 0.6, 2]) {
            const canvas = document.createElement('canvas');
            const width = Math.round(bitmap.width * scale); const height = Math.round(bitmap.height * scale);
            if ((width + 64) * (height + 64) > 16000000) continue;
            canvas.width = width + 64; canvas.height = height + 64;
            const drawing = canvas.getContext('2d');
            drawing.fillStyle = '#fff'; drawing.fillRect(0, 0, canvas.width, canvas.height);
            drawing.imageSmoothingEnabled = false;
            drawing.drawImage(bitmap, 32, 32, width, height);
            const pixels = drawing.getImageData(0, 0, canvas.width, canvas.height);
            const decoded = globalThis.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
            if (decoded) return decoded.data;
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            try { return await reader.scanFile(new File([blob], 'qr-resampled.png', { type: 'image/png' }), false); }
            catch { /* Try the next bounded sampling scale. */ }
        }
        throw new Error('Could not read this QR image. Try a larger, uncropped image, or paste/load the text code instead.');
    } finally {
        bitmap?.close(); reader.clear(); container.remove();
    }
}

/** Supplement live scanning with the same normalized decoder used for image import.
 * @param {function():HTMLVideoElement|null} getVideo Active scanner video element.
 * @param {function(string):Promise<void>} onDecoded Deliver one recognized code.
 * @returns {function():void} Cancel polling and ignore any pending decode result.
 */
export function startQRCodeVideoFallback(getVideo, onDecoded) {
    let active = true;
    let timer;
    const sampleFrame = async () => {
        try {
            const video = getVideo();
            if (!video || video.readyState < 2 || !video.videoWidth) return;
            const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve));
            const text = await decodeQRCodeImage(new File([blob], 'camera-frame.png', { type: 'image/png' }));
            if (active) await onDecoded(text);
        } catch { /* Most camera frames contain no readable code. Keep scanning. */ }
        finally { if (active) timer = setTimeout(sampleFrame, 750); }
    };
    timer = setTimeout(sampleFrame, 750);
    return () => { active = false; clearTimeout(timer); };
}
