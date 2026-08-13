/**
 * FileForge — Main Application Script
 * Orchestrates File Conversion, Icon Generator, and QR Code Generator
 */

import './style.css';
import {
  FORMAT_REGISTRY,
  CATEGORIES,
  getExtension,
  getFormatInfo,
  formatFileSize,
  getSupportedAccept,
} from './converters/registry.js';
import { convertImage } from './converters/image.js';
import { convertMedia } from './converters/media.js';
import { convertDocument } from './converters/document.js';
import { renderIconCanvas, buildIconPackage } from './generators/iconGenerator.js';
import { renderQRCanvas, renderQRSVG } from './generators/qrGenerator.js';

// Helper DOM selector
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================
// 1. Tab Navigation Controller
// ============================================
function setupTabNavigation() {
  const tabs = $$('.nav-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabTarget = tab.getAttribute('data-tab');

      // Update tab buttons state
      tabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      // Update tab contents visibility
      $$('.tab-content').forEach((content) => {
        content.classList.add('hidden');
      });

      const activeContent = $(`#tab-content-${tabTarget}`);
      if (activeContent) {
        activeContent.classList.remove('hidden');
      }
    });
  });
}

// ============================================
// 2. File Converter Module (Original)
// ============================================
const uploadZone = $('#upload-zone');
const fileInput = $('#file-input');
const conversionPanel = $('#conversion-panel');

const fileTypeIcon = $('#file-type-icon');
const fileName = $('#file-name');
const fileMeta = $('#file-meta');
const btnRemove = $('#btn-remove');

const outputFormat = $('#output-format');
const qualityGroup = $('#quality-group');
const qualitySlider = $('#quality-slider');
const qualityValue = $('#quality-value');

const btnConvert = $('#btn-convert');
const btnText = btnConvert.querySelector('.btn-text');
const btnLoader = btnConvert.querySelector('.btn-loader');

const progressSection = $('#progress-section');
const progressBar = $('#progress-bar');
const progressText = $('#progress-text');

const downloadSection = $('#download-section');
const downloadMeta = $('#download-meta');
const btnDownload = $('#btn-download');
const btnConvertAnother = $('#btn-convert-another');

const outputNameInput = $('#output-name');
const resizeGroup = $('#resize-group');
const imgResizeInput = $('#img-resize');
const btnCopy = $('#btn-copy');

let currentFile = null;
let convertedBlob = null;
let convertedFileName = '';

function setupFileConverter() {
  fileInput.setAttribute('accept', getSupportedAccept());

  // Upload events
  fileInput.addEventListener('change', handleFileSelect);

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('drag-over');

    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  btnRemove.addEventListener('click', resetToUpload);

  // Conversion options
  outputFormat.addEventListener('change', () => {
    updateConvertButton();
    updateQualityVisibility();
  });

  qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = qualitySlider.value;
  });

  btnConvert.addEventListener('click', startConversion);

  // Download actions
  btnDownload.addEventListener('click', downloadFile);
  btnCopy.addEventListener('click', copyConvertedToClipboard);
  btnConvertAnother.addEventListener('click', resetToUpload);
}

function handleFileSelect(e) {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
}

function handleFile(file) {
  const ext = getExtension(file.name);
  const info = getFormatInfo(ext);

  if (!info) {
    showToast(`Unsupported file type: .${ext}`);
    return;
  }

  currentFile = file;

  const category = CATEGORIES[info.category];
  fileTypeIcon.textContent = category.icon;
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatFileSize(file.size)} · ${category.label}`;

  populateOutputFormats(info.outputs, ext);

  if (info.qualityAdjustable) {
    qualityGroup.classList.remove('hidden');
  } else {
    qualityGroup.classList.add('hidden');
  }

  if (info.category === 'image') {
    resizeGroup.classList.remove('hidden');
  } else {
    resizeGroup.classList.add('hidden');
  }

  uploadZone.style.display = 'none';
  conversionPanel.classList.remove('hidden');

  hideProgress();
  hideDownload();
  updateConvertButton();
}

function populateOutputFormats(outputs, currentExt) {
  outputFormat.innerHTML = '<option value="">Select format...</option>';

  outputs.forEach((ext) => {
    const opt = document.createElement('option');
    opt.value = ext;
    opt.textContent = `.${ext.toUpperCase()}`;
    outputFormat.appendChild(opt);
  });

  if (outputs.length === 1) {
    outputFormat.value = outputs[0];
    updateConvertButton();
  }
}

function resetToUpload() {
  currentFile = null;
  convertedBlob = null;
  convertedFileName = '';

  conversionPanel.classList.add('hidden');
  uploadZone.style.display = '';
  fileInput.value = '';

  hideProgress();
  hideDownload();

  outputFormat.innerHTML = '<option value="">Select format...</option>';
  qualityGroup.classList.add('hidden');
  resizeGroup.classList.add('hidden');
  outputNameInput.value = '';
  imgResizeInput.value = '';
  qualitySlider.value = 90;
  qualityValue.textContent = '90';
}

function updateConvertButton() {
  const hasFormat = outputFormat.value !== '';
  btnConvert.disabled = !hasFormat;
  btnText.textContent = hasFormat
    ? `Convert to .${outputFormat.value.toUpperCase()}`
    : 'Select a format to convert';
}

function updateQualityVisibility() {
  const selectedExt = outputFormat.value;
  if (selectedExt === 'jpg' || selectedExt === 'jpeg' || selectedExt === 'webp') {
    qualityGroup.classList.remove('hidden');
  } else {
    qualityGroup.classList.add('hidden');
  }
}

async function startConversion() {
  if (!currentFile || !outputFormat.value) return;

  const ext = getExtension(currentFile.name);
  const info = getFormatInfo(ext);
  const targetExt = outputFormat.value;

  btnConvert.disabled = true;
  btnText.classList.add('hidden');
  btnLoader.classList.remove('hidden');
  hideDownload();
  showProgress();

  const onProgress = (pct, msg) => {
    progressBar.style.width = pct + '%';
    progressText.textContent = msg;
  };

  try {
    const quality = parseInt(qualitySlider.value) / 100;
    let blob;

    switch (info.category) {
      case 'image':
        blob = await convertImage(currentFile, targetExt, {
          quality,
          maxDimension: parseInt(imgResizeInput.value, 10) || 0,
          onProgress,
        });
        break;
      case 'audio':
      case 'video':
        blob = await convertMedia(currentFile, targetExt, { onProgress });
        break;
      case 'document':
        blob = await convertDocument(currentFile, targetExt, { onProgress });
        break;
      default:
        throw new Error('Unknown category: ' + info.category);
    }

    convertedBlob = blob;
    const customName = outputNameInput.value.trim().replace(/\.[^.]+$/, '');
    const baseName = customName || currentFile.name.replace(/\.[^.]+$/, '');
    convertedFileName = `${baseName}.${targetExt}`;

    downloadMeta.textContent = `${convertedFileName} · ${formatFileSize(blob.size)}`;
    showDownload();
  } catch (err) {
    console.error('Conversion error:', err);
    showToast(err.message || 'Conversion failed. Please try again.');
    hideProgress();
  } finally {
    btnText.classList.remove('hidden');
    btnLoader.classList.add('hidden');
    updateConvertButton();
  }
}

function downloadFile() {
  if (!convertedBlob) return;
  const url = URL.createObjectURL(convertedBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = convertedFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copyConvertedToClipboard() {
  if (!convertedBlob) return;
  try {
    const item = {};
    item[convertedBlob.type || 'image/png'] = convertedBlob;
    await navigator.clipboard.write([new ClipboardItem(item)]);
    showToast('Copied to clipboard!');
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    showToast('Copy failed. Your browser may not support clipboard for this format.');
  }
}

function showProgress() {
  progressSection.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressText.textContent = 'Preparing...';
}

function hideProgress() {
  progressSection.classList.add('hidden');
}

function showDownload() {
  downloadSection.classList.remove('hidden');
}

function hideDownload() {
  downloadSection.classList.add('hidden');
}

// ============================================
// 3. Icon Generator Module
// ============================================
let iconSourceImg = null;

function setupIconGenerator() {
  const iconUploadZone = $('#icon-upload-zone');
  const iconFileInput = $('#icon-file-input');
  const iconEditorPanel = $('#icon-editor-panel');
  const btnChangeIcon = $('#btn-change-icon');
  const btnDownloadIcons = $('#btn-download-icons');

  const bgRadios = $$('input[name="icon-bg"]');
  const bgColor1 = $('#icon-bg-color1');
  const bgColor2 = $('#icon-bg-color2');
  const colorPickersRow = $('#icon-color-pickers');
  const color2Container = $('#icon-color2-container');

  const paddingSlider = $('#icon-padding-slider');
  const paddingVal = $('#icon-padding-val');
  const radiusSlider = $('#icon-radius-slider');
  const radiusLabel = $('#icon-radius-label');

  // File Upload Handling
  iconFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      loadIconSourceImage(e.target.files[0]);
    }
  });

  iconUploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    iconUploadZone.classList.add('drag-over');
  });

  iconUploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    iconUploadZone.classList.remove('drag-over');
  });

  iconUploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    iconUploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      loadIconSourceImage(e.dataTransfer.files[0]);
    }
  });

  btnChangeIcon.addEventListener('click', () => {
    iconSourceImg = null;
    iconFileInput.value = '';
    iconEditorPanel.classList.add('hidden');
    iconUploadZone.style.display = '';
  });

  // Radio Background Changes
  bgRadios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      // Update active radio chip styling
      $$('.radio-chip').forEach((chip) => chip.classList.remove('active'));
      e.target.closest('.radio-chip').classList.add('active');

      const val = e.target.value;
      if (val === 'custom') {
        colorPickersRow.classList.remove('hidden');
        color2Container.classList.add('hidden');
      } else if (val === 'gradient') {
        colorPickersRow.classList.remove('hidden');
        color2Container.classList.remove('hidden');
      } else {
        colorPickersRow.classList.add('hidden');
      }

      updateIconPreviews();
    });
  });

  bgColor1.addEventListener('input', updateIconPreviews);
  bgColor2.addEventListener('input', updateIconPreviews);

  paddingSlider.addEventListener('input', () => {
    paddingVal.textContent = paddingSlider.value;
    updateIconPreviews();
  });

  radiusSlider.addEventListener('input', () => {
    const val = parseInt(radiusSlider.value);
    if (val === 0) radiusLabel.textContent = 'Square';
    else if (val >= 50) radiusLabel.textContent = 'Circle';
    else radiusLabel.textContent = 'Squircle';

    updateIconPreviews();
  });

  // Download All Icons ZIP
  btnDownloadIcons.addEventListener('click', async () => {
    if (!iconSourceImg) return;

    btnDownloadIcons.disabled = true;
    const origText = btnDownloadIcons.querySelector('span').textContent;
    btnDownloadIcons.querySelector('span').textContent = 'Packaging icon bundle...';

    try {
      const options = getIconOptions();
      const { zipBlob } = await buildIconPackage(iconSourceImg, options);

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'app-icons-package.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('Error generating icon ZIP:', err);
      showToast('Failed to generate icon package.');
    } finally {
      btnDownloadIcons.disabled = false;
      btnDownloadIcons.querySelector('span').textContent = origText;
    }
  });
}

function loadIconSourceImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      iconSourceImg = img;
      $('#icon-upload-zone').style.display = 'none';
      $('#icon-editor-panel').classList.remove('hidden');
      updateIconPreviews();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function getIconOptions() {
  const bgType = $('input[name="icon-bg"]:checked').value;
  const bgColor = $('#icon-bg-color1').value;
  const gradientColor2 = $('#icon-bg-color2').value;
  const paddingPct = parseInt($('#icon-padding-slider').value);
  const borderRadiusPct = parseInt($('#icon-radius-slider').value);

  return {
    bgType,
    bgColor,
    gradientColor2,
    paddingPct,
    borderRadiusPct,
  };
}

function updateIconPreviews() {
  if (!iconSourceImg) return;
  const options = getIconOptions();

  // Render previews for each platform
  const winCanvas = renderIconCanvas(iconSourceImg, 256, options);
  $('#prev-windows').src = winCanvas.toDataURL('image/png');

  const appleCanvas = renderIconCanvas(iconSourceImg, 180, options);
  $('#prev-apple').src = appleCanvas.toDataURL('image/png');

  const androidCanvas = renderIconCanvas(iconSourceImg, 192, options);
  $('#prev-android').src = androidCanvas.toDataURL('image/png');

  const faviconCanvas = renderIconCanvas(iconSourceImg, 32, options);
  $('#prev-favicon').src = faviconCanvas.toDataURL('image/png');
}

// ============================================
// 4. QR Code Generator Module
// ============================================
let qrActiveType = 'url';
let qrModuleStyle = 'square';
let qrEyeStyle = 'square';
let qrLogoImg = null;

function setupQRGenerator() {
  // Data Type Buttons
  $$('.qr-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.qr-type-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      qrActiveType = btn.getAttribute('data-type');
      $$('.qr-input-group').forEach((grp) => grp.classList.add('hidden'));

      const targetGrp = $(`[data-for="${qrActiveType}"]`);
      if (targetGrp) targetGrp.classList.remove('hidden');

      updateQRPreview();
    });
  });

  // Module & Eye style option buttons
  $$('.opt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const styleType = btn.getAttribute('data-style-type');
      const val = btn.getAttribute('data-val');

      $$(`.opt-btn[data-style-type="${styleType}"]`).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      if (styleType === 'module') qrModuleStyle = val;
      else if (styleType === 'eye') qrEyeStyle = val;

      updateQRPreview();
    });
  });

  // Input change listeners for real-time QR update
  $$('#qr-inputs-container input, #qr-inputs-container textarea, #qr-inputs-container select').forEach((elem) => {
    elem.addEventListener('input', updateQRPreview);
  });

  // Color Pickers & Toggles
  $('#qr-fg-color').addEventListener('input', updateQRPreview);
  $('#qr-bg-color').addEventListener('input', updateQRPreview);
  $('#qr-transparent-bg').addEventListener('change', updateQRPreview);

  const qrEcLevel = $('#qr-ec-level');
  if (qrEcLevel) qrEcLevel.addEventListener('change', updateQRPreview);

  $('#qr-gradient-toggle').addEventListener('change', (e) => {
    const isGrad = e.target.checked;
    const gradRow = $('#qr-grad-color-row');
    if (isGrad) gradRow.classList.remove('hidden');
    else gradRow.classList.add('hidden');
    updateQRPreview();
  });
  $('#qr-grad-color2').addEventListener('input', updateQRPreview);

  // Logo Overlay Handling
  const logoInput = $('#qr-logo-input');
  const btnRemoveLogo = $('#btn-remove-qr-logo');
  const logoControls = $('#qr-logo-controls');
  const logoSizeSlider = $('#qr-logo-size-slider');
  const logoSizeVal = $('#qr-logo-size-val');
  const logoBgToggle = $('#qr-logo-bg-toggle');

  logoInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
          qrLogoImg = img;
          btnRemoveLogo.classList.remove('hidden');
          logoControls.classList.remove('hidden');
          updateQRPreview();
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  });

  btnRemoveLogo.addEventListener('click', () => {
    qrLogoImg = null;
    logoInput.value = '';
    btnRemoveLogo.classList.add('hidden');
    logoControls.classList.add('hidden');
    updateQRPreview();
  });

  logoSizeSlider.addEventListener('input', () => {
    logoSizeVal.textContent = logoSizeSlider.value;
    updateQRPreview();
  });

  logoBgToggle.addEventListener('change', updateQRPreview);

  // Export Buttons
  $('#btn-download-qr-png').addEventListener('click', () => downloadQR('png'));
  $('#btn-download-qr-webp').addEventListener('click', () => downloadQR('webp'));
  $('#btn-download-qr-svg').addEventListener('click', downloadQRSVG);

  // Initial QR code generation
  updateQRPreview();
}

function getQRPayload() {
  switch (qrActiveType) {
    case 'url':
      return $('#qr-url-input').value.trim() || 'https://example.com';
    case 'text':
      return $('#qr-text-input').value.trim() || 'Hello from FileForge!';
    case 'phone': {
      const phone = $('#qr-phone-input').value.trim();
      return phone ? `tel:${phone}` : 'tel:+15550000000';
    }
    case 'email': {
      const addr = $('#qr-email-address').value.trim();
      const subj = encodeURIComponent($('#qr-email-subject').value.trim());
      const body = encodeURIComponent($('#qr-email-body').value.trim());
      if (!addr) return 'mailto:hello@example.com';
      return `mailto:${addr}?subject=${subj}&body=${body}`;
    }
    case 'wifi': {
      const ssid = $('#qr-wifi-ssid').value.trim() || 'MyHomeWiFi';
      const pass = $('#qr-wifi-pass').value.trim();
      const enc = $('#qr-wifi-enc').value;
      return `WIFI:S:${ssid};T:${enc};P:${pass};;`;
    }
    case 'whatsapp': {
      const phone = $('#qr-wa-phone').value.trim().replace(/\D/g, '');
      const msg = encodeURIComponent($('#qr-wa-msg').value.trim());
      if (!phone) return 'https://wa.me/15550000000';
      return `https://wa.me/${phone}?text=${msg}`;
    }
    case 'vcard': {
      const name = $('#qr-vcard-name').value.trim() || 'John Doe';
      const mobile = $('#qr-vcard-mobile').value.trim() || '+15550000000';
      const email = $('#qr-vcard-email').value.trim() || 'john@company.com';
      const org = $('#qr-vcard-org').value.trim() || 'Acme Inc.';
      return `BEGIN:VCARD\nVERSION:3.0\nN:${name}\nFN:${name}\nORG:${org}\nTEL;TYPE=CELL:${mobile}\nEMAIL:${email}\nEND:VCARD`;
    }
    case 'sms': {
      const num = $('#qr-sms-number').value.trim();
      const msg = encodeURIComponent($('#qr-sms-msg').value.trim());
      if (!num) return 'SMSTO:15550000000:';
      return `SMSTO:${num}:${msg}`;
    }
    case 'geo': {
      const lat = $('#qr-geo-lat').value.trim() || '0';
      const lng = $('#qr-geo-lng').value.trim() || '0';
      return `geo:${lat},${lng}`;
    }
    case 'event': {
      const title = $('#qr-event-title').value.trim() || 'Event';
      const start = $('#qr-event-start').value.trim();
      const end = $('#qr-event-end').value.trim();
      const loc = $('#qr-event-location').value.trim();
      const desc = $('#qr-event-desc').value.trim();
      let v = 'BEGIN:VEVENT\n';
      v += `SUMMARY:${title}\n`;
      if (start) v += `DTSTART:${start}\n`;
      if (end) v += `DTEND:${end}\n`;
      if (loc) v += `LOCATION:${loc}\n`;
      if (desc) v += `DESCRIPTION:${desc}\n`;
      v += 'END:VEVENT';
      return v;
    }
    default:
      return 'https://example.com';
  }
}

function getQROptions() {
  const fgColor = $('#qr-fg-color').value;
  const isTransparent = $('#qr-transparent-bg').checked;
  const bgColor = isTransparent ? 'transparent' : $('#qr-bg-color').value;
  const useGradient = $('#qr-gradient-toggle').checked;
  const gradientColor2 = $('#qr-grad-color2').value;
  const logoSizePct = parseInt($('#qr-logo-size-slider').value);
  const logoBgToggle = $('#qr-logo-bg-toggle').checked;

  const ecEl = document.getElementById('qr-ec-level');
  return {
    moduleStyle: qrModuleStyle,
    eyeStyle: qrEyeStyle,
    fgColor,
    bgColor,
    useGradient,
    gradientColor2,
    errorCorrectionLevel: ecEl && ecEl.value ? ecEl.value : 'H',
    logoImg: qrLogoImg,
    logoSizePct,
    logoBgToggle,
  };
}

async function updateQRPreview() {
  const container = $('#qr-preview-container');
  if (!container) return;

  const payload = getQRPayload();
  const options = getQROptions();

  try {
    const canvas = await renderQRCanvas(payload, { ...options, size: 512 });
    container.innerHTML = '';
    container.appendChild(canvas);

    const mini = document.getElementById('qr-mini-preview');
    if (mini) {
      mini.innerHTML = '';
      const img = new Image();
      img.src = canvas.toDataURL();
      mini.appendChild(img);
    }
  } catch (err) {
    console.error('Error generating QR preview:', err);
  }
}

async function downloadQR(format = 'png') {
  const payload = getQRPayload();
  const options = getQROptions();

  try {
    // Generate high-resolution 1024px canvas
    const canvas = await renderQRCanvas(payload, { ...options, size: 1024 });
    const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
    const dataUrl = canvas.toDataURL(mimeType);

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qrcode.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    console.error('Error downloading QR code:', err);
    showToast('Failed to export QR Code.');
  }
}

async function downloadQRSVG() {
  const payload = getQRPayload();
  const options = getQROptions();

  try {
    const svgContent = await renderQRSVG(payload, options);
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'qrcode.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.error('Error exporting SVG QR:', err);
    showToast('Failed to export SVG QR Code.');
  }
}

// Toast notification helper
let toastTimeout = null;
function showToast(message) {
  let toast = document.querySelector('.toast-error');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast-error';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 5000);
}

// ============================================
// Initialize All Modules
// ============================================
function init() {
  setupTabNavigation();
  setupFileConverter();
  setupIconGenerator();
  setupQRGenerator();
  setupPasteUpload();
  registerServiceWorker();
}

function setupPasteUpload() {
  window.addEventListener('paste', (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const converterActive = !document.getElementById('tab-content-converter').classList.contains('hidden');
    const iconActive = !document.getElementById('tab-content-icon').classList.contains('hidden');
    if (converterActive && !currentFile) {
      handleFile(file);
    } else if (iconActive && !iconSourceImg) {
      loadIconSourceImage(file);
    }
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

init();
