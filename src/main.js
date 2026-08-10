/**
 * FileForge — Main Application
 * Orchestrates UI interactions and dispatches to converters
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

// ============================
// DOM References
// ============================
const $ = (sel) => document.querySelector(sel);

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

// ============================
// State
// ============================
let currentFile = null;
let convertedBlob = null;
let convertedFileName = '';

// ============================
// Initialize
// ============================
function init() {
  // Set accepted file types
  fileInput.setAttribute('accept', getSupportedAccept());

  // Bind events
  bindUploadEvents();
  bindConversionEvents();
  bindDownloadEvents();

  // Remove default Vite counter.js and style
  removeDefaultViteFiles();
}

function removeDefaultViteFiles() {
  // Nothing needed, we've overwritten the files
}

// ============================
// Upload Handling
// ============================
function bindUploadEvents() {
  // Click to upload
  fileInput.addEventListener('change', handleFileSelect);

  // Drag & drop
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

  // Remove file
  btnRemove.addEventListener('click', resetToUpload);
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

  // Update UI
  const category = CATEGORIES[info.category];
  fileTypeIcon.textContent = category.icon;
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatFileSize(file.size)} · ${category.label}`;

  // Populate output format dropdown
  populateOutputFormats(info.outputs, ext);

  // Show/hide quality slider
  if (info.qualityAdjustable) {
    qualityGroup.classList.remove('hidden');
  } else {
    qualityGroup.classList.add('hidden');
  }

  // Show conversion panel, hide upload zone
  uploadZone.style.display = 'none';
  conversionPanel.classList.remove('hidden');

  // Reset conversion state
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

  // Auto-select first option if there's only one
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
  qualitySlider.value = 90;
  qualityValue.textContent = '90';
}

// ============================
// Conversion Handling
// ============================
function bindConversionEvents() {
  outputFormat.addEventListener('change', () => {
    updateConvertButton();
    updateQualityVisibility();
  });

  qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = qualitySlider.value;
  });

  btnConvert.addEventListener('click', startConversion);
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
  // Show quality for JPG and WebP output
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

  // Lock UI
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
        blob = await convertImage(currentFile, targetExt, { quality, onProgress });
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

    // Success!
    convertedBlob = blob;
    const baseName = currentFile.name.replace(/\.[^.]+$/, '');
    convertedFileName = `${baseName}.${targetExt}`;

    downloadMeta.textContent = `${convertedFileName} · ${formatFileSize(blob.size)}`;
    showDownload();
  } catch (err) {
    console.error('Conversion error:', err);
    showToast(err.message || 'Conversion failed. Please try again.');
    hideProgress();
  } finally {
    // Unlock UI
    btnText.classList.remove('hidden');
    btnLoader.classList.add('hidden');
    updateConvertButton();
  }
}

// ============================
// Download Handling
// ============================
function bindDownloadEvents() {
  btnDownload.addEventListener('click', downloadFile);
  btnConvertAnother.addEventListener('click', resetToUpload);
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

  // Revoke after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ============================
// UI Helpers
// ============================
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

// Toast notification
let toastTimeout = null;
function showToast(message) {
  // Remove existing toast
  let toast = document.querySelector('.toast-error');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast-error';
    document.body.appendChild(toast);
  }

  toast.textContent = message;

  // Force reflow for animation restart
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 5000);
}

// ============================
// Start the app
// ============================
init();
