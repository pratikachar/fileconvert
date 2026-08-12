/**
 * Format Registry — Maps file extensions to categories, output formats, and converters
 */

// Category definitions with icons
export const CATEGORIES = {
  image: { label: 'Image', icon: '🖼️' },
  audio: { label: 'Audio', icon: '🎵' },
  video: { label: 'Video', icon: '🎬' },
  document: { label: 'Document', icon: '📄' },
};

/**
 * Registry of supported input formats.
 * Each key is a file extension (without dot).
 * - category: which converter group to use
 * - mimeType: the MIME type for the format
 * - outputs: array of possible output extensions
 * - qualityAdjustable: whether a quality slider should be shown
 */
export const FORMAT_REGISTRY = {
  // --- Images (Canvas API) ---
  png:  { category: 'image', mimeType: 'image/png',  outputs: ['jpg', 'jpeg', 'webp'], qualityAdjustable: false },
  jpg:  { category: 'image', mimeType: 'image/jpeg', outputs: ['png', 'webp'], qualityAdjustable: true },
  jpeg: { category: 'image', mimeType: 'image/jpeg', outputs: ['png', 'webp'], qualityAdjustable: true },
  webp: { category: 'image', mimeType: 'image/webp', outputs: ['png', 'jpg', 'jpeg'], qualityAdjustable: true },
  bmp:  { category: 'image', mimeType: 'image/bmp',  outputs: ['png', 'jpg', 'jpeg', 'webp'], qualityAdjustable: false },
  gif:  { category: 'image', mimeType: 'image/gif',  outputs: ['png', 'jpg', 'jpeg', 'webp'], qualityAdjustable: false },
  svg:  { category: 'image', mimeType: 'image/svg+xml', outputs: ['png', 'jpg', 'jpeg', 'webp'], qualityAdjustable: false },
  ico:  { category: 'image', mimeType: 'image/x-icon', outputs: ['png', 'jpg', 'jpeg', 'webp'], qualityAdjustable: false },
  tiff: { category: 'image', mimeType: 'image/tiff', outputs: ['png', 'jpg', 'jpeg', 'webp'], qualityAdjustable: false },
  tif:  { category: 'image', mimeType: 'image/tiff', outputs: ['png', 'jpg', 'jpeg', 'webp'], qualityAdjustable: false },

  // --- Audio (FFmpeg.wasm) ---
  mp3:  { category: 'audio', mimeType: 'audio/mpeg',    outputs: ['wav', 'ogg', 'aac', 'flac', 'opus'], qualityAdjustable: false },
  wav:  { category: 'audio', mimeType: 'audio/wav',     outputs: ['mp3', 'ogg', 'aac', 'flac', 'opus'], qualityAdjustable: false },
  ogg:  { category: 'audio', mimeType: 'audio/ogg',     outputs: ['mp3', 'wav', 'aac', 'flac', 'opus'], qualityAdjustable: false },
  aac:  { category: 'audio', mimeType: 'audio/aac',     outputs: ['mp3', 'wav', 'ogg', 'flac', 'opus'], qualityAdjustable: false },
  flac: { category: 'audio', mimeType: 'audio/flac',    outputs: ['mp3', 'wav', 'ogg', 'aac', 'opus'], qualityAdjustable: false },
  m4a:  { category: 'audio', mimeType: 'audio/mp4',     outputs: ['mp3', 'wav', 'ogg', 'aac', 'flac', 'opus'], qualityAdjustable: false },
  wma:  { category: 'audio', mimeType: 'audio/x-ms-wma', outputs: ['mp3', 'wav', 'ogg', 'aac', 'flac', 'opus'], qualityAdjustable: false },

  // --- Video (FFmpeg.wasm) ---
  mp4:  { category: 'video', mimeType: 'video/mp4',     outputs: ['webm', 'avi', 'mkv', 'gif'], qualityAdjustable: false },
  webm: { category: 'video', mimeType: 'video/webm',    outputs: ['mp4', 'avi', 'mkv', 'gif'], qualityAdjustable: false },
  avi:  { category: 'video', mimeType: 'video/x-msvideo', outputs: ['mp4', 'webm', 'mkv', 'gif'], qualityAdjustable: false },
  mkv:  { category: 'video', mimeType: 'video/x-matroska', outputs: ['mp4', 'webm', 'avi', 'gif'], qualityAdjustable: false },
  mov:  { category: 'video', mimeType: 'video/quicktime', outputs: ['mp4', 'webm', 'avi', 'mkv', 'gif'], qualityAdjustable: false },
  flv:  { category: 'video', mimeType: 'video/x-flv',   outputs: ['mp4', 'webm', 'avi', 'mkv', 'gif'], qualityAdjustable: false },

  // --- Documents (Pure JS) ---
  csv:  { category: 'document', mimeType: 'text/csv',        outputs: ['json', 'yaml', 'xml', 'txt'], qualityAdjustable: false },
  json: { category: 'document', mimeType: 'application/json', outputs: ['csv', 'yaml', 'xml', 'txt'], qualityAdjustable: false },
  yaml: { category: 'document', mimeType: 'text/yaml',       outputs: ['json', 'csv', 'xml', 'txt'], qualityAdjustable: false },
  yml:  { category: 'document', mimeType: 'text/yaml',       outputs: ['json', 'csv', 'xml', 'txt'], qualityAdjustable: false },
  xml:  { category: 'document', mimeType: 'text/xml',        outputs: ['json', 'csv', 'yaml', 'txt'], qualityAdjustable: false },
  md:   { category: 'document', mimeType: 'text/markdown',   outputs: ['html', 'txt'], qualityAdjustable: false },
  txt:  { category: 'document', mimeType: 'text/plain',      outputs: ['csv', 'json'], qualityAdjustable: false },
};

/**
 * Get the output MIME type for a given extension
 */
export const OUTPUT_MIME_TYPES = {
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/opus',
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  // Documents
  csv: 'text/csv',
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  xml: 'text/xml',
  html: 'text/html',
  txt: 'text/plain',
};

/**
 * Get file extension from filename
 */
export function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

/**
 * Get format info from extension
 */
export function getFormatInfo(ext) {
  return FORMAT_REGISTRY[ext] || null;
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Get all supported input extensions as a comma-separated list for file input accept
 */
export function getSupportedAccept() {
  return Object.keys(FORMAT_REGISTRY)
    .map((ext) => '.' + ext)
    .join(',');
}
