import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = new URL('../docs/', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
let assets;
new Script(sw.slice(0, sw.indexOf('const ASSET_URLS')) + '\nglobalThis.assets = ASSETS;').runInNewContext({ globalThis: { set assets(value) { assets = value; } } });
for (const asset of assets) {
    assert.ok(existsSync(new URL(asset, root)), `Missing cached asset ${asset}`);
    if (asset.endsWith('.js') && !asset.includes('/vendor/')) execFileSync(process.execPath, ['--check', fileURLToPath(new URL(asset, root))]);
}
execFileSync(process.execPath, ['--check', fileURLToPath(new URL('sw.js', root))]);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './');
for (const icon of manifest.icons) {
    const bytes = readFileSync(new URL(icon.src, root));
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
}
const hashes = {
    'qrcode.min.js': '164fc2c1c9eaf0a03aa8dfdb855e82e41a5c6922fbad8bb3238116207e26bef7',
    'html5-qrcode.min.js': '660b12437b1d747e3e68b8be0685c08cb728140110ad213f167b14b66f8b1d8e'
};
for (const [file, expected] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(`js/vendor/${file}`, root))).digest('hex'), expected);
}
console.log(`Validated ${assets.length} offline assets, module syntax, PNG icons, manifest, and vendor hashes.`);
