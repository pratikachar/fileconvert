/**
 * Image Converter — Uses HTML5 Canvas API
 * Supports: PNG, JPG, WebP, BMP, GIF, SVG, ICO, TIFF → PNG, JPG, WebP, BMP
 */

import { OUTPUT_MIME_TYPES } from './registry.js';

/**
 * Convert an image file to a target format using Canvas API
 * @param {File} file - The input image file
 * @param {string} outputExt - Target format extension (png, jpg, webp, bmp)
 * @param {object} options - Conversion options
 * @param {number} options.quality - Quality 0-1 (for jpg/webp)
 * @param {function} options.onProgress - Progress callback (0-100)
 * @returns {Promise<Blob>} - Converted image blob
 */
export async function convertImage(file, outputExt, options = {}) {
  const { quality = 0.9, maxDimension = 0, onProgress = () => {} } = options;

  onProgress(10, 'Reading image...');

  // Read the file as a data URL
  const dataUrl = await readFileAsDataURL(file);
  onProgress(30, 'Decoding image...');

  // Load image into an Image element
  const img = await loadImage(dataUrl);
  onProgress(60, 'Converting format...');

  // Draw onto canvas and export
  const canvas = document.createElement('canvas');
  let drawW = img.naturalWidth || img.width;
  let drawH = img.naturalHeight || img.height;
  if (drawW && drawH && maxDimension > 0) {
    const scale = Math.min(1, maxDimension / Math.max(drawW, drawH));
    drawW = Math.max(1, Math.round(drawW * scale));
    drawH = Math.max(1, Math.round(drawH * scale));
  }
  canvas.width = drawW;
  canvas.height = drawH;

  const ctx = canvas.getContext('2d');

  // For JPG/BMP output, fill white background (no transparency support)
  if (outputExt === 'jpg' || outputExt === 'jpeg' || outputExt === 'bmp') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(img, 0, 0);
  onProgress(80, 'Encoding output...');

  // Get output MIME type
  const mimeType = OUTPUT_MIME_TYPES[outputExt] || 'image/png';

  // Convert canvas to blob
  const blob = await canvasToBlob(canvas, mimeType, quality);
  onProgress(100, 'Done!');

  return blob;
}

/**
 * Read a File as a data URL
 */
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Load an image from a data URL
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image. The format may not be supported by your browser.'));
    // For SVG and cross-origin images
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

/**
 * Convert canvas to blob
 */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error(`Failed to encode image as ${mimeType}. Your browser may not support this output format.`));
        }
      },
      mimeType,
      quality
    );
  });
}
