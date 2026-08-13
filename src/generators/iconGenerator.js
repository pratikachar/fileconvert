/**
 * Icon Generator Module
 * Generates icons for Web/Favicon, iOS, Android, and Windows from a source image
 */

import JSZip from 'jszip';
import { createIcoFromCanvases } from '../utils/ico.js';

/**
 * Renders a single square canvas icon with customizable background, padding, and corner radius
 * @param {HTMLImageElement} img - Source image element
 * @param {number} size - Output width & height in px
 * @param {Object} options - Customization options
 * @returns {HTMLCanvasElement} - Rendered canvas
 */
export function renderIconCanvas(img, size, options = {}) {
  const {
    bgType = 'transparent', // 'transparent' | 'white' | 'black' | 'custom' | 'gradient'
    bgColor = '#ffffff',
    gradientColor2 = '#22d3ee',
    paddingPct = 0, // 0 to 40
    borderRadiusPct = 0, // 0 (square) | 20 (rounded) | 50 (circle)
  } = options;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const radiusPx = (size * borderRadiusPct) / 100;

  // Background clipping path
  ctx.beginPath();
  if (borderRadiusPct >= 50) {
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  } else if (radiusPx > 0) {
    roundRect(ctx, 0, 0, size, size, radiusPx);
  } else {
    ctx.rect(0, 0, size, size);
  }
  ctx.closePath();

  // Draw Background
  if (bgType !== 'transparent') {
    ctx.save();
    if (bgType === 'white') {
      ctx.fillStyle = '#FFFFFF';
    } else if (bgType === 'black') {
      ctx.fillStyle = '#000000';
    } else if (bgType === 'custom') {
      ctx.fillStyle = bgColor;
    } else if (bgType === 'gradient') {
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, bgColor);
      grad.addColorStop(1, gradientColor2);
      ctx.fillStyle = grad;
    }
    ctx.fill();
    ctx.restore();
  }

  // Draw Image centered with padding
  const paddingPx = (size * paddingPct) / 100;
  const availWidth = size - paddingPx * 2;
  const availHeight = size - paddingPx * 2;

  let drawW = availWidth;
  let drawH = availHeight;
  const imgRatio = img.naturalWidth / img.naturalHeight;

  if (imgRatio > 1) {
    drawH = availWidth / imgRatio;
  } else {
    drawW = availHeight * imgRatio;
  }

  const drawX = (size - drawW) / 2;
  const drawY = (size - drawH) / 2;

  ctx.save();
  // Clip image to background shape if image extends outside
  if (borderRadiusPct > 0) {
    ctx.clip();
  }
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();

  return canvas;
}

/**
 * Helper to draw a rounded rectangle path on canvas
 */
function roundRect(ctx, x, y, width, height, radius) {
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

/**
 * Converts canvas to PNG blob
 */
function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Generates all platform icons and bundles them into a ZIP Blob
 * @param {HTMLImageElement} img - Source image
 * @param {Object} options - Customization options
 * @returns {Promise<{ zipBlob: Blob, previews: Object }>}
 */
export async function buildIconPackage(img, options = {}) {
  const zip = new JSZip();

  // Create preview canvases for UI
  const previewSizes = {
    favicon: 32,
    apple: 180,
    android: 192,
    windows: 256,
  };

  const previewBlobs = {};
  for (const [key, size] of Object.entries(previewSizes)) {
    const canvas = renderIconCanvas(img, size, options);
    previewBlobs[key] = canvas.toDataURL('image/png');
  }

  // 1. Favicon & Web Bundle
  const webFolder = zip.folder('Favicon_Web');
  const icoSizes = [16, 32, 48];
  const icoCanvases = icoSizes.map((s) => renderIconCanvas(img, s, options));
  const icoBlob = await createIcoFromCanvases(icoCanvases);

  webFolder.file('favicon.ico', icoBlob);
  webFolder.file('favicon-16x16.png', await canvasToBlob(renderIconCanvas(img, 16, options)));
  webFolder.file('favicon-32x32.png', await canvasToBlob(renderIconCanvas(img, 32, options)));
  webFolder.file('apple-touch-icon.png', await canvasToBlob(renderIconCanvas(img, 180, options)));
  webFolder.file('android-chrome-192x192.png', await canvasToBlob(renderIconCanvas(img, 192, options)));
  webFolder.file('android-chrome-512x512.png', await canvasToBlob(renderIconCanvas(img, 512, options)));

  const webmanifestContent = JSON.stringify(
    {
      name: 'My App',
      short_name: 'App',
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: options.bgColor || '#ffffff',
      background_color: options.bgColor || '#ffffff',
      display: 'standalone',
    },
    null,
    2
  );
  webFolder.file('site.webmanifest', webmanifestContent);

  // Root also gets favicon.ico for direct convenience
  zip.file('favicon.ico', icoBlob);

  // 2. iOS & Apple App Icons
  const iosFolder = zip.folder('iOS_Apple');
  const iosSizes = [
    { name: 'AppIcon-20x20@2x.png', size: 40 },
    { name: 'AppIcon-20x20@3x.png', size: 60 },
    { name: 'AppIcon-29x29@2x.png', size: 58 },
    { name: 'AppIcon-29x29@3x.png', size: 87 },
    { name: 'AppIcon-40x40@2x.png', size: 80 },
    { name: 'AppIcon-40x40@3x.png', size: 120 },
    { name: 'AppIcon-60x60@2x.png', size: 120 },
    { name: 'AppIcon-60x60@3x.png', size: 180 },
    { name: 'AppIcon-76x76@2x.png', size: 152 },
    { name: 'AppIcon-83.5x83.5@2x.png', size: 167 },
    { name: 'AppIcon-1024x1024.png', size: 1024 },
  ];

  for (const item of iosSizes) {
    const canvas = renderIconCanvas(img, item.size, options);
    iosFolder.file(item.name, await canvasToBlob(canvas));
  }

  const iosContentsJson = {
    images: [
      { size: '20x20', idiom: 'iphone', scale: '2x', filename: 'AppIcon-20x20@2x.png' },
      { size: '20x20', idiom: 'iphone', scale: '3x', filename: 'AppIcon-20x20@3x.png' },
      { size: '29x29', idiom: 'iphone', scale: '2x', filename: 'AppIcon-29x29@2x.png' },
      { size: '29x29', idiom: 'iphone', scale: '3x', filename: 'AppIcon-29x29@3x.png' },
      { size: '40x40', idiom: 'iphone', scale: '2x', filename: 'AppIcon-40x40@2x.png' },
      { size: '40x40', idiom: 'iphone', scale: '3x', filename: 'AppIcon-40x40@3x.png' },
      { size: '60x60', idiom: 'iphone', scale: '2x', filename: 'AppIcon-60x60@2x.png' },
      { size: '60x60', idiom: 'iphone', scale: '3x', filename: 'AppIcon-60x60@3x.png' },
      { size: '1024x1024', idiom: 'ios-marketing', scale: '1x', filename: 'AppIcon-1024x1024.png' },
    ],
    info: { version: 1, author: 'FileForge Icon Generator' },
  };
  iosFolder.file('Contents.json', JSON.stringify(iosContentsJson, null, 2));

  // 3. Android Mipmap Icons
  const androidFolder = zip.folder('Android');
  const androidMipmaps = [
    { dir: 'mipmap-mdpi', size: 48 },
    { dir: 'mipmap-hdpi', size: 72 },
    { dir: 'mipmap-xhdpi', size: 96 },
    { dir: 'mipmap-xxhdpi', size: 144 },
    { dir: 'mipmap-xxxhdpi', size: 192 },
  ];

  for (const mip of androidMipmaps) {
    const subFolder = androidFolder.folder(mip.dir);
    const canvas = renderIconCanvas(img, mip.size, options);
    subFolder.file('ic_launcher.png', await canvasToBlob(canvas));
  }
  androidFolder.file('playstore-icon.png', await canvasToBlob(renderIconCanvas(img, 512, options)));

  // 4. Windows Icons
  const winFolder = zip.folder('Windows');
  const winIcoSizes = [16, 32, 48, 64, 128, 256];
  const winIcoCanvases = winIcoSizes.map((s) => renderIconCanvas(img, s, options));
  const winIcoBlob = await createIcoFromCanvases(winIcoCanvases);

  winFolder.file('icon.ico', winIcoBlob);
  for (const s of winIcoSizes) {
    winFolder.file(`icon-${s}x${s}.png`, await canvasToBlob(renderIconCanvas(img, s, options)));
  }
  winFolder.file('Square150x150Logo.png', await canvasToBlob(renderIconCanvas(img, 150, options)));
  winFolder.file('Square310x310Logo.png', await canvasToBlob(renderIconCanvas(img, 310, options)));

  // Generate complete ZIP blob
  const zipBlob = await zip.generateAsync({ type: 'blob' });

  return {
    zipBlob,
    previews: previewBlobs,
  };
}
