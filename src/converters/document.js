/**
 * Document Converter - Pure JavaScript data format conversions
 * Supports: CSV, JSON, YAML, XML, Markdown, TXT
 */

import yaml from 'js-yaml';
import { marked } from 'marked';
import { OUTPUT_MIME_TYPES } from './registry.js';

/**
 * Convert a document/data file to another format
 * @param {File} file - The input document file
 * @param {string} outputExt - Target format extension
 * @param {object} options - Conversion options
 * @param {function} options.onProgress - Progress callback (0-100, message)
 * @returns {Promise<Blob>} - Converted document blob
 */
export async function convertDocument(file, outputExt, options = {}) {
  const { onProgress = () => {} } = options;
  const inputExt = file.name.split('.').pop().toLowerCase();

  onProgress(10, 'Reading file...');
  const text = await file.text();

  onProgress(30, 'Parsing input...');

  // Parse input to an intermediate data structure
  let data;
  try {
    data = parseInput(text, inputExt);
  } catch (err) {
    throw new Error(`Failed to parse ${inputExt.toUpperCase()} input: ${err.message}`);
  }

  onProgress(60, 'Converting to ' + outputExt.toUpperCase() + '...');

  // Convert to output format
  let output;
  try {
    output = formatOutput(data, outputExt, text, inputExt);
  } catch (err) {
    throw new Error(`Failed to convert to ${outputExt.toUpperCase()}: ${err.message}`);
  }

  onProgress(90, 'Finalizing...');

  const mimeType = OUTPUT_MIME_TYPES[outputExt] || 'text/plain';
  const blob = new Blob([output], { type: mimeType });

  onProgress(100, 'Done!');
  return blob;
}

// ============================
// Input Parsers
// ============================

function parseInput(text, ext) {
  switch (ext) {
    case 'csv':
      return parseCSV(text);
    case 'json':
      return JSON.parse(text);
    case 'yaml':
    case 'yml':
      return yaml.load(text);
    case 'xml':
      return parseXML(text);
    case 'md':
      return { __markdown: text };
    case 'txt':
      return { __rawText: text };
    default:
      throw new Error(`Unsupported input format: ${ext}`);
  }
}

// ============================
// Output Formatters
// ============================

function formatOutput(data, outputExt, originalText, inputExt) {
  switch (outputExt) {
    case 'json':
      return formatToJSON(data);
    case 'csv':
      return formatToCSV(data);
    case 'yaml':
    case 'yml':
      return formatToYAML(data);
    case 'xml':
      return formatToXML(data);
    case 'html':
      return formatToHTML(data, originalText, inputExt);
    case 'txt':
      return formatToTXT(data, originalText, inputExt);
    default:
      throw new Error(`Unsupported output format: ${outputExt}`);
  }
}

// ============================
// CSV Parser & Formatter
// ============================

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header.trim()] = values[idx]?.trim() ?? '';
    });
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function formatToCSV(data) {
  if (data.__rawText) {
    // TXT to CSV: each line becomes a row with a single "content" column
    const lines = data.__rawText.split('\n');
    return 'content\n' + lines.map((line) => escapeCSV(line)).join('\n');
  }

  // Ensure data is an array of objects
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length === 0) return '';

  // Get all unique keys as headers
  const headers = [...new Set(arr.flatMap((obj) => Object.keys(flattenObject(obj))))];

  const headerLine = headers.map(escapeCSV).join(',');
  const rows = arr.map((item) => {
    const flat = flattenObject(item);
    return headers.map((h) => escapeCSV(String(flat[h] ?? ''))).join(',');
  });

  return [headerLine, ...rows].join('\n');
}

function escapeCSV(value) {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function flattenObject(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = Array.isArray(value) ? JSON.stringify(value) : value;
    }
  }
  return result;
}

// ============================
// JSON Formatter
// ============================

function formatToJSON(data) {
  if (data.__rawText) return JSON.stringify({ content: data.__rawText }, null, 2);
  if (data.__markdown) return JSON.stringify({ content: data.__markdown }, null, 2);
  return JSON.stringify(data, null, 2);
}

// ============================
// YAML Formatter
// ============================

function formatToYAML(data) {
  if (data.__rawText) return yaml.dump({ content: data.__rawText });
  if (data.__markdown) return yaml.dump({ content: data.__markdown });
  return yaml.dump(data, { lineWidth: -1 });
}

// ============================
// XML Parser & Formatter
// ============================

function parseXML(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');

  // Check for parse errors
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) {
    throw new Error('Invalid XML: ' + errorNode.textContent.substring(0, 100));
  }

  return xmlNodeToObj(doc.documentElement);
}

function xmlNodeToObj(node) {
  // Text-only node
  if (node.childNodes.length === 1 && node.childNodes[0].nodeType === 3) {
    const val = node.textContent.trim();
    // Try to parse as number/boolean
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val !== '' && !isNaN(val)) return Number(val);
    return val;
  }

  const obj = {};

  // Attributes
  for (const attr of node.attributes || []) {
    obj['@' + attr.name] = attr.value;
  }

  // Child elements
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue; // Element nodes only
    const name = child.nodeName;
    const value = xmlNodeToObj(child);

    if (obj[name] !== undefined) {
      // Multiple children with same name → array
      if (!Array.isArray(obj[name])) obj[name] = [obj[name]];
      obj[name].push(value);
    } else {
      obj[name] = value;
    }
  }

  // If only text content
  if (Object.keys(obj).length === 0) {
    return node.textContent.trim();
  }

  return obj;
}

function formatToXML(data, rootName = 'root') {
  if (data.__rawText) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <content>${escapeXML(data.__rawText)}</content>\n</root>`;
  }
  if (data.__markdown) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <content>${escapeXML(data.__markdown)}</content>\n</root>`;
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';

  if (Array.isArray(data)) {
    xml += `<${rootName}>\n`;
    data.forEach((item) => {
      xml += objToXML(item, 'item', 1);
    });
    xml += `</${rootName}>`;
  } else if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 1) {
      xml += objToXML(data[keys[0]], keys[0], 0);
    } else {
      xml += `<${rootName}>\n`;
      for (const [key, value] of Object.entries(data)) {
        xml += objToXML(value, sanitizeXMLTag(key), 1);
      }
      xml += `</${rootName}>`;
    }
  } else {
    xml += `<${rootName}>${escapeXML(String(data))}</${rootName}>`;
  }

  return xml;
}

function objToXML(value, tag, indent) {
  const pad = '  '.repeat(indent);

  if (value === null || value === undefined) {
    return `${pad}<${tag}/>\n`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => objToXML(item, tag, indent)).join('');
  }

  if (typeof value === 'object') {
    let xml = `${pad}<${tag}>\n`;
    for (const [key, val] of Object.entries(value)) {
      xml += objToXML(val, sanitizeXMLTag(key), indent + 1);
    }
    xml += `${pad}</${tag}>\n`;
    return xml;
  }

  return `${pad}<${tag}>${escapeXML(String(value))}</${tag}>\n`;
}

function escapeXML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeXMLTag(name) {
  // Remove characters invalid in XML tag names
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^[^a-zA-Z_]/, '_');
}

// ============================
// HTML Formatter (from Markdown)
// ============================

function formatToHTML(data, originalText, inputExt) {
  if (data.__markdown || inputExt === 'md') {
    const content = data.__markdown || originalText;
    const htmlBody = marked(content);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Converted Document</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.7; color: #1a1a2e; }
    h1, h2, h3 { margin-top: 1.5em; }
    code { background: #f0f0f5; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #f0f0f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #a855f7; margin-left: 0; padding-left: 16px; color: #555; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f0f0f5; }
    img { max-width: 100%; }
    a { color: #a855f7; }
  </style>
</head>
<body>
${htmlBody}
</body>
</html>`;
  }

  // For other data types, create a simple HTML table/representation
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Converted Data</title>
  <style>body { font-family: sans-serif; padding: 20px; }</style>
</head>
<body>
<pre>${escapeXML(JSON.stringify(data, null, 2))}</pre>
</body>
</html>`;
}

// ============================
// TXT Formatter
// ============================

function formatToTXT(data, originalText, inputExt) {
  if (data.__rawText) return data.__rawText;
  if (data.__markdown) return data.__markdown;

  // For structured data, create a readable text representation
  if (Array.isArray(data)) {
    if (data.length === 0) return '(empty)';

    // Table-like text output for arrays of objects
    if (typeof data[0] === 'object') {
      const headers = Object.keys(data[0]);
      let output = headers.join('\t') + '\n';
      output += data.map((row) => headers.map((h) => String(row[h] ?? '')).join('\t')).join('\n');
      return output;
    }

    return data.join('\n');
  }

  if (typeof data === 'object') {
    return JSON.stringify(data, null, 2);
  }

  return String(data);
}
