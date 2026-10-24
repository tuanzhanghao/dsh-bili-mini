# Vendored assets

## DASH player

- Package: [`dashjs`](https://www.npmjs.com/package/dashjs) 4.7.4
- File: `dash.all.min.js` (UMD build, exposes `window.dashjs`)
- Source: <https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js>
- License: BSD-3-Clause — see [`LICENSE.dashjs`](LICENSE.dashjs)
- Third-party notices: [`dash.all.min.js.LICENSE.txt`](dash.all.min.js.LICENSE.txt)

dash.js is **not** part of the client bundle. It is served as a static vendor
asset and loaded lazily via `loadScript()` only when the first DASH stream is
played. This keeps the plugin's initial load and client bundle small.

## QR code generator

- Package: [`qrcode-generator`](https://www.npmjs.com/package/qrcode-generator) 1.4.4
- File: `qrcode-generator.cjs` (CommonJS/UMD, loaded by `auth.js` through `createRequire`)
- Source: <https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js>
- License: MIT — see [`LICENSE.qrcode-generator`](LICENSE.qrcode-generator)

The Bilibili login QR is rendered to an SVG data URL on the host, so the login
URL never reaches a third-party QR service.

## Player

- Package: [`artplayer`](https://www.npmjs.com/package/artplayer) 5.4.0
- File: `artplayer.js` (`dist/artplayer.js`, UMD build, exposes `window.Artplayer`)
- Source: <https://cdn.jsdelivr.net/npm/artplayer@5.4.0/dist/artplayer.js>
- License: MIT — see [`LICENSE.artplayer`](LICENSE.artplayer)

## Danmaku plugin

- Package: [`artplayer-plugin-danmuku`](https://www.npmjs.com/package/artplayer-plugin-danmuku) 5.3.0
- File: `artplayer-plugin-danmuku.js` (`dist/artplayer-plugin-danmuku.js`, UMD build,
  exposes `window.artplayerPluginDanmuku`)
- Source: <https://cdn.jsdelivr.net/npm/artplayer-plugin-danmuku@5.3.0/dist/artplayer-plugin-danmuku.js>
- License: MIT — see [`LICENSE.artplayer-plugin-danmuku`](LICENSE.artplayer-plugin-danmuku)

ArtPlayer 5.x injects its own stylesheet from the UMD bundle, and the danmaku
plugin injects its own styles too; there are no separate CSS files to ship. The
plugin serves both scripts under `/bili-mini/vendor/` so playback works without
a CDN or a build step.
