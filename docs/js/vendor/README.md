# Locally bundled QR dependencies

The app makes no runtime CDN requests. These fixed browser bundles are cached by the service worker.

| File | Version | Source | License | SHA-256 |
| --- | --- | --- | --- | --- |
| `qrcode.min.js` | qrcode-generator 1.4.4 | https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js | MIT (`qrcode.LICENSE`) | `164fc2c1c9eaf0a03aa8dfdb855e82e41a5c6922fbad8bb3238116207e26bef7` |
| `html5-qrcode.min.js` | html5-qrcode 2.3.8 | https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js | Apache-2.0 (`html5-qrcode.LICENSE`) | `660b12437b1d747e3e68b8be0685c08cb728140110ad213f167b14b66f8b1d8e` |

Upstream documentation: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), [html5-qrcode](https://github.com/mebjas/html5-qrcode). The QR canvas uses whole pixels per grid cell and a four-cell quiet border to avoid raster artifacts with dense tokens.

Run `npm run check` from the repository root to verify hashes. When deliberately upgrading, review the upstream release, preserve its license, update these hashes and the asset checker, and bump the cache version in `docs/sw.js`.
