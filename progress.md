# FileForge — File Converter, Icon & QR Generator

## File Architecture Map
- `index.html` — 3-tab app shell (File Converter, Icon Generator, QR Generator) + OG/PWA meta
- `vite.config.js` — Dev-server COOP/COEP headers, FFmpeg dep config
- `netlify.toml` / `vercel.json` — Static deploy + COOP/COEP headers (FFmpeg.wasm requires them)
- `public/manifest.webmanifest` — PWA manifest
- `public/sw.js` — Service worker (offline app shell caching)
- `src/main.js` — Tab nav, converter, icon, QR orchestration + paste-upload + PWA register
- `src/converters/registry.js` — Format registry (input -> category -> outputs), MIME types
- `src/converters/image.js` — Canvas image conversion (+ optional resize)
- `src/converters/media.js` — FFmpeg.wasm audio/video conversion
- `src/converters/document.js` — Pure-JS data/doc conversion
- `src/generators/qrGenerator.js` — Custom QR rendering (dots/eyes/gradient/logo)
- `src/generators/iconGenerator.js` — Multi-platform icon bundle (JSZip)
- `src/utils/ico.js` — Windows ICO encoder
- `src/style.css` — All styling (dark premium theme)

## Completed Features
- **File Converter**: auto-detect file type, show matching outputs; image (Canvas), audio/video (FFmpeg.wasm), documents (pure JS)
- **Icon Generator**: Windows/iOS/Android/Favicon from one image
- **QR Generator**: URL/Text/Phone/Email/WiFi/WhatsApp/VCard/SMS/Geo/Event; shapes, colors, gradient, logo; PNG/WEBP/SVG export
- **PWA**: installable + offline (manifest + service worker)
- **UX**: paste-to-upload (Ctrl+V), copy-result-to-clipboard, custom output filename, image resize, QR error-correction selector
- **Responsive**: mobile nav tabs (icon-only), 2-col formats grid, sticky mobile QR preview, safe-area padding

## Recent Changes
- Background reworked to muted radial blooms + faint dot texture + vignette (modern-classical)
- Added global `.hidden { display:none !important }` — FIXED QR conditional fields (and icon editor panel, color pickers, logo controls that were wrongly always visible)
- Formats grid: 2 per row on desktop
- QR: removed "1."/"2." prefixes, added SMS/Geo/Event types + error-correction selector
- Converter: output filename field (auto basename.ext fallback), image resize control, copy-to-clipboard button
- Added OG/Twitter meta tags + PWA manifest link
- Added public/manifest.webmanifest and public/sw.js

## Mobile UX Refinements (latest)
- Top tabs: icon + short label (Convert / Icon / QR) on mobile; full labels on desktop
- Mobile QR preview: full preview card stays in-flow at form bottom; added fixed mini-QR centered on right edge (always visible while editing, ≤840px, QR tab only), painted live from same canvas
- Error Correction selector now has a one-line helper hint

## Bug Found: Service Worker serving stale cached index.html
- Symptom: #1 (tab short labels) appeared but #2 (mini-QR) and #3 (EC hint) did not render on QR tab at 375px.
- Root cause: public/sw.js used cache-first for ALL GET (including /index.html); registered before the refinements, so browser served pre-refinement cached HTML.
- Fix: sw.js now network-first for navigations + cache v2; registerServiceWorker() guarded to PROD only (import.meta.env.PROD) so dev stays fresh.
- User action: unregister old SW (DevTools > Application > Service Workers > Unregister) + hard reload once.

## Known Limitations / Notes
- Animated GIF input converts only first frame (Canvas limitation)
- TIFF input unsupported in Firefox / older Safari
- WMA input depends on prebuilt @ffmpeg/core codecs (untested)
- FFmpeg core (~31MB) streams from jsdelivr CDN on first use per browser
- PWA service worker is progressive: if COEP blocks SW registration in some browsers, app still works (just no offline). Failure is caught silently.
- og:image points to /favicon.svg — replace with a real social preview PNG for best link previews.

## Next Steps
- [ ] Test live: image, document, audio, video on desktop + mobile
- [ ] Verify QR SMS/Geo/Event + error-correction scanning
- [ ] Verify paste-upload + copy-to-clipboard in browser
- [ ] (Optional) Replace og:image with a proper preview image
- [ ] Commit, push, deploy to Vercel/Netlify
