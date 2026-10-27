# FileForge - File Converter, Icon, Image Editor & QR Generator

## EXPANSION ROADMAP (2026-10-16, agreed with user: free + client-side only)
Delivered in phases, each one tested + committed separately. Rule for all phases:
no paid API, no server, no LLM, nothing leaves the device.
- **Phase 1 - DONE**: Trim Video + video output containers in the Audio tab.
- **Phase 2 - DONE**: Magic Remove via OpenCV Telea inpaint (OpenCV 4.11, self-hosted, 5.6/255 gradient accuracy).
- **Phase 3 - DONE**: Audio extras fully delivered - karaoke, ringtone, BPM tap, voice recorder (MediaRecorder, local), silence splitter (silencedetect -> multiple results).
- **Phase 4 - DONE (all of it)**: mute, rotate/flip, speed, WhatsApp compress, plus the four leftovers - Extract Frames (frame-exact PNGs, capped at 12, PNG magic verified), GIF->Video (libx264 MP4, alpha flattened, select locked to MP4), Images->Slideshow (concat filter over a normalised canvas, optional music cut with -shortest), Replace Audio Track.
- Phase 4 image plumbing: PNG/JPG/WEBP/GIF/BMP now load into the Audio tab as image rows (no waveform attempt, Image meta line); every audio tool is disabled with an explaining tooltip while an image is active; merge counts and skips images; the output select offers video containers for all four tools.
- Phase 4 bug found by E2E: Replace Audio first shipped as pure `-c copy` remux, which aborts when the new track is WAV/PCM (MP4 cannot hold PCM). Fixed with `buildReplaceAudio`: picture still stream-copied with zero filters (so the `-c:v copy` + `-af` trap cannot trigger), soundtrack re-encoded to the container codec (AAC/MP3/Vorbis - WebM still dodges libopus).
- Verified: build green; **175 Node checks** (+32); **headless-Edge 22/22** - 3-photo slideshow really 3s, music cut to 3.02s, GIF really 2s, 4 frames with PNG magic, replaced track measures **880 Hz over 4.04 s** (zero-crossing), merge accounts for images, audio Cut intact. 0 page errors.
- **Phase 3**: Audio extras - voice recorder (MediaRecorder), karaoke vocal reducer, ringtone maker, silence splitter, BPM tap counter.
- **Phase 4**: Video utilities - lossless trim (shipped in P1), mute, rotate/flip, speed, WhatsApp compressor, extract frames, GIF->video, images->slideshow, replace audio track.
- **Phase 5 - DONE**: Image extras - EXIF viewer, watermark, meme, circle/rounded crop, grid splitter, palette, collage, manual pixelate (16 editor tools). maker, manual pixelate.
- **Phase 6 - DONE**: Text + dev tools tab (13 utilities, 7th tab).
- **Phase 7 - DONE**: PDF mini-suite (new 8th tab: merge, split/extract, images->PDF, rotate).
- **Phase 8 - DONE**: Capture - screen recorder, webcam snapshots, voice notes (all land in the toolbox/editor).
- **Phase 9 - DONE**: UX multipliers - install prompt, share target, recent files, keyboard shortcuts.

### Core-capability probe (headless Edge, pinned @ffmpeg/core 0.12.10)
- Video encoders present: `libx264` OK, `mpeg4` OK, `libvpx-vp9` OK, `h264` OK.
- NOT present: `libvpx` (VP8), `libtheora`, `libaom-av1` -> no WebM-VP8/Theora/AV1 output.
- `drawtext` is MISSING (no freetype) -> all watermarks/text-over-video must be **canvas-composited**, never drawn by ffmpeg.
- lavfi sources work (`testsrc`, `sine`, `aevalsrc`) -> synthetic clips can be generated for tests.
- Filters confirmed working: `scale`, `transpose` (rotate), `setpts` (speed), `zoompan` (slideshow), `volumedetect`, `amix`.
- Implies: Phase 4 video re-encode/compress/rotate/speed is feasible (libx264).

## File Architecture Map
- `index.html` - 3-tab app shell (File Converter, Icon Generator, QR Generator) + OG/PWA meta
- `vite.config.js` - Dev-server COOP/COEP headers, FFmpeg dep config
- `netlify.toml` / `vercel.json` - Static deploy + COOP/COEP headers (FFmpeg.wasm requires them)
- `public/manifest.webmanifest` - PWA manifest
- `public/sw.js` - Service worker (offline app shell caching)
- `src/main.js` - Tab nav (6 tabs), converter, icon, QR, editor, audio, AI-cleaner orchestration + paste-upload + PWA register
- `src/audio/ops.js` - Pure FFmpeg arg-builders for the 9 audio tools (Cut/Merge/Fade/Normalize/Speed+Pitch/Extract/Silence/Reverse/Tags)
- `src/audio/waveform.js` - Peak computation, canvas waveform, time/x mapping, MP3 frame snapping
- `src/audio/audioTab.js` - Audio Toolbox UI: file list, waveform + drag-select, transport, tool rail, results list
- `scripts/test-audio-ops.mjs` - 60 Node checks for ops.js + waveform.js
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
- **Audio Toolbox (6th tab)**: waveform + drag-select; Cut (lossless or re-encode), Merge, Fade, Normalize (loudnorm/gain), Speed & Pitch, Extract Audio from video, Silence Trim, Reverse, ID3 Metadata; results list with Play/Download/Share
- **Cloud-picker hint**: every upload zone tells users to enable Google Drive/Dropbox/OneDrive in the system file picker (no API keys, no server)
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

## AUDIO TOOLBOX (6th tab) + CLOUD-PICKER HINT - NEW FEATURE
- Added 6th tab "Audio Toolbox" (`tab-btn-audio`, 🎵 / short "Audio"): cut, merge, fade, normalize, speed & pitch, extract audio from video, silence trim, reverse, ID3 metadata. **Zero new runtime dependencies** - everything runs on the existing FFmpeg.wasm core.
- Engine fact (verified from ffmpeg.wasm build): `@ffmpeg/core@0.12.10` = FFmpeg **5.1.4**, `--enable-gpl`, no `--disable-filters` → `afade/loudnorm/silenceremove/areverse/atempo/asetrate/aresample/alimiter` + `concat` demuxer all available. Encoders: libmp3lame, libvorbis, libopus, native aac/flac/pcm, libx264/libvpx for video.
- New files: `src/audio/ops.js` (pure arg-builders, Node-testable), `src/audio/waveform.js` (peaks/canvas/time-mapping), `src/audio/audioTab.js` (UI orchestration), `scripts/test-audio-ops.mjs` (60 Node checks).
- `src/converters/media.js` reworked: exports `getFFmpeg()` (shared singleton - the Audio tab reuses the one 31MB core instead of downloading a second), `runFFmpeg({args,inputs,outputs,onProgress})` generic runner that always deletes temp files, and `fsName()`. **Fixed a pre-existing leak**: `ffmpeg.on('progress')` used to be registered inside `convertMedia` on every call, stacking listeners.
- Waveform: peaks from Web Audio `decodeAudioData`; for files >80MB (or when decode fails) falls back to FFmpeg `-f s16le -ac 1 -ar 8000` so a 30-min track costs ~29MB of Int16 instead of ~600MB of Float32. Transport = `<audio>` + rAF playhead + loop-in-selection. Selection is frame-snapped (MP3 = 1152 samples/frame, ~26ms).
- Cut has 2 modes: **Lossless** (`-c copy`, same-format only, bit-exact + instant) and **Re-encode** (any format, required for fades/speed/pitch).
- All tools are non-destructive: every output becomes a row in a Results list (Play / Download / Share / Remove). Originals are never touched.
- BUGS FIXED (found by testing, not guessing):
  - `atempoChain` **infinite loop / RangeError** for rates <0.5 (divided the residual instead of dividing by the factor). Caught by the unit tests.
  - Waveform drag **could never create a selection**: the initial state selects the whole file, so every drag resolved to "move" and got clamped to a no-op. Now a full-length selection is treated as "no selection yet".
  - `silenceremove` produced **0-byte output** for every input. Root cause: `stop_periods=1` in a single instance empties the stream in this build. Fix: two chained `silenceremove` instances with `stop_periods=-1` for the tail. Verified against leading-only / trailing-only / both / clean inputs.
  - Tool rail rendered empty until a file was picked (no initial `renderTools()`/`renderPanel()` in setup).
  - `.nav-tabs` shrink-wrapped at ≤640px (`.header` is `align-items:flex-start`) leaving dead space; now `align-self: stretch`.
- Cloud upload = **Option A only** (no API keys, no OAuth, no server): a `.picker-hint` line on all 5 upload zones - "In the file picker tap ⋮ and switch on Google Drive / Dropbox / OneDrive". The Android SAF picker already lists those providers; no code needed and the privacy promise holds.
- VERIFICATION: `npm run build` passes; **60 Node checks** pass (arg-builders, atempo math, frame snapping, peak math); headless-Edge CDP E2E **8/8** (boot with 0 console errors, 6 tabs, tab opens, file accepted, waveform drawn, 2 real FFmpeg runs); **live tool sweep 9/9** - fade, speed, silence, reverse, merge, normalize, tags (confirmed `ID3` header on the output) all produce real results, 0 exceptions; silence-trim matrix 4/4 correct durations; nav measured at 320/360/375/414/640/900px - no clipped labels, no horizontal overflow.
- Not live-tested (unit-tested only, needs a real video input): Extract Audio. `-vn -map 0:a:0` path is the same `runFFmpeg` proven by the other 8 tools.
- Known limits: MP3 cuts land on ~26ms frame boundaries (inherent to MP3); fades/speed/pitch/normalize always re-encode; the core is the single-threaded build so speed/pitch on long files is slow; first use needs network for the 31MB core (same as today's audio conversion).

## AUDIO TOOLBOX FIXES (user report: dead tools, no multi-add, no delete)
- **Root cause of the dead tools (reproduced, not guessed)**: tool buttons were gated on the ACTIVE file being non-video (`needsAudio`), and `addFiles()` auto-switched the active file to the newest one. So dropping an MP4 (or any video) after an audio file made Cut/Speed/Silence/Reverse/merge go grey while Fade/Normalize stayed live — exactly "cut is default, I switch to fade, then I can't pick cut again; merge/reverse/speed not active". A CDP matrix confirmed it: audio active → all enabled; video active → 5 disabled.
- Fixes:
  - `src/audio/ops.js` `TOOLS`: dropped `needsAudio` entirely. Only `extract` is video-only, `merge` needs 2+ audio files, `tags` needs a taggable format. Every audio tool now works on video inputs too (FFmpeg + Web Audio handle the audio track).
  - `renderTools()` now sets a `title` tooltip explaining WHY a button is disabled instead of leaving a mystery grey button.
  - `addFiles()` no longer steals focus: the active file is kept unless none is selected (previously every add reset the selection + tool panel).
  - `buildTrim`/`buildTags` gained `audioOnly` → adds `-map 0:a:0` so cutting/tagging a video (or an MP3 with embedded cover art) never copies the video stream.
  - **Multi-file**: `MAX_FILES` 12 → 20; the whole `#audio-workspace` is now a drop target (dragover shows `.drop-active` outline), plus a window-level `dragover`/`drop` guard so a stray drop can't make the browser navigate away.
  - **Delete loaded files** with approval: each file chip has a ✕ that arms on first click ("✓ Delete", red) and removes on the second, auto-resetting after 5s. Revokes the object URL, moves the active file to a neighbour, and restores the upload zone when the last file goes. Keyboard accessible (Enter/Space to activate a chip).
  - `index.html`: added a tip line under the file list explaining drop-anywhere + the two-click delete.
- Verified: `npm run build` green; 60 Node checks green; headless-Edge CDP **11/11** (3 files in one add, merge enabled, active file preserved, all 7 audio tools selectable across 2 full rounds, video active keeps every audio tool + enables extract, fade→cut switch works with a video active, delete arms then deletes, deleting all restores the upload zone, workspace accepts drops); live FFmpeg sweep **11/11** including cut+normalize on a video input and MP3 tagging (ID3 header confirmed), 0 exceptions.

## TWO-CLICK DELETE NOW IN ALL 3 PLACES (merge list + results)
- Refactored the per-list confirm into ONE shared mechanism: `state.confirm = {kind, id}` + `armDelete(kind, id)` / `cancelArmedDelete()` / `renderConfirmTargets()` / `removeFile(id)` / `removeResult(id)`. First click arms ("✓ Delete", red + row highlight), second click removes, tap anywhere else or wait 5s to cancel.
- Merge panel: its ✕ already called the confirm but **never re-rendered the panel**, so the button gave no visual feedback while arming (the file list did). Now `renderConfirmTargets()` re-renders the file list, the results AND the merge panel, so the armed state shows in every place that lists the same file.
- Results list: ✕ deleted immediately with no confirmation - now uses the same two-click flow; `removeResult()` also revokes the object URL and stops playback if that result was playing. `clearResults()` now stops playback and clears any armed state too.
- Added `.audio-result.armed` + `.btn-mini.armed` styling (red border/row tint) in `src/style.css`.
- Verified: `npm run build` green; 60 Node checks green; headless-Edge CDP **10/10** on the delete flows (merge arms-then-deletes 3->2, armed state mirrored in the file list, outside tap cancels, results arms-then-deletes 2->1 removing the correct row, Clear all still works); regression sweep **6/6** (3 files load, 7 tools clickable over 2 rounds, video input keeps tools alive, fade->cut switch, real FFmpeg cut on a video input = 25 KB, chip delete 3->2), 0 exceptions.

## FOOTER CREDIT + FIXED UNDEFINED --accent VARIABLE
- Footer: added `<p class="footer-credit">Made by <a class="credit-link" href="https://pratik-acharya.netlify.app/" target="_blank" rel="noopener noreferrer">Pratik Acharya</a></p>`.
- Deliberately the smallest element on the page: `font-size:0.62rem` (~9.9px, vs 11.2px for the sub-line and 12.8px for the main line), `opacity:0.55`, muted colour.
- Hover is subtle: the line lifts to `opacity:0.95`, the name turns the accent purple and gains a faint 45%-alpha underline. Also works on keyboard focus (`:focus-visible`).
- **Pre-existing bug found & fixed**: `var(--accent)` was used in **17 places** but never defined (only `--accent-purple` etc. exist), so every one of those accent colours/borders was silently dropped - Image Editor tool-button hovers, crop dashed border, license-note links, audio tool hovers, delete-button hovers, etc. Added `--accent: #a855f7;` to `:root` as an alias, which revives all 17 at once without touching the cascade.
- Verified: `npm run build` passes; 60 Node checks pass; headless-Edge computed styles confirm 9.92px/0.55 idle and purple + 45% underline + 0.95 opacity on hover; screenshots of both states checked.

## FOOTER CREDIT - touch-friendly affordance (hover removed)
- Removed the hover underline. Hover now only shifts the colour + nudges the arrow.
- **Mobile problem solved**: touch has no hover, so a hover-only affordance is invisible on phones. Added a permanent tiny `↗` external-link glyph inside the link (the standard "leaves the site" convention) - visible at rest on every device, no interaction needed. Plus `:active` styling (purple + full arrow) so a tap gives immediate feedback.
- Tap target: added `padding:7px 4px` to the 9.9px link, growing the hit area from ~12px to **26px tall** while looking unchanged (`margin-top` reduced 8px -> 2px to keep the visual gap).
- Keyboard users keep a focus indicator via `:focus-visible` (1px purple outline) so removing the underline doesn't hurt accessibility for mouse/touch users who never see it.
- Verified: build passes; 60 Node checks pass; headless-Edge computed styles at 900px and 375px both report 9.92px font, 0.55 opacity, `text-decoration:none`, `border-bottom:0px none`, tap area 90x26, arrow `↗` at 0.6 opacity; hover gives purple colour + arrow opacity 1 + translate(1px,-1px) and still NO underline; mobile screenshot reviewed.

## STICKY TAB BAR (option B) + SCROLL RESET ON TAB SWITCH
- Answer to "is the header sticky?": **no** - `.header` was in normal flow, nothing covered the top. The only sticky element was the QR preview card.
- Implemented the chosen option B: moved `<nav class="nav-tabs">` **out of `<header>`** to be a direct child of `#app` and made it `position: sticky; top: 0`. A sticky element can only travel inside its parent's box, so keeping it in `.header` would have made stickiness inert - this is why the markup moved rather than duplicating.
  - The logo + privacy-badge row scrolls away normally; only the 6-tab row pins.
  - `padding-top: calc(6px + env(safe-area-inset-top))` keeps it clear of the phone status bar in the installed standalone PWA (the ≤640px rule repeats this so `padding: 4px` cannot wipe it).
  - `background: rgba(10,10,15,0.82)` + existing backdrop blur, so content passing under it stays readable.
  - `z-index: 100` - above content, below the toast (200), media overlay (999) and error toast (1000).
  - `html { scroll-padding-top: calc(var(--nav-h,56px) + 16px) }` keeps anchored scrolling clear of the bar.
- **No auto-hide on scroll-down**, deliberately: a scroll listener that hides the nav fights the user (scroll a bit, want to switch tabs, nav is gone) and flickers on trackpad momentum. Measured height is only 42px on mobile (short labels) / 76px on desktop (full labels).
- New in `main.js`: publishes the bar's measured height to `--nav-h` via ResizeObserver + resize, so offsets below it stay correct across breakpoints and safe areas.
- BUG FIXED while verifying: `.qr-layout` had `align-items: start`, so `.qr-preview-column` was exactly as tall as the card - the "sticky" preview had **zero travel** and simply scrolled away. Added `.qr-preview-column { align-self: stretch }` (column height 587 -> 898px) so the live preview now genuinely pins below the tab bar via `top: calc(var(--nav-h,56px) + 12px)`.
- BUG FIXED: switching tabs preserved the previous scroll offset, so you could land mid-page on a tab you had not seen. Now `window.scrollTo(0, 0)` on every tab change.
- Verified: build passes; 60 Node checks pass; headless-Edge **20/20** at 1280x800 and 375x740 (nav in natural place at load, pins to exactly 0 when scrolled, logo scrolls away, bar 76px desktop / 42px mobile, z-index 100, all 6 tabs present when pinned, no horizontal overflow, QR preview pins 12px clear of the bar, tab switch resets scroll); post-change regression **6/6** (6 tabs wired, every tab opens, header gap 26px, audio merge still produces 96 KB, two-click delete 2->1, `--nav-h` published = 42px), 0 exceptions.

## AI CLEANER JPEG AUDIT (user report: uploaded JPG showed no details)
User symptom: a JPG showed no report details. Investigation found the REAL cause plus 4 more JPEG bugs, all fixed and verified.

**ROOT CAUSE of the reported symptom (reproduced in headless Edge): `renderItem` crashed on EVERY jpg/webp upload.**
`aiCount` called `r.text.filter(...)`, but only `scanPNG` sets a `text` array - JPEG/WebP reports have no `text` field. The TypeError aborted `renderList()` mid-loop, leaving a visibly empty report panel (the panel itself opened, so it looked like "no details"). PNG uploads never hit it, which is why the earlier 22-check E2E passed.
- Fix: `(r.text || [])` (+ `(r.ai || [])`) in `aiCount`; also gave `scanJPEG`/`scanWebP` a `text: []` so all three report shapes match.
- Verified live: a plain JPEG upload now renders 1 card with zero errors.

**BUG 2 - C2PA in JPEG was completely invisible (scan AND strip).** Real Content Credentials embed JUMBF in **APP11 (0xFFEB)**, which the code never inspected. Worse, the `"c2pa"` box sits behind NUL CI bytes, so even a NUL-terminated read could never see it. Effect: AI JPGs carrying Credentials (Firefly/Photoshop) reported "No embedded AI markers", and AI-mode cleaning left the Credentials intact.
- Fix: `scanJPEG` flags APP11 containing `c2pa` in the first 256 raw bytes (new `payloadContains` helper, NUL-safe). `processJPEG` does a pre-pass and strips every JUMBF-headed APP11 chunk only when a C2PA manifest is present - so JXL-in-JUMBF (`jxlc`, no `c2pa`) codestreams and any other APP11 use survive byte-for-byte (verified).
- Legacy JUMBF-in-APP1 path kept as-is and now covered by tests.

**BUG 3 - IPTC was never detected NOR stripped on any real JPEG.** Both `scanJPEG` and `keepJPEGSegment` read only a 12-byte header window, but `"Photoshop 3.0" + NUL` is 14 bytes - the window truncates to `"Photoshop 3."`, which never matches. Fix: 16-byte window in both places. Also added an `AI IPTC` marker (printable-soup scan of the first 4KB, same spirit as the COM check).

**BUG 4 - Extended XMP missed.** Multi-segment XMP uses `http://ns.adobe.com/xmp/extension/1.0/` and was classified `other` (never flagged, never stripped). `jpegApp1Kind` now maps it to `xmp`, so the existing strip flag covers it.

**BUG 5 - "AI-only (keep camera data)" stripped camera EXIF out of the box.** The HTML ships every checkbox checked, but `setMode('ai')` (which unchecks Strip-EXIF) only ran on button clicks - never on init. The first clean therefore removed camera EXIF despite the label. Fix: `setMode('ai')` once at setup so the initial UI matches the default mode. Verified: `PhoneCam` survives an AI-mode clean again.

**UI consistency:** the EXIF badge required make/model/software/gps, so a DateTime-only EXIF showed "No metadata" while Details showed an EXIF line. The badge now includes `datetime` too.

**Files:** `src/metadataRemover.js` (fixes), `scripts/test-ai-jpeg.mjs` (new, permanent: 34 Node checks over 8 synthetic JPEG shapes + strip assertions).
**Verification:** `npm run build` green; 34/34 Node checks (phone-style/big-endian/datetime-only/C2PA/JXL-negative/extended-XMP/IPTC+AI-caption/APP1-JUMBF, AI-mode + remove-all stripping); headless-Edge E2E **21/21** on pixel-valid canvas JPEGs with spliced-in markers (badges, verdicts, Details text, dims, clean flow, output bytes: no APP11/XMP/C2PA, EXIF+ICC kept, SOI..EOI valid, re-decodes 64x64), 0 page exceptions.
**Not an app bug (environmental):** headless `Browser.setDownloadBehavior` downloads start (`downloadWillBegin`/`downloadProgress`) but then report `canceled` and never land - while the identical anchor-download of data:/blob: URLs completes in the same browser. The `<a download>` mechanism is also what the other four tabs use successfully, so this is a harness quirk, not a product defect; output bytes were verified by tapping the result Blob in-page instead.

## AUDIO TOOLBOX - NOISE CLEANUP (10th tool, in progress)
- Phase 0 probe (headless Edge, pinned core): afftdn/anlmdn/asendcmd/highpass/lowpass/agate/loudnorm/equalizer ALL present; exact option lists captured. Measured on a -17 dB white-noise bed: bare `nr=12` does nothing (default nf=-50 far below real noise); `nr=12:nf=-25` gives 2.4 dB; `tn=1` KILLS the effect (0.0 dB, defaults off); `nr=30:nf=-20:rf=-60` gives 8.1 dB with tone at -0.7 dB; sample-profile mode works; `anlmdn` measured 0.0 dB at s=7..60 while 2-4x slower -> NOT offered. Denoise runs ~30-60x realtime (3 s audio in ~0.1-0.2 s).
- `src/audio/ops.js`: `DENOISE_PRESETS` (light/standard/strong/voice/custom, all inside measured-safe ranges), `denoiseChain()` (highpass -> lowpass -> afftdn incl. om=n hear-removed + optional loudnorm; asendcmd profile commands with preview-seek-relative times), `buildDenoise()` (audio in/out, extract-style path for video inputs, `-ss/-t` previews), `buildRemux()` (filter-free copy mux), `VIDEO_CONTAINER_AUDIO` (webm maps to vorbis - see below), `VIDEO_MIME_TYPES`, `intermediateAudioExt()`, `LONG_DENOISE_WARN_SECS`/`DENOISE_PREVIEW_SECS`.
- `src/audio/audioTab.js`: 10th rail button; panel with preset select (auto-fills sliders, any edit flips to Custom), noise-profile checkbox driven by the waveform selection (<50% rule + 0.5 s minimum, else instructive toast), Advanced details (strength/floor/residual/type/tracking+rumble/highs/normalize), hear-removed checkbox (scoped to preview), per-run Preview-8s button, 10-min long-file warning, video input toggle (same-container default / audio-only), shared format select disabled in video mode.
- Root causes found while verifying (all fixed, none of them guesswork):
  - **libopus encoder traps the pinned core** (plain opus encode with no filters at all) -> WebM video-out uses libvorbis; pre-existing opus OUTPUT format left untouched.
  - **`-c:v copy` + `-af` in one command traps the wasm heap** (and poisons the instance so every later exec fails too). Video-out is therefore two-pass: denoise audio alone, then `buildRemux` (pure copy, no filters). Never combine copy with filtering.
  - **runFFmpeg ignored the exec exit code**, so failed runs that still resolved produced silent garbage (264-byte "successes"). Both runFFmpeg and convertMedia now throw on nonzero exit.
  - **wasm traps used to brick the tab** (every later exec failed identically). New `noteFFmpegCrash()` resets the singleton on trap signatures only, so the next call transparently reloads a fresh core. `runFFmpeg` additionally retries ONCE on a fresh core after a trap (bounded by `_retried`); the legacy converter path gets recovery without auto-retry (long runs shouldn't silently redo themselves).
  - **Worker transfer detaches input buffers**: re-posting the same Uint8Array throws "already detached". runFFmpeg now copies `data` inputs per attempt (safe for retries); the app never reuses buffers (each attempt re-reads Files fresh).
  - **Failures now quote ffmpeg's real stderr tail** (last 3 log lines travel in a 200-entry ring buffer) instead of only the generic wrapper, so the next "command failed" is diagnosable from the toast alone.
  - Extensionless temp names break ffmpeg's muxer guess -> intermediates always get real container extensions via `intermediateAudioExt()`.
- `scripts/test-audio-ops.mjs`: 60 -> 100 checks (chain shape, preset ranges, profile offsets incl. preview-seek shift, om=n/loudnorm interplay, video/audio-only/preview arg shapes, mime + container maps).

## AUDIO TOOLBOX - NOISE CLEANUP (10th tool) - BUILT & VERIFIED
- New "🔇 Noise Cleanup" tool in the Audio tab rail. 100% free/native/client-side: FFmpeg's built-in `afftdn` + `highpass`/`lowpass` (+ optional `loudnorm`), zero new deps/downloads, works offline in APK/PWA once the core is cached.
- UI: preset select (Light/Standard/Strong/Voice/Custom auto-fill sliders, any edit flips to Custom), noise-profile checkbox driven by the waveform selection (<50% + 0.5s-minimum guardrails with instructive toasts), Advanced details (strength/floor/residual/type/tracking+rumble/highs/normalize), hear-removed checkbox (scoped to preview), per-run Preview-8s button, 10-min long-file warning, video toggle (same-container default / audio-only), shared format select auto-disabled in video mode.
- Video-out is TWO-PASS (denoise audio alone, then filter-free copy mux) because `-c:v copy` + `-af` in one command traps the wasm heap; `buildRemux()` does the mux. Intermediates always get real container extensions via `intermediateAudioExt()`.
- Engine hardening in `src/converters/media.js` (protects ALL tools, not just denoise): runFFmpeg + convertMedia now throw on nonzero exit (previously silent 264-byte "successes" were presented as valid files); failures quote ffmpeg's real stderr tail (200-entry ring buffer) instead of only the generic wrapper; `noteFFmpegCrash()` resets the singleton on wasm-trap signatures so one bad file can't brick the tab; `runFFmpeg` auto-retries ONCE on a transparently reloaded core after a trap (bounded, legacy converter path gets recovery without auto-retry); input buffers are copied per attempt because worker transfer detaches them.
- Verification: build green; 107 Node checks (60 old + 47 new); headless-Edge E2E - Standard 2.7 dB noise drop with tone at -0.6 dB, profile mode 2.7 dB / -0.7 dB, noise-only preview 19 dB below the tone with correct 8 s window (audio + video-preview compositions), webm (16-19 KB, EBML+VPx+audio, decodes 160px) and mp4 (75-78 KB) two-pass video-outs, trap fails LOUD with a clear toast and the next run succeeds (recovery proven), auto-retry proven live (trapping command reloaded the core exactly once, then threw cleanly quoting ffmpeg's stderr tail), all 6 core old tools + extract (first live test) still produce outputs, mobile 375 px clean, 0 page exceptions.
- Honest limits (also stated in the panel hint): `arnndn`/AI denoisers unavailable (librnnoise not in the pinned core + needs model hosting); `anlmdn` present but measured 0.0 dB at s=7..60 while 2-4x slower, so not offered; `tn=1` measured harmful on short/mixed content (0.0 dB), defaults off; `libopus` encoder traps this core build on some inputs (verified: 48 kHz stereo Opus-decoded streams; plain WAV encodes fine) -> WebM video-out uses libvorbis, opus output format left untouched; best on steady hiss/hum/fan, not babble.
- Net new runtime dependencies: zero.

## AUDIO TOOLBOX - PREVIEW ROBUSTNESS (user report: Preview 8s stuck on "rendering")
User symptom: preview loads the engine long, then sits on "rendering preview" forever; checkboxes felt dead. Reproduced every preview composition on a healthy engine (wav/mp3/m4a x plain/hear/profile/normalize/track/vinyl/strong/short-file = 11/11 pass), so the logic is sound - the failure signature matches environment, not code: a stalled ~31 MB first core download, or a huge file (the tab had NO size cap, so a big video could OOM the wasm FS with zero feedback and no way out - there was no Cancel at all).
- Fixes (feedback + escape hatches, zero capabilities removed):
  - Engine preloads once on first Audio-tab open with a live status line (`#audio-engine-note`); silent unless it fails.
  - Runs now show a live elapsed-seconds readout plus a real **Cancel** button. Cancel drops the engine (its worker may be hung/poisoned - next call reloads fresh), hides progress, re-enables the UI, toasts, and late completions are discarded by run id so no orphan results appear.
  - Upload size policy (`ops.classifyAudioSize`, unit-tested boundaries): refuse >500 MB with a clear message, warn 150-500 MB pointing at the instant 8s preview.
  - `resetFFmpegEngine()` + `isFFmpegLoading()` exported from media.js.
- Verified: build green; 111 Node checks (60 old + 51 new); headless-Edge 7/7 (preload note -> ready, 600 MB refused with message, cancel mid-run resets UI with no orphan, post-cancel run completes, preview works after), 0 page exceptions.

## PHASE 1: Trim Video + video output containers (Audio tab)
Asked for as "cut videos + video outputs in the Audio tab". Shipped as the 11th rail tool rather than overloading Cut, so existing audio behaviour is untouched.
- **New tool `🎞 Trim Video`** (gated on a video being active, with a hover reason).
- **Two modes**: `🎞 Video (lossless cut)` / `🎵 Audio only` (the audio-only mode reuses the proven `buildTrim` path).
- **Video outputs**: the single output-format select now offers containers (MP4/MOV/MKV/WEBM/AVI/3GP) when a video tool is active, and each mode remembers its own pick (`state.videoOutExt` / `state.audioOutExt`). Default = the source container.
- **Pure stream copy** (`-c copy`): instant, no quality loss. `canLosslessVideoTrim()` encodes the container rule honestly - same container, ISO family (mp4/m4v/mov) interchange, or MKV as the universal target; anything else is refused *before* FFmpeg runs with a readable message.
- **Optional stream mapping** (`0:v:0?` / `0:a:0?`) so files with no audio track do not die on "map matches no streams"; unchecking both still emits a playable picture.
- **Quality-of-life**: start/end mirror the waveform selection, plus "use waveform selection", "First 15s", "Last 15s" presets.
- **Honest limitation surfaced in the UI**: with `-c copy` the cut starts at the nearest *preceding* keyframe, so a clip can begin up to one GOP early. That is the price of not re-encoding; it is stated in the panel, not hidden.
- Verified: build green; **132 Node checks** (21 new: container matrix, argv shape, optional mapping, NaN guards, TOOLS/mime registration); **headless-Edge 13/13** with a synthesized 12 s MP4 - trim 2s..6s produced a **4.02 s** `video/mp4` result, audio-only mode produced an MP3, MP4->WEBM was refused with the UI left usable, and the pre-existing audio Cut on the same video still worked. 0 page errors.
- Bug caught by the E2E: the select change handler still called the renamed `isVideoOut()` -> ReferenceError silently killed the panel re-render (hint went stale). Fixed to `vtrimVideoOut()`.

## PHASE 2: Magic Remove returns (OpenCV.js Telea inpaint, free + offline)
Five earlier attempts failed and were removed. Root cause found this time, and it was **not** "OpenCV can't do this":
- `@techstark/opencv-js@4.10.0-release.1` really is a CORE-only build (`cv.inpaint === undefined`, verified at runtime).
- **`4.11.0-release.1` ships the photo module**: probed live in headless Edge -> `cv.inpaint` = function, `cv.INPAINT_TELEA`/`INPAINT_NS` = numbers, v4.11.0, loads in ~200 ms.
- Lesson recorded in the module header: the wasm exports live *inside* the embedded base64 blob, so grepping the JS for `inpaint` proves nothing. Always assert `typeof cv.inpaint === 'function'` at runtime.
- Shipping method follows the existing ONNX convention: `scripts/copy-opencv-wasm.mjs` copies `dist/opencv.js` (10.9 MB) to `public/cv/` (gitignored) and is wired into `dev` + `build`, so the repo stays light and the engine is same-origin (no COEP problem, no CDN).
- **UI**: new `🩹 Magic Remove` editor tool. Paint the object with a round brush (touch-friendly), live "Marked N% of the image" readout that warns above 12%, brush size, fill radius, mask-growth dilation, Telea/Navier-Stokes switch, Clear mask, Cancel/undo.
- Correctness details that broke the old attempts, now handled: await the UMD factory promise then poll for bindings; RGBA->RGB via `cvtColor` before `inpaint` (it rejects 4 channels); write back into the original RGBA buffer so **alpha survives**; `Mat.delete()` in a `finally` so repeated runs cannot leak the wasm heap.
- **Quantitative proof (not just "it didn't crash")**: on an analytic horizontal+vertical gradient with a 50x50 painted block, Telea lands within **5.6/255 mean error** of the true background, and every pixel **outside** the mask is byte-identical.
- Verified: build green; 9 new Node checks (`scripts/test-magic-remove.mjs`) + 132 audio checks; **headless-Edge 14/14** incl. real mouse-stroke painting (marked 6.2%), fill + undo round-trip, NS method, alpha=128 preserved, dilation ring, polite refusal on an empty mask. 0 page errors.
- Bug found by the E2E: `setPointerCapture` can throw (synthetic/ended pointers) and it aborted the rest of the handler, so the mask view and coverage readout never updated. Now wrapped in try/catch and the readout refreshes on stroke end.

## Next Steps (Phase 3)
- [ ] Live-test Extract Audio with a real MP4/MKV on desktop + phone
- [ ] Test Merge with mixed sources (mp3 + m4a + wav) and normalize on a quiet phone recording
- [ ] Long-file test (>20 min) to confirm the FFmpeg PCM waveform fallback engages cleanly
- [ ] Rebuild the APK with the new 6th tab + verify the cloud-picker hint matches the wrapper's file chooser

## MOBILE NAV (6 tabs)
- `src/style.css` `@media (max-width:420px)`: `.nav-tabs{gap:3px;padding:5px 4px}` + `.nav-tab{flex:1 1 auto; min-width:max-content; padding:8px 7px; font-size:0.68rem}` (6 short labels no longer fit evenly, so tabs size to their label and the row scrolls instead of clipping).
- `@media (max-width:640px)`: `.nav-tabs{align-self:stretch}` because `.header` is `align-items:flex-start` there and the row was shrink-wrapping.
- Verified 320/360/375/414/640/900px: full-width row, 6 labels, no clipping, no page overflow.

## MOBILE TAB BAR FIX (clipped labels - 5-tab era, superseded by MOBILE NAV above)
- Symptom: on phones the 5 nav tabs squeezed to equal width and the longer short labels ("Convert", "Clean") got clipped silently (`overflow:hidden; text-overflow:clip`) so text was cut off (e.g. "Conv", "Clea").
- Fix (`src/style.css`, `@media (max-width:640px)` + `@media (max-width:420px)`):
  - `.nav-tabs`: `overflow-x:auto` + hidden scrollbar (`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`) → swipeable safety net at 641–420px.
  - `.nav-tab`: `flex:0 0 auto; min-width:max-content; padding:8px 10px` (content-sized, no clipping) at 641–420px.
  - `.tab-label-short`: dropped `overflow:hidden; text-overflow:clip` (kept `white-space:nowrap`).
  - At `≤420px`: `.tab-icon{display:none}` + `.nav-tab{flex:1 1 0; min-width:0}` → all 5 text-only tabs fill one row evenly; scroll still backs up ultra-narrow (<360px).
- Verified: `npm run build` passes (exit 0). Visual check pending at 360/375/414/320px.

## AI CLEANER FIX (No metadata wording + scanner gaps)
- Symptom: AI-generated horror image showed "No metadata" / "✓ No metadata" with no details, even though user expected AI markers.
- Root cause: Many ChatGPT/DALL-E/Midjourney downloads embed zero metadata chunks (pixels only) - correct "No metadata" for that file. Scanner also had gaps: `zTXt` compressed text never decompressed, `iTXt` parsed naive (garbled value), JPEG `UserComment (0x9286)` / `ImageDescription (0x010E)` in EXIF never inspected (including ExifIFD), so AI signatures in those fields missed.
- Fix (`src/metadataRemover.js`):
  - UI wording: verdict for empty report now reads "✓ No embedded AI markers - common for ChatGPT / DALL-E downloads. Cleaning keeps pixels unchanged; you can still add camera data." (`renderItem` + `hasNoMeta` check) and alternate "Metadata found - no AI markers" for non-AI metadata.
  - `pngTextValue(data, type)` now type-aware: correctly extracts `iTXt` text (skips language/translatedKeyword), returns empty for `zTXt` compressed (keyword detection still covers it), and `keepPNGChunk` / `scanPNG` use the type-aware value + `looksAI(kw)` check. `scanPNG` correctly handles `iTXt` workflow/prompt even when compressed flag present.
  - `parseEXIF`: added `ImageDescription (0x010E)` + `UserComment (0x9286)` (with ASCII/UTF8/JIS header stripping) and ExifIFD (`0x8769`) parsing for UserComment/DateTime. `scanJPEG` / `scanWebP` now flag `AI UserComment` / `AI description` via `looksAI()` on those fields. `buildDetails` shows UserComment/ImageDescription lines.
- Verified: `npm run build` passes; existing PNG `parameters` tEXt detection still works (Node `scanBuffer` test: `parameters` -> ai:`["parameters"]`); iTXt `workflow` correctly extracted. Clean + add-camera flow unchanged (still verbatim JPEG tail, VP8X flag clearing).

## APK/WEBVIEW FIX (file picker opens in AI Cleaner but not Converter/Icon/Editor)
- Symptom (APK-wrapped app on mobile): tapping upload in Converter / Icon / Editor never opened Files/Media/Camera; AI Cleaner tab worked.
- Root cause: Converter + Icon relied ONLY on the invisible overlay input (`.file-input { opacity:0; position:absolute; inset:0 }`) with NO zone click handler - and the text content sat ABOVE the input (`z-index:1` vs auto), intercepting taps. Opacity:0 overlays routinely fail to trigger `onShowFileChooser` in Android WebView wrappers. Editor was worse: `<input hidden>` (= display:none) + button `.click()` - display:none inputs are ignored by the WebView file chooser. Converter's accept was also a 30+ extension list (`.png,.jpg,...`), which breaks chooser/camera in many wrappers. AI Cleaner worked because it uses the robust pattern: explicit `zone.click -> input.click()` from a real user gesture.
- Fix (same robust pattern everywhere):
  - `src/main.js`: added `uploadZone.click -> fileInput.click()` and `iconUploadZone.click -> iconFileInput.click()` guards (skip when tapping real inputs/buttons).
  - `index.html`: `#editor-file` no longer `hidden`; now `.editor-file-hidden` (1px, opacity 0, never display:none).
  - `src/editors/imageEditor.js`: tapping anywhere on the empty editor card opens the picker (button still handles itself).
  - `src/converters/registry.js`: `getSupportedAccept()` now `image/*,audio/*,video/*,.csv,.json,.yaml,.yml,.xml,.md,.txt` - short MIME wildcards so Android offers Camera + Files.
  - `src/style.css`: `.file-input` now `opacity:0.01; z-index:2` (on top of text, still invisible; some WebViews ignore pure opacity:0) + new `.editor-file-hidden` rule.
- Verified: `npm run build` passes.
- APK-side checklist for user: wrapper must implement `WebChromeClient.onShowFileChooser` (+ `onActivityResult`), grant `READ_MEDIA_IMAGES/VIDEO/AUDIO` (or `READ_EXTERNAL_STORAGE` pre-Android 13) + `CAMERA`, and rebuild the APK with the updated `dist/`.

## PHASE 5: Image extras (8 new editor tools, all client-side)
- **Watermark**: text, 9-position grid, size, opacity, color, soft shadow, live preview.
- **Pixelate**: drag boxes (touch-friendly), blockiness slider, per-region remove, live preview.
- **Shape Crop**: circle (centered square output) or rounded rect, transparent corners, PNG-safe.
- **Meme**: top/bottom Impact text with outline, size slider.
- **Grid Split**: 2-4 cols x 1-4 rows with overlay guides, single-tile download, all-tiles ZIP via JSZip (already a dependency).
- **Palette**: 12-bit bucket counting in pure `src/editors/palette.js` (Node-tested), tap-to-copy hex, transparency skipped.
- **EXIF viewer**: reuses the AI Cleaner exported `scanBuffer`/`formatFromName` on the stashed original upload; always shows file facts, lists Make/Model/Software/Taken/Description/Comment/GPS when present, and says plainly when a file has no tags.
- **Collage**: current photo seeded as #1, up to 4 photos via its own picker, 3 layouts (side-by-side/stacked/2x2), cover-fit cells, live canvas preview.
- **History upgraded to dimension-aware snapshots** (`{w,h,data}` + `restoreSnap`): undo/redo/reset now restore canvas *size* too. This was a latent bug in crop/resize as well - putImageData cannot repaint a resized canvas, so undo after any resize left a broken canvas (caught by E2E: circle-undo stayed 200x200).
- Verified: build green; **229 Node checks** (175 audio + 9 magic + 11 palette + 34 jpeg); **headless-Edge 22/22** - palette #ff0000, watermark/pixelate/meme pixel diffs with undo restoration, circle 200x200 + alpha-0 corners + dim restore, 9-tile ZIP toast, EXIF Make/Model read from a real spliced-APP1 JPEG, 2-photo collage at exactly 1600x800. 0 page errors. Magic Remove re-verified 14/14 after the history change.

## PHASE 6: Text & Dev Tools (new 7th tab, all instant + local)
- 13 utilities: JSON format/minify/validate (with position hints), Base64 (unicode-safe), URL codec, JWT decode (explicitly never verifies - says so), password generator (crypto RNG, never Math.random), live word count, line diff (LCS, capped at 2000 lines/side), Markdown preview (reused `marked`), barcodes (CODE128 + validated EAN-13, SVG download, JsBarcode lazy-imported so the ~100 KB only downloads on demand), unit converter (length/mass/data/temperature), timestamps both directions (s/ms auto-detect), regex tester (live matches + groups + clear errors), color converter (HEX/RGB/HSL all ways).
- Pure logic in `src/texttools/texttools.js` (Node-tested); UI in `src/texttools/textTab.js`; tab wiring follows the auto-discovery nav (button + panel + one setup call).
- Verified: build green (JsBarcode CJS bundles fine); **50 new Node checks**; **headless-Edge 24/24** incl. unicode Base64 round-trip, JWT payload + no-verify warning, live word/diff/markdown/regex/color, real CODE128 bar render, EAN digit validation, 5 km live conversion, epoch both ways. 0 page errors.
- E2E lesson: cold dev boot (ffmpeg/imgly/onnx graph) takes longer than a fixed 3.5 s sleep - wait for the app-rendered rail, not wall time.

## PHASE 7: PDF suite (new 8th tab, pdf-lib lazy chunk)
- 4 tools: Merge (multi-PDF, reorder, per-file page counts), Split/Extract (page ranges like 1-3,5 plus split-every-page to ZIP capped at 20), Images->PDF (fit or A4 sheets), Rotate (per-page 90/180/270).
- Pure logic in `src/pdftools/pdftools.js` (page-spec parser, merge/extract/rotate/images/rotation-readback) - pdf-lib runs in Node, so real byte round-trips are unit-tested, not just browser-tested. UI in `src/pdftools/pdfTab.js` with per-file page counts, reorder, results + downloads, and a `__pdfResults` hook.
- pdf-lib (~600 KB) is genuinely lazy: pdfTab never imports pdftools statically (dynamic import on first need, warmed on tab open). dist proves it - `pdftools-*.js` is its own 412 KB chunk, main bundle untouched.
- Bugs the tests caught: a falsy-`0` bug in the range validator (`if (bad)` missed page 0 - now `!== undefined`), a stale `MAX_SPLIT_PAGES` reference after the lazy refactor (would have 500'd split-all at runtime), and a duplicate `ensurePdfLib` from a half-applied cleanup.
- Verified: build green; **26 Node checks** (spec matrix incl. reversed/garbage/out-of-range, merge 2+3=5, extract order, rotations, A4 geometry); **headless-Edge 12/12** - merged 5 pages, extracted 2, bad range refused, 3-page ZIP, 2-image PDF, 90/90 rotations read back. 0 page errors.

## PHASE 8: Capture (mic already shipped in Phase 3 - verified here; screen + camera new)
- **Screen recorder** (25th audio tool): getDisplayMedia video+optional audio, VP8/Opus webm (MP4 fallback by mime), 10-min cap with countdown, Cancel-wait state so a hanging picker never strands the UI, auto-save when the user ends the share from the browser bar, unsupported browsers get an honest note instead of a dead button. Clips land in the file list as videos, so trim/mute/extract all apply.
- **Webcam snapshot** (17th editor tool): live preview, front/back select, capture replaces the canvas with fresh-image history semantics, tracks always stopped on tool switch/new upload (leak-proofed in openTool + loadImageFile), captured frame stashed as the original file so EXIF view stays coherent.
- **Voice notes**: the Phase 3 mic recorder verified end to end - device list, live recording, webm lands in the list, and the recording cuts like any upload.
- Panel-only tools (record/screen/bpm) now refuse Process with a plain message instead of firing an empty ffmpeg run (pre-existing wart: ffmpeg got `args: []` and errored).
- Headless reality: getDisplayMedia has no picker headless (hangs pre-fix, NotSupportedError with auto-select) - E2E covers the wait/cancel path; the MediaRecorder->file code is shared with the mic path, which is verified with real bytes. CDP `Browser.grantPermissions` + fake devices is the recipe for mic/cam E2E.
- Verified: build green; audio/pdf suites still green (no ops changes); **headless-Edge 15/15** - grant, 25 tools, mic listed/recorded/saved/cut, screen wait/cancel clean, 640x480 live preview, snapshot dims match, history reset. 0 page errors.

## PHASE 9: UX multipliers (install, share-target, recents, shortcuts)
- **Install**: real PNG icons generated with Node zlib (`scripts/gen-icons.mjs`, committed, ~1-4 KB each) because Chrome never fires beforeinstallprompt on SVG alone; manifest now has 192/512 any+maskable PNGs. Always-visible Install button: uses the deferred prompt when offered, honest manual instructions otherwise (iOS-specific), hides once installed.
- **Share-target**: manifest `share_target` (POST /_share) + `file_handlers`; sw.js intercepts the POST (network-only rule untouched otherwise), stashes files in its own tiny IDB, 303-redirects to `/?shared=1`; app intake (`takeInbox`/`routeShared` in `src/utils/sharedInbox.js`) routes images->editor, audio/video->toolbox, PDFs->PDF tools, rest->converter, then reports the routing. New hooks: `__editorLoadFile`, `__converterLoadFile` (audio/pdf hooks already existed).
- **Recent files**: converter remembers up to 8 files (10 MB blob cap, IDB, local-only) with relative times, Reopen, Clear; survives reload; honest 10 MB note in the UI.
- **Shortcuts**: Alt+1..8 switches the 8 tabs, `?` toggles a shortcuts dialog, Esc closes; dead while typing in any field.
- Verified: build green; **15 new Node checks** (routing matrix incl. empty/missing-hook safety, timeAgo, caps); **headless-Edge 18/18** - manifest contents, icon decodes 512 with 22 tones, BIP flow with stub prompt, Alt+4/?/Esc/typing-guard, recent persist+reopen across reload, SW controlled in prod, POST bouncing, PNG->editor + PDF->tools routing with the intake summary. 0 page errors.
- E2E notes: bare `import('pdf-lib')` is unresolvable in-page (bundled chunk) - the preview-side PDF fixture is a hand-rolled minimal PDF (verified it parses in Node first); main.js `showToast` uses `.toast-error`, not `#app-toast` (pre-existing dual toast systems, left alone).

## BONUS: free OCR via Tesseract.js (lazy, self-hosted, image editor tool)
- Engine: tesseract.js v7, self-hosted like OpenCV (worker script + core wasm would trip COEP require-corp from a CDN). `scripts/copy-ocr.mjs` stages worker.min.js, all core SIMD variants and eng.traineddata.gz (~10 MB, downloaded once, skipped when present) into gitignored `public/ocr/`; wired into dev+build. The worker IDB-caches language data after first use.
- New `src/editors/ocr.js`: same-origin `ocrOptions()` (asserted pure: no http anywhere), singleton worker, `summarizeResult()` trims per-line noise. UI: Run with live status %, readonly result, stats, copy, honest scope note (printed English only; handwriting/decorative fonts won't read).
- Verified: build green; 9 Node checks; **headless-Edge 9/9** - synthetic HELLO WORLD/12345 read back at **96% confidence in 6s**, copy works. 0 page errors.
- E2E lesson learned the hard way: static toolbar markup exists long before module setup attaches listeners, so a lost file-input event silently does nothing. Suites must wait on a boot signal (`window.__audioAddFiles`/`__editorLoadFile`) rather than DOM presence or fixed sleeps.

## Names shortened for phones + mobile/PWA audit
- Compact rail labels: every audio (25), text (13) and PDF (4) tool now carries a `short` label, used automatically under 640px via matchMedia (rail re-renders only - open panels and their inputs are never touched, so rotate/resize loses nothing). The editor toolbar swaps via `data-short` (Magic Remove -> Magic). Node suites assert full coverage and short<=label.
- Mobile audit at 390px (headless-Edge, real taps): all 8 tabs open with no page-level horizontal overflow, empty and loaded states (25-tool rail + waveform, editor + open tool, 13-tool rail), compact labels verified live on all four rails.
- PWA audit: manifest installability fields complete, all 4 PNG icons fetch at stated sizes, theme-color + apple-touch-icon (added) + manifest link + viewport present, sw.js keeps the share route with skipWaiting/claim and stays network-only otherwise.
- Verified: build green; audio/text/pdf suites green (+registry-short checks); **mobile+PWA 25/25**. 0 page errors.

## Short tab names + heroes + real color picker
- Tabs renamed everywhere to one short label each (Converter, Icon Maker, QR, Editor, AI, AV Tools, Txt Tools, PDF Tools) - the full/short dual-span system is gone. Smaller icons, tighter padding; all 8 fit without scrolling at 390px (356px used) and 360px (326px used).
- Every tab hero now enumerates what the tab does (formats+resize, QR types+SVG export, metadata report, all 25 audio tools, color picker, PDF jobs, all 18 editor tools).
- Color tool is now a real picker: native color input synced both ways with the converter, plus a system EyeDropper button that only appears where the API exists (honest note elsewhere).
- Verified: build green; **tabs-ui 14/14** - exact names, no legacy spans, fit at both widths, all hero keywords, picker both directions, EyeDropper wiring matches API presence. 0 page errors.

## Palette click-to-sample eyedropper
- The Palette tool gained a sampling mode: toggle it, click any pixel on the photo, get HEX + RGB + coordinates in a swatch, tap to copy. Coordinates clamp to the canvas; the overlay listener dies with the overlay node on tool switch (clearOverlay clones it), and the cursor resets when toggled off.
- Verified: build green; **sample E2E 7/7** - red half reads #ff0000 @75,100, blue half #0000ff @225,100 (exact centers, so the client-to-canvas mapping is pixel-perfect), copy works, toggle off clean. 0 page errors.

## Icon-only mobile nav (user call: text cannot fit 8 tabs on a phone)
- Phones (<=640px) show icon buttons; only the ACTIVE tab keeps its short label, so the current location is always readable and all 8 fit with room. Desktop unchanged (full short labels). Every button gained aria-label + title since icons alone (especially `{ }`) are cryptic.
- <=420px no longer hides icons (they ARE the navigation now), just tightens spacing.
- Verified in the mobile audit: icon rail + aria labels + fit at 390px, all 8 labels back at desktop width. 0 page errors.
- Infra note: a long-lived headless profile eventually wedges CDP (hangs with no error) - wipe edge-profile and restart when evaluates start timing out; also gave the E2E harness a 60s CDP timeout so it fails fast with a label instead of hanging forever.

## Daily tab + final round (tabs, install row, icons, picker)
- Tab names now exactly: Convert, Icon, QR, Edit, AI, AV, TXT, PDF (+ Daily) with fuller aria-labels; legacy dual spans gone. Mobile is pure icon rail (even the active tab shows no label); desktop taller labels untouched.
- Install button takes its own full-width row above the header on phones (was squeezed beside the badge). Still hides once installed (standalone/appinstalled paths unchanged).
- Icons regenerated with 4x supersampling + analytic corner coverage (were binary alpha - the blur on splash screens). Still 2-8 KB each.
- **New 9th tab: Daily** - live clock + 6 world cities (Intl, no data), stopwatch (laps), countdown timer (WebAudio alarm), Monday-start calendar, weather via Open-Meteo (free, keyless, CORS-open). Timers die on tool switch, tab leave and document-hide so nothing ticks in the background.
- Offline honesty: clock/stopwatch/timer/calendar are pure-local and work offline once loaded; weather needs network; the app shell itself stays network-only by design (stale-cache incidents) so first load needs connectivity either way. News is NOT feasible free (needs API keys / a proxy for CORS-less RSS) - said plainly, not built.
- Verified: build green; **17 new Node checks** (formats, leap calendar incl. Monday-start June 2026, timezone math, WMO table, URL builders); **daily E2E 11/11** - clock ticks, stopwatch pause/reset, 2s timer to Time's up, October 2026 + today marked, month nav, LIVE London weather 16C, Alt+9, 9 tabs fit at 360px. 0 page errors.

## Round: OCR accuracy, movable meme text, multi/logo watermarks, denoise failure, nav rename
- **OCR**: `src/editors/ocr.js` rewritten. Passes are now `enhance` (grayscale + 2%-clipped percentile stretch), `none` (untouched pixels) and `binarize` (stretch + Otsu); Smart runs all three and keeps the best `confidence * log2(2 + words)` score, Fast keeps the enhanced pass, Raw the original. Canvas is scaled into 1400-2400px long side, DPI pinned to 300 and interword spaces preserved. UI gained Quality + Text layout (PSM 3/6/11) selects, pass-aware progress, and says which pass won.
- **Why the 3rd pass**: measured on a low-contrast 1000x620 JPEG, the contrast stretch lost ` at 9.75` and read `148:50` (16 words/92%) while untouched pixels read it perfectly (18 words/95%). Smart now picks the raw pass on such images - preprocessing is no longer assumed to be a win.
- **Meme text**: two draggable overlay handles (normalised 0.02-0.98) size themselves to the wrapped lines; word wrap at 92% width, size/outline/colour/ALL-CAPS controls, reset positions.
- **Watermark**: rewritten as an item list (up to 12), each text or logo, each draggable on the canvas, per-item size/opacity/colour + 9-position grid; logos picked via FileReader and drawn centred with a soft shadow. Row list selects/deletes items.
- **Denoise failure (root cause)**: voice memos recorded by this app are audio-only `.webm`, which was classified as video, so the two-pass video-out mux failed with `Stream map '0:v:0' matches no streams`. Fixes: `buildRemux` now maps `0:v:0?`; every video item is probed once with a muted `<video>` (`videoWidth>0`) and audio-only containers are treated as audio (waveform/chip `\u{1F3B5}`, merge/replace-audio lists, denoise output format, video-only tools disabled with an explanatory title). FFmpeg error text no longer duplicates the stderr tail.
- **Error surface**: persistent `#audio-error` panel with the full message + Copy details (toasts truncate and time out).
- **Naming/nav**: tab label `AV` -> `Audio/Video`, hero -> "Free Audio & Video Tools". Nine labelled tabs need ~830px, so 641-900px viewports now wrap the rail onto a second row (was spilling outside the sticky bar); phones stay icon-only.
- **Discoverability**: `src/utils/scrollPanel.js` `revealPanel()` scrolls a freshly rendered panel under the sticky nav (measured nav height, not the never-defined `--nav-h`); wired into audio, text, PDF and Daily tool clicks - this is what makes the Daily calculator reachable on phones.
- Verified: build green; `test-ocr` 35/35 + `test-audio-ops` 179/179; headless-Edge E2E - low-contrast JPEG read **18 words/95%, "original pixels won"** in 2.0s; meme drag moved 184px with 38.5k canvas bytes changed; watermark 3 simultaneous marks (2 text + 1 logo) with drag, scale/opacity, position grid, delete, apply; audio-only WEBM denoise produced `voice-memo-denoised.mp3` with no error panel; no-track title/hint verified; error panel renders 74px with copy button; Daily calculator revealed in view; nav min-content fits every width (wraps at 660-800). 0 page errors.

## Fix: Daily currency converter ("Rates unavailable: Failed to fetch")
- **Root cause (reproduced in-browser)**: the app called `https://api.frankfurter.app/...`. That host is deprecated (it answers with a `deprecation` header pointing at `api.frankfurter.dev`) and from the browser every request failed with `TypeError: Failed to fetch` while `curl`/PowerShell got a clean 200 - so it was not the user's connection or CORS (`access-control-allow-origin: *` is present). Verified in the headless browser: `.app` fails, `.dev` works.
- **Second latent bug**: AED/SAR were offered in the dropdown but the ECB set has no such rates, so even a working fetch would say "No AED rate in this table." (and `?base=AED` returns HTTP 404).
- Fix in `src/daily/daily.js`: primary URL moved to `https://api.frankfurter.dev/v1/latest?base=...` plus a normalising provider chain - ECB (Frankfurter) -> ExchangeRate-API (`open.er-api.com/v6/latest/<base>`) -> `currency-api` on jsDelivr. Each response is normalised to `{ base, date, rates, source }` by `normalizeRates()` (codes upper-cased, non-finite/<=0 rates dropped). `getRatesCached(base, need)` skips a provider whose table lacks the requested target, keeps a partial table as a last resort so the message stays honest ("No AED rate"), and caches per base for 12h with the winning provider recorded (`rateSourceLabel()`).
- UI (`dailyTab.js`): shows which provider served the rates, keeps the previous table during a refetch (no "Rates not loaded yet" flash), guards against reload loops (`pending` counter + `seq` for out-of-order responses), auto-refetches when the selected target is missing from the cached table, and adds a **Retry** button on failure. Failure text now names every provider tried instead of a bare "Failed to fetch". Shared `fetchJson()` no longer claims "Weather service" for FX errors.
- Verified: `test-daily` **49/49** (new checks: live `.dev` host, no `.app` anywhere, chain shape/ordering, normalisation + junk rejection, er-api/cdn parsing, source labels, lowercase inputs); build green; headless-Edge live E2E - 50 USD = 4,759 INR (ECB), 50 USD = 183.63 AED (auto-fallback, correct 3.6725 peg), 50 USD = 44.7 EUR from the wider table, 50 AED = 1,297.1 INR (ECB has no AED base), forced-offline run produced the three-provider error + Retry, and Retry recovered. 0 page errors.
