# FileForge — File Converter

## File Architecture Map
- `index.html` — App shell + "Supported Conversions" cards
- `vite.config.js` — Dev-server COOP/COEP headers, FFmpeg dep config
- `netlify.toml` / `vercel.json` — Static deploy + COOP/COEP headers (FFmpeg.wasm requires them)
- `src/main.js` — UI orchestration: upload, format detection, convert, download
- `src/converters/registry.js` — Format registry (input -> category -> outputs), MIME types
- `src/converters/image.js` — Canvas-based image conversion (PNG/JPG/WebP)
- `src/converters/media.js` — FFmpeg.wasm audio/video conversion
- `src/converters/document.js` — Pure-JS data/doc conversion (CSV/JSON/YAML/XML/MD/TXT)
- `src/style.css` — Styling

## Completed Features
- Client-side conversion: Image (Canvas), Audio/Video (FFmpeg.wasm), Documents (pure JS)
- Auto-detects uploaded file type and shows only matching output formats
- Drag & drop upload, quality slider for JPG/WebP, progress bar, download
- Cross-Origin Isolation headers for Vercel + Netlify (free tier, fully static)

## Recent Changes (formats)
- Removed **BMP as output** (Canvas cannot encode BMP; it was broken)
- Kept TIFF/BMP/GIF/SVG/ICO as image inputs
- Added **OPUS** audio output
- Added **GIF** video output (video -> animated GIF)
- `media.js`: added `libopus` and `-f gif -vf fps=10` codec args
- `index.html` cards synced with registry

## Known Limitations
- Animated GIF input converts only first frame (Canvas limitation)
- TIFF input unsupported in Firefox / older Safari (may render blank)
- WMA input depends on prebuilt @ffmpeg/core codecs (untested)
- FFmpeg core (~31MB) streams from jsdelivr CDN on first use per browser

## Next Steps
- [ ] Test audio/video conversion live (OPUS + GIF especially)
- [ ] Commit changes and push to GitHub
- [ ] Deploy to Vercel or Netlify