/**
 * QR Code Generator Module
 * Renders fully customized QR codes (dots, eye shapes, gradients, center logo overlay)
 */

import QRCode from 'qrcode';

/**
 * Checks if a row, col coordinate falls inside one of the 3 QR position detection eyes (7x7 corners)
 */
function isEyeModule(row, col, count) {
  // Top-left eye
  if (row < 7 && col < 7) return true;
  // Top-right eye
  if (row < 7 && col >= count - 7) return true;
  // Bottom-left eye
  if (row >= count - 7 && col < 7) return true;
  return false;
}

/**
 * Draws a customized QR Code onto an HTML5 Canvas
 * @param {string} text - The encoded text/payload
 * @param {Object} options - Customization options
 * @returns {Promise<HTMLCanvasElement>} - Rendered Canvas
 */
export async function renderQRCanvas(text, options = {}) {
  const {
    moduleStyle = 'square', // 'square' | 'dots' | 'rounded' | 'extra-rounded'
    eyeStyle = 'square', // 'square' | 'rounded' | 'circle'
    fgColor = '#ffffff',
    useGradient = false,
    gradientColor2 = '#22d3ee',
    bgColor = '#0a0a0f', // or 'transparent'
    size = 512,
    margin = 2, // margin in modules
    logoImg = null,
    logoSizePct = 20,
    logoBgToggle = true,
    errorCorrectionLevel = 'H',
  } = options;

  // Generate QR matrix using QRCode library
  const qr = QRCode.create(text || 'FileForge', { errorCorrectionLevel: logoImg ? 'H' : errorCorrectionLevel });
  const count = qr.modules.size;
  const totalModules = count + margin * 2;
  const cellSize = size / totalModules;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 1. Draw Background
  if (bgColor && bgColor !== 'transparent') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);
  }

  // Prepare Foreground Fill Style (Solid or Gradient)
  let fgStyle = fgColor;
  if (useGradient) {
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, fgColor);
    grad.addColorStop(1, gradientColor2);
    fgStyle = grad;
  }

  ctx.fillStyle = fgStyle;
  ctx.strokeStyle = fgStyle;

  // Determine logo bounds if logo exists
  let logoCenterMin = -1;
  let logoCenterMax = -1;
  if (logoImg) {
    const logoModuleRadius = Math.floor((count * (logoSizePct / 100)) / 2);
    const centerModule = Math.floor(count / 2);
    logoCenterMin = centerModule - logoModuleRadius;
    logoCenterMax = centerModule + logoModuleRadius;
  }

  // 2. Draw Body Modules (excluding eyes and center logo area)
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (isEyeModule(r, c, count)) continue;

      // Skip modules behind central logo if logo background is enabled
      if (logoImg && logoBgToggle) {
        if (r >= logoCenterMin && r <= logoCenterMax && c >= logoCenterMin && c <= logoCenterMax) {
          continue;
        }
      }

      if (qr.modules.get(r, c)) {
        const x = (c + margin) * cellSize;
        const y = (r + margin) * cellSize;

        drawModule(ctx, x, y, cellSize, moduleStyle);
      }
    }
  }

  // 3. Draw Eye Position Detection Patterns (3 corners)
  const eyePositions = [
    { r: 0, c: 0 },
    { r: 0, c: count - 7 },
    { r: count - 7, c: 0 },
  ];

  for (const pos of eyePositions) {
    const x = (pos.c + margin) * cellSize;
    const y = (pos.r + margin) * cellSize;
    const eyeSize = 7 * cellSize;

    drawEyePattern(ctx, x, y, eyeSize, cellSize, eyeStyle, fgStyle);
  }

  // 4. Draw Central Logo (if uploaded)
  if (logoImg) {
    const logoPxSize = (size * logoSizePct) / 100;
    const logoX = (size - logoPxSize) / 2;
    const logoY = (size - logoPxSize) / 2;

    // Draw background padding circle/box for logo
    if (logoBgToggle) {
      const pad = logoPxSize * 0.15;
      const bgBoxX = logoX - pad;
      const bgBoxY = logoY - pad;
      const bgBoxSize = logoPxSize + pad * 2;

      ctx.save();
      ctx.fillStyle = bgColor === 'transparent' ? '#ffffff' : bgColor;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, bgBoxSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw Logo Image inside smooth rounded circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, logoPxSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, logoX, logoY, logoPxSize, logoPxSize);
    ctx.restore();
  }

  return canvas;
}

/**
 * Draws an individual module dot/square
 */
function drawModule(ctx, x, y, size, style) {
  ctx.beginPath();
  if (style === 'dots') {
    ctx.arc(x + size / 2, y + size / 2, size / 2 * 0.85, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === 'rounded') {
    const r = size * 0.25;
    drawRoundedRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, r);
    ctx.fill();
  } else if (style === 'extra-rounded') {
    const r = size * 0.45;
    drawRoundedRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, r);
    ctx.fill();
  } else {
    // Default square
    ctx.fillRect(x, y, size, size);
  }
}

/**
 * Draws eye frame (7x7 modules) & inner ball (3x3 modules)
 */
function drawEyePattern(ctx, x, y, eyeSize, cellSize, eyeStyle, fgStyle) {
  ctx.save();
  ctx.fillStyle = fgStyle;
  ctx.strokeStyle = fgStyle;

  const outerWidth = eyeSize;
  const innerSize = 3 * cellSize;
  const innerOffset = 2 * cellSize;

  if (eyeStyle === 'circle') {
    // Outer Ring
    ctx.lineWidth = cellSize;
    ctx.beginPath();
    ctx.arc(x + outerWidth / 2, y + outerWidth / 2, outerWidth / 2 - cellSize / 2, 0, Math.PI * 2);
    ctx.stroke();

    // Inner Ball
    ctx.beginPath();
    ctx.arc(x + outerWidth / 2, y + outerWidth / 2, innerSize / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (eyeStyle === 'rounded') {
    // Outer Rounded Frame
    ctx.lineWidth = cellSize;
    ctx.beginPath();
    drawRoundedRect(ctx, x + cellSize / 2, y + cellSize / 2, outerWidth - cellSize, outerWidth - cellSize, cellSize * 1.5);
    ctx.stroke();

    // Inner Ball
    ctx.beginPath();
    drawRoundedRect(ctx, x + innerOffset, y + innerOffset, innerSize, innerSize, cellSize);
    ctx.fill();
  } else {
    // Square Frame
    ctx.lineWidth = cellSize;
    ctx.strokeRect(x + cellSize / 2, y + cellSize / 2, outerWidth - cellSize, outerWidth - cellSize);

    // Inner Ball
    ctx.fillRect(x + innerOffset, y + innerOffset, innerSize, innerSize);
  }

  ctx.restore();
}

/**
 * Helper to draw a rounded rectangle
 */
function drawRoundedRect(ctx, x, y, width, height, radius) {
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
 * Exports QR code to SVG markup string
 */
export async function renderQRSVG(text, options = {}) {
  const canvas = await renderQRCanvas(text, { ...options, size: 1024 });
  const dataUrl = canvas.toDataURL('image/png');

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
    <image width="1024" height="1024" xlink:href="${dataUrl}" />
  </svg>`;
}
