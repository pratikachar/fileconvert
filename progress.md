# FileForge - File Converter, Icon, Image Editor & QR Generator

## File Architecture Map
- `index.html` - 3-tab app shell (File Converter, Icon Generator, QR Generator) + OG/PWA meta
- `vite.config.js` - Dev-server COOP/COEP headers, FFmpeg dep config
- `netlify.toml` / `vercel.json` - Static deploy + COOP/COEP headers (FFmpeg.wasm requires them)
- `public/manifest.webmanifest` - PWA manifest
- `public/sw.js` - Service worker (offline app shell caching)
- `src/main.js` - Tab nav (4 tabs), converter, icon, QR, editor orchestration + paste-upload + PWA register
- `src/editors/imageEditor.js` - Image Editor orchestrator: canvas, history (undo/redo/reset), filters, text, crop, resize, compress, export (download/copy/share)
- `src/editors/bgRemove.js` - Background removal via @imgly/background-removal (on-demand; models stream through the /imgly-data proxy; Fast/Balanced/Best, license gate for heavy)
- `src/converters/registry.js` - Format registry (input -> category -> outputs), MIME types
- `src/converters/image.js` - Canvas image conversion (+ optional resize)
- `src/converters/media.js` - FFmpeg.wasm audio/video conversion
- `src/converters/document.js` - Pure-JS data/doc conversion
- `src/generators/qrGenerator.js` - Custom QR rendering (dots/eyes/gradient/logo)
- `src/generators/iconGenerator.js` - Multi-platform icon bundle (JSZip)
- `src/utils/ico.js` - Windows ICO encoder
- `src/style.css` - All styling (dark premium theme)

## Completed Features
- **File Converter**: auto-detect file type, show matching outputs; image (Canvas), audio/video (FFmpeg.wasm), documents (pure JS)
- **Icon Generator**: Windows/iOS/Android/Favicon from one image
- **QR Generator**: URL/Text/Phone/Email/WiFi/WhatsApp/VCard/SMS/Geo/Event; shapes, colors, gradient, logo; PNG/WEBP/SVG export
- **PWA**: installable + offline (manifest + service worker)
- **UX**: paste-to-upload (Ctrl+V), copy-result-to-clipboard, custom output filename, image resize, QR error-correction selector
- **Responsive**: mobile nav tabs (icon-only), 2-col formats grid, sticky mobile QR preview, safe-area padding

## Recent Changes
- Background reworked to muted radial blooms + faint dot texture + vignette (modern-classical)
- Added global `.hidden { display:none !important }` - FIXED QR conditional fields (and icon editor panel, color pickers, logo controls that were wrongly always visible)
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
- PWA service worker is now network-only (no caching) - always fresh, still installable; offline caching intentionally dropped (features need CDNs anyway)
- og:image points to /favicon.svg - replace with a real social preview PNG for best link previews.

## Next Steps
- [ ] Test live: image, document, audio, video on desktop + mobile
- [ ] Verify QR SMS/Geo/Event + error-correction scanning
- [ ] Verify paste-upload + copy-to-clipboard in browser
- [ ] (Optional) Replace og:image with a proper preview image

## Image Editor (added)
- New 4th tab "Edit" (icon + short label "Edit"); mobile nav fits 4 tabs (flex, short labels).
- Tools: Filters/Adjust, Text+emoji (draggable), Crop (drag handles), Resize (aspect-locked), Compress (target KB), BG Remove (@imgly, Fast default, license gate for Balanced/Best).
- Export: Download (PNG/JPG/WEBP), Copy-to-clipboard, Web Share API.
- Deps added: @imgly/background-removal, onnxruntime-web (dynamic-imported, lazy chunks; onnxruntime wasm ~23MB streams lazily through the /imgly-data proxy only on first bg-removal use).
- UI labels @imgly as free; heavy models show non-commercial license note + acknowledgment checkbox.

## Image Editor - test checklist
- [ ] 4 tabs fit on 360/375px without overflow
- [ ] Upload via picker / drop / paste
- [ ] Each tool applies + Undo/Redo/Reset works
- [ ] BG Remove live (model download ~40MB fast)
- [ ] Magic Remove local inpaint works; Cloud AI scaffold is optional/experimental
- [ ] Download / Copy / Share on desktop + mobile
- [ ] Commit, push, deploy to Vercel/Netlify

## BUG FIXED: Background removal failed (CORS/COEP)
- Symptom: BG Remove showed only a toast, no result; models never loaded.
- Root cause: @imgly/background-removal fetches model + wasm from `staticimgly.com` via `fetch()` (CORS mode), but staticimgly sends `Cross-Origin-Resource-Policy: cross-origin` with NO `Access-Control-Allow-Origin`. Under COEP `require-corp` (required by FFmpeg.wasm + onnxruntime) the cross-origin `fetch` is blocked -> BG removal fails. Models are also split into hundreds of hashed 4MB chunks (Fast ~44MB, Balanced ~88MB, Best ~176MB), so self-hosting would mean committing ~300MB.
- Fix (proxy, zero repo bloat): point @imgly `publicPath` to same-origin `/imgly-data/1.7.0/dist/` and proxy that path to staticimgly:
  - `src/editors/bgRemove.js`: added `publicPath: '/imgly-data/1.7.0/dist/'`
  - `vite.config.js`: dev `server.proxy['/imgly-data']` -> `https://staticimgly.com` (rewrite to `/@imgly/background-removal-data/*`)
  - `vercel.json`: `rewrites` `/imgly-data/(.*)` -> `https://staticimgly.com/@imgly/background-removal-data/$1`
  - `netlify.toml`: `[[redirects]]` `/imgly-data/*` -> same (status 200, force)
  - `src/editors/imageEditor.js`: BG-remove error toast now shows the real message for diagnosis.
- Verified: dev proxy returns `resources.json` HTTP 200 (22759 B) and a model chunk HTTP 200 (4194304 B) same-origin.
- Note: works in dev (Vite proxy) and prod (rewrite/redirect). User must test in browser; first BG use downloads Fast model (~40MB) once per browser.

## BUG FIXED: Magic Remove (OpenCV) failed - two root causes
- Root cause A (load): `magicRemove.js` pointed at `opencv@4.10.0/build/wasm/opencv.js` - that npm version/package does not exist (404), so OpenCV never loaded. Also `s.crossOrigin='anonymous'` + resolving on `getBuildInformation` raced the async wasm init.
- Fix A: switched to `@techstark/opencv-js@4.10.0-release.1/dist/opencv.js` (self-contained build, wasm embedded as base64, served by jsDelivr with `Access-Control-Allow-Origin: *` + `Cross-Origin-Resource-Policy: cross-origin` → COEP-safe). `loadOpenCV()` now polls until `cv.matFromImageData` exists before resolving (wasm runtime ready), with a 30s timeout.
- Root cause B (api): `cv.inpaint` only accepts 1-/3-channel input, but `getImageData` is 4-channel RGBA → would throw even after OpenCV loaded.
- Fix B: `inpaintLocal()` converts RGBA->BGR, runs inpaint, converts BGR->RGBA back. Error toasts now show the real message.
- Also fixed: `vite.config.js` had TWO `server:` keys (proxy clobbered the COOP/COEP headers), so dev ran without `require-corp` - broke FFmpeg.wasm SharedArrayBuffer and masked the COEP issue. Merged into one `server` block (headers + proxy).

## BUG FIXED (answer to user Q): BG removal earlier vs revised
- The original Image Editor code used @imgly's DEFAULT publicPath (direct to staticimgly.com). staticimgly sends `Cross-Origin-Resource-Policy: cross-origin` but NO `Access-Control-Allow-Origin`, so under COEP `require-corp` the cross-origin `fetch` (CORS mode) is blocked. => would NOT have worked. The revised same-origin proxy (`/imgly-data/*`) is required and is the correct setup. (User confirmed BG works after the proxy change.)

## CHANGED: Magic Remove now uses pure-JS inpainting (no OpenCV)
- @techstark/opencv-js (jsDelivr) is a CORE-only build: `cv.inpaint` is NOT compiled in (grep: inpaint=0), and COLOR_* constants are absent too -> `cv.inpaint(..., cv.INPAINT_TELEA)` throws undefined -> magic remove failed even after the CDN URL was fixed. Official full builds with the photo module aren't reliably COEP-hosted, and self-building is impractical.
- Fix: `src/editors/magicRemove.js` rewritten to pure-JS inpainting - no wasm/CDN/COEP dependency. For each masked pixel, averages the nearest known colors in 4 directions (distance-weighted, max 120px). Works everywhere, offline, instantly.
- `imageEditor.js`: dropped `loadOpenCV` import; Remove button calls `inpaintLocal(imgData, maskCanvas)` directly. Error toasts show real message.

## FIXED: Text tool (default text overlap + cancel) + emoji picker
- Problem: default "Your text" was drawn to the canvas AND shown in the draggable overlay -> doubled/overlapped glyphs; Cancel didn't reliably clear it.
- Fix (`openText` in `imageEditor.js`): default text is now empty (placeholder "Type something…"); ONLY the draggable overlay shows text while editing (canvas untouched), so nothing can overlap; Cancel does `editorCtx.drawImage(toolBaseCanvas,0,0)` + closeTool -> completely removes text; Apply draws the text to canvas once (guards against empty text with a toast).
- Added emoji picker: "😀 Emoji" button toggles a grid of 38 emojis (`#t-emoji-picker`, `.emoji-btn` CSS added to `style.css`); clicking inserts at the cursor position in the text field.

## Image Editor - test checklist (updated)
- [ ] 4 tabs fit on 360/375px without overflow
- [ ] Upload via picker / drop / paste
- [ ] Each tool applies + Undo/Redo/Reset works
- [ ] BG Remove live (model download ~40MB fast)
- [ ] Magic Remove (pure JS) paints + removes without error
- [ ] Text: no default text, no overlap, Cancel removes fully, emoji picker works
- [ ] Download / Copy / Share on desktop + mobile
- [ ] Commit, push, deploy to Vercel/Netlify

## ROUND 3 FIXES (user feedback)
- BG removal: code UNCHANGED since it last worked (publicPath proxy `/imgly-data/1.7.0/dist/` still in `bgRemove.js`). Re-verified: dev proxy returns resources.json HTTP 200 (22759 B) and COEP headers are present. => "Not working" + "no CSS first load then reload fixes" are the classic OLD cache-first service worker still controlling the browser from an earlier deploy. Fix: SW cache bumped to `fileforge-v3` (old caches auto-deleted on activate). USER ACTION: hard reload (or DevTools > Application > Service Workers > Unregister + clear site data) ONCE.
- Magic Remove: was "messing up the entire image" because the directional-average fill blended far-away colors across large painted areas. Rewrote `inpaintLocal` to a SAFE composite fill: masked (painted) pixels take their color from a downscaled<=320px + extra-blurred copy of the image; ALL unmasked pixels are left byte-for-byte untouched. Only the painted region changes.
- Emoji picker: `#t-emoji-picker { display:grid }` was overriding the `hidden` attribute (so ALL emojis always showed), and 8 fixed columns overflowed the box. Fixed: added `#t-emoji-picker[hidden]{display:none}` and changed grid to `repeat(auto-fill, minmax(2em,1fr))` + `max-width:100%` + square buttons, so the toggle works and emojis fit inside the container.
- Verified: `npm run build` passes; dev sends COOP/COEP; `/imgly-data` proxy works. style.css is imported in main.js; production CSS is a real `<link>` in head.

## ROUND 4 FIXES (final stability pass)
- BG removal - SELF-HOSTED Fast model (bulletproof, no proxy dependency):
  - Root cause of user "Failed to fetch": the `/imgly-data` proxy (vite/vercel/netlify) can only work if the deployed site actually has the rewrite AND no stale SW cache. Verified dev proxy serves every chunk with the exact expected size (ALL_OK: wasm 11.8MB, mjs 25KB, fast model 44.3MB), so code was correct but the deployed/stale environment is fragile.
  - Fix: downloaded the Fast assets into `public/@imgly-data/1.7.0/` (resources.json + 15 chunks, 53.6MB, committed; folder deliberately NOT named `dist` because `.gitignore`'s `dist` rule would ignore it). `bgRemove.js` now uses `publicPath` by quality: fast → `/@imgly-data/1.7.0/` (same-origin static, works on dev/Vercel/Netlify/offline under COEP, no proxy needed); balanced/best → `/imgly-data/1.7.0/dist/` (proxy). Only the Fast path is guaranteed; Balanced/Best still stream via proxy.
  - Verified: build passes; dist contains all 16 assets (53.6MB); dev serves `/@imgly-data/...` with HTTP 200.
- Magic Remove - replaced blur-composite with ONION-PEEL DIFFUSION (`inpaintLocal` in `magicRemove.js`): each pass fills masked border pixels with the average of their known neighbours and marks them known, so the fill propagates inward from the mask edges (max 500 passes). Only painted pixels change; the fill is smooth and edge-aware (no more smudgy blur), works for any brush/mask size, no wasm/CDN/COEP dependency.
- First-load CSS flash (FOUC) - `style.css` now loaded as a render-blocking `<link rel="stylesheet" href="/src/style.css">` in `index.html` head instead of via JS import in `main.js` (dev used JS-injected CSS → ~1s flash). Verified built HTML has the real CSS `<link>` in head.
- Cleaned up temp files (test-bg.html, verify/download scripts).

## ROUND 5 - FINAL: user requested light repo + revert BG to first-working (proxy) setup; Magic REMOVED
- User confirmed: BG Remove must load models into the user's browser on first use (like the first build), with NO local/committed files, no git/Vercel limits, and reduced localStorage. Clarified: the "first version" WAS the proxy setup - staticimgly.com sends NO `Access-Control-Allow-Origin` (verified live), so direct cross-origin `fetch()` always fails; same-origin proxy is the only way it can ever work.
- BG Remove: deleted `public/@imgly-data/` entirely (−53.6MB). `bgRemove.js` reverted to a single proxy-only `publicPath: '/imgly-data/1.7.0/dist/'` for fast/balanced/best. Models stream from IMG.LY CDN through our server into the user's browser on first use. Kept vite dev proxy + `vercel.json` rewrite + `netlify.toml` redirect (tiny config files).
- Magic Remove: REMOVED entirely (per user - local non-AI inpainting can't do real content-aware removal). Deleted `magicRemove.js`; removed the 🧽 Magic toolbar button (index.html), `openMagic` + `inpaintLocal`/`inpaintCloud` imports (imageEditor.js), `.seg`/`.seg-btn`/`.mask-dot` CSS (style.css), and the `ff_magic_key`/`ff_magic_ep` localStorage writes (only localStorage the app used - now gone). Editor subtitle no longer mentions magic-erase. Toolbar = Filters, Text, Crop, Resize, Compress, BG Remove.
- Verified: `npm run build` passes; full proxy check ALL_OK for wasm (11.8MB) + mjs + Fast isnet_quint8 (44.3MB) + Balanced isnet_fp16 (88MB); no `@imgly-data` refs remain in src; `dist` has no local model dir.

## Image Editor - test checklist (final)
- [ ] BG Remove (Fast) - proxy-only: models download to the browser on first use from IMG.LY CDN through `/imgly-data`; works after ONE hard reload (stale SW cleared)
- [ ] No CSS flash on first load (style.css now render-blocking `<link>`)
- [ ] Toolbar shows 6 tools (no Magic); each tool + Undo/Redo/Reset works
- [ ] Download / Copy / Share on desktop + mobile
- [ ] Commit + push; deploy to Vercel/Netlify (light repo, no model files)

## ROOT CAUSE FOUND: "Failed to construct 'URL': Invalid base URL" (BG Remove)
- Symptom: BG Remove toast showed "Failed to construct 'URL'".
- Root cause: @imgly's `loadAsBlob` builds `new URL(resource, config.publicPath)`. The URL constructor REFUSES a RELATIVE string base - verified empirically in headless Edge: `new URL("resources.json", "/imgly-data/1.7.0/dist/")` throws "Invalid base URL" even on an http page (Chrome/Edge do NOT resolve a relative base string against the document). Our publicPath was the relative `/imgly-data/1.7.0/dist/`.
- Fix (`src/editors/bgRemove.js`): pass an ABSOLUTE same-origin publicPath built from `location.origin`:
  `publicPath = new URL('/imgly-data/1.7.0/dist/', location.origin).href` -> `http(s)://<host>/imgly-data/1.7.0/dist/`.
- Verified END-TO-END in a real (headless Edge) browser against the dev server under COEP: resources.json -> 11 Fast-model chunks (44.3MB) -> wasm (11.8MB) -> mjs -> inference -> `SUCCESS size=1331 type=image/png`. `npm run build` passes and the built chunk contains the absolute-path builder.

## FIXED: "First load = no tabs clickable; reload fixes it"
- Root cause: service worker cached `/` and `/index.html` at INSTALL time and served them as the navigation fallback. After a deploy, a first-load navigation fetch failure/race could serve the stale cached index.html, which referenced old hashed JS bundles that no longer exist on the server -> `main.js` failed -> tabs dead until a reload fetched fresh HTML. Same bug family as the earlier stale-CSS / stale-tabs issues.
- Fix (`public/sw.js` -> v4): network-only passthrough. No install-time caching, no cache fallback, all old caches deleted on activate. Every load is always fresh; first load always works. The fetch handler stays so the PWA remains installable. Offline app-shell is intentionally dropped (app's real features need network anyway - FFmpeg + bg models come from CDNs).

## AI CLEANER (5th tab) - NEW FEATURE
- Added "AI Cleaner" tab (`tab-btn-ai`, 🧹 / "Clean") - checks and strips AI signatures (C2PA/Content Credentials, XMP, EXIF, PNG generation tags) 100% client-side. Batch + ZIP supported, clear limits shown in the UI.
- New module `src/metadataRemover.js` (self-contained, no DOM at import - pure logic is Node-testable):
  - PNG: byte-level chunk parser (8-byte sig + len/type/data/crc), CRC32 rebuild, selective chunk drop (c2pa iTXt, XMP iTXt, AI text tags like `parameters`, eXIf, unknown ancillary), keeps IHDR/PLTE/IDAT/tRNS/gAMA/sRGB/APNG(acTL/fcTL/fdAT) so pixels render identically.
  - JPEG: marker/segment parser that STOPS at SOS and copies the entropy-coded tail VERBATIM (safe for any scan data / progressive files). Drops APP1 by kind (JUMBF/C2PA, XMP, Exif), APP2 ICC, APP13 IPTC, COM per options; keeps JFIF/Adobe/SOF/DHT/DQT.
  - WebP: RIFF chunk strip (EXIF/XMP/ICCP/C2PA/META) + VP8X feature-flag bits cleared to match; keeps VP8/VP8L/ALPH/ANIM/ANMF.
  - EXIF: custom minimal TIFF/IFD0 reader (Make 0x010F, Model 0x0110, Software 0x0131, DateTime 0x0132/0x9003, GPS IFD presence) - no dependency (exif-reader needs Node Buffer, not browser-compatible; dropped it and unused pngjs).
  - Camera-data injection ("make it look real"): JPEG builds a real Exif APP1 (TIFF IFD0 with Make/Model/Software/DateTime/Orientation) and replaces any existing Exif APP1; PNG appends Software + CreateDate tEXt chunks.
  - Modes: AI-only (default: strip C2PA/XMP/AI PNG tags, keep camera EXIF + ICC) vs Remove-all (strip everything, ICC per toggle) + per-section toggles.
  - Batch: multi-file drop/click/paste or ZIP upload (jszip). Limits displayed: PNG·JPEG·WebP, ≤50 MB/file, ≤20 files/batch, ZIP accepted. Results ZIP-downloaded (or single file); per-file report rows with thumbnails, badges (C2PA/XMP/EXIF/ICC/IPTC/PNG tags/AI), verdict (⚠ N AI markers / ✓ No metadata), details expander, remove-per-item, per-item error handling.
  - Disclaimer note in UI: removes metadata only; pixel watermarks (SynthID) and visual detectors unaffected.
- Wired in `src/main.js` (import + `setupAIMetadataRemover()` in init; paste-upload routes to the AI tab when active). Styles added to `src/style.css` (report cards, badges, seg-mode buttons, camera fields, toggles, responsive @600px stacking). No new runtime deps added (pngjs/exif-reader installed then removed as unnecessary).
- Verified: `npm run build` passes; 26 Node unit checks (scan/strip/inject for PNG/JPEG/WebP incl. verbatim JPEG tail preservation and VP8X flag clearing) ALL PASS; headless-Edge CDP E2E (22 checks: tab wiring, upload, scan UI, AI badges, clean flow, blob capture confirms stripped output) ALL PASS; ZIP input expansion + batch strip verified in Node.
- Cleanup: test harnesses (`.ai-test-tmp`, `public/test-ai-cleaner.html`, temp dumps) removed.

## Next Steps
- [ ] Live test on deployed Vercel/Netlify + mobile (360/375px) - tab bar now has 5 items (Convert/Icon/QR/Edit/Clean)
- [ ] Try a real AI-generated image (e.g. Stable Diffusion PNG with `parameters` chunk) through the AI Cleaner end-to-end
- [ ] Commit + push

## AI UPSCALE + NEW RESIZE (Image Editor 7th tool)
- New toolbar button ✨ **AI Upscale** (`data-tool="aiupscale"`, index.html) + `openAiUpscale()` in imageEditor.js. `openResize()` rewritten as a method-card UI.
- **Resize tool** now offers methods: **Auto** (bilinear, recommended), **Crisp** (Lanczos-3 via new `src/editors/resample.js` - pure JS banded resampler, `resizeLanczos`), **Pixel-art** (nearest). Preset chips 0.5×/1×/2×/4×, live W×H/MP readout, >40MP warning, aspect lock, "Try ✨ AI Upscale" hint. Limits: editor input capped at 2400px; plain resize up to 4× (and 0.5× down).
- **AI Upscale** = tiled Real-ESRGAN via `onnxruntime-web/wasm` (CPU-only, lazy chunk `ort.wasm.bundle.min` ~46KB). Engine in `src/editors/aiUpscale.js` (`UPSCALE_TIERS` table is the single place URLs live).
  - **4 tiers**: Fast (RealESR-AnimeVideo-v3_x4, 2.4MB, default), Balanced (realesr-general-x4v3, 4.9MB), Anime (RealESRGAN_x4plus_anime_6B, 17.9MB), Best (real_esrgan_x4, 64MB).
  - **Scales**: 2× / 4× / 8× (8× = double 4× pass, honestly warned). Input capped 1024px (2048px with "Advanced" toggle); output hard-capped 8192px; 512px tiles with 16px pad + seam averaging; alpha composited over white; multi-pass for 2×/8×.
  - **Dual-source model fetch** (per-tier fallback list): fast/balanced primary via jsDelivr mirror `/jsd-data/gh/…` (byte-exact verified 2,495,473 / 4,871,181); best primary HF `/esrgan-data/…` + fallback `/ghraw-data/soichi11208/Real-ESRGAN-WASM/…` (69,464,831 B verified); anime HF-only (no mirror exists). HuggingFace is anti-bot/flaky from datacenter IPs → mirrors added for robustness; tiny same-origin proxy configs only (no repo bloat, models stream to user browser + browser-cache on first use).
  - **Proxies**: vite `server.proxy` + `vercel.json` rewrites + `netlify.toml` redirects for `/esrgan-data` (HF), `/jsd-data` (cdn.jsdelivr.net), `/ghraw-data` (raw.githubusercontent.com).
  - **ORT wasm**: `scripts/copy-ort-wasm.mjs` (runs on dev/build) copies `ort-wasm-simd-threaded.{mjs,wasm}` (+ jsep) from node_modules to `public/ort/` (gitignored). `.mjs` wrappers are REQUIRED - ort dynamically imports them; wasm configured via `ort.env.wasm.wasmPaths = '/ort/'`, threads = min(4, hardwareConcurrency).
  - **Vite dev quirk fixed**: ort's `import('/ort/ort-wasm-simd-threaded.mjs?import')` returns 500 because Vite refuses to transform `/public` files. Added a small `configureServer` middleware plugin that strips the `?import` query for `/ort/` requests. Static hosts ignore the query in prod, so no prod changes needed.
- **Warnings**: heavy model (anime/best: size+time) and/or 8× show an `#au-warn` panel; "I understand" checkbox gates "Upscale" unless "Remember my choice" is checked (localStorage `fileforge-aiupscale-remember`). License footer (Real-ESRGAN BSD-3 / anime MIT, credit Xinntao).
- **Verification (all pass)**: 39 Node logic tests (Lanczos kernel exact, identity, dims/mean, tier table, same-origin URLs, caps/clamps); `npm run build` green; headless-Edge CDP E2E **11/11**: COOP/COEP isolated, upload, Resize Crisp 2× (64→128, sane pixels), Best 4× (69MB real download via ghraw fallback + real inference → 512×512, mean red 121 sane), Fast 4× (→2048×2048), Best+8× warning visible & mentions 8×/MB, go blocked without "I understand" + instructing toast, zero console errors.
- **Scale limits (user Q)**: downscale 0.5× (Resize); upscale 4× plain (Lanczos) or 2×/4×/8× AI; AI input capped 1024px (2048 advanced), output ≤8192px.

## Next Steps (AI Upscale)
- [ ] Deploy + live-test on Vercel/Netlify: first Fast use streams 2.4MB; Best 64MB is the slow one (mirror fallback covers HF flakiness)
- [ ] Confirm jsDelivr mirrors serve correctly from the deployed site (CORS is open on jsDelivr/raw GitHub)
- [ ] Optional: prefetch/prime Fast model when user opens the tool for snappier first run

## MOBILE TAB BAR FIX (clipped labels)
- Symptom: on phones the 5 nav tabs squeezed to equal width and the longer short labels ("Convert", "Clean") got clipped silently (`overflow:hidden; text-overflow:clip`) so text was cut off (e.g. "Conv", "Clea").
- Fix (`src/style.css`, `@media (max-width:640px)` + `@media (max-width:420px)`):
  - `.nav-tabs`: `overflow-x:auto` + hidden scrollbar (`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`) → swipeable safety net at 641–420px.
  - `.nav-tab`: `flex:0 0 auto; min-width:max-content; padding:8px 10px` (content-sized, no clipping) at 641–420px.
  - `.tab-label-short`: dropped `overflow:hidden; text-overflow:clip` (kept `white-space:nowrap`).
  - At `≤420px`: `.tab-icon{display:none}` + `.nav-tab{flex:1 1 0; min-width:0}` → all 5 text-only tabs fill one row evenly; scroll still backs up ultra-narrow (<360px).
- Verified: `npm run build` passes (exit 0). Visual check pending at 360/375/414/320px.
