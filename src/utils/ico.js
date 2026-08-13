/**
 * Windows ICO Binary Encoder
 * Packs multiple canvas elements into a single multi-resolution .ico file Uint8Array/Blob
 */

/**
 * Converts canvas elements (e.g. 16x16, 32x32, 48x48, 64x64, 128x128, 256x256) into a Windows ICO Uint8Array.
 * @param {HTMLCanvasElement[]} canvases - List of square canvas elements
 * @returns {Promise<Blob>} - Combined .ico Blob
 */
export async function createIcoFromCanvases(canvases) {
  const images = [];

  // Convert each canvas to PNG Uint8Array data
  for (const canvas of canvases) {
    const width = canvas.width;
    const height = canvas.height;

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    images.push({
      width: width >= 256 ? 0 : width, // 0 represents 256px in ICO specification
      height: height >= 256 ? 0 : height,
      size: data.length,
      data: data,
    });
  }

  const numImages = images.length;
  const headerSize = 6;
  const directorySize = 16 * numImages;
  
  let totalDataSize = headerSize + directorySize;
  for (const img of images) {
    totalDataSize += img.size;
  }

  const buffer = new ArrayBuffer(totalDataSize);
  const dataView = new DataView(buffer);
  const uint8View = new Uint8Array(buffer);

  // ICONDIR header
  dataView.setUint16(0, 0, true); // Reserved (0)
  dataView.setUint16(2, 1, true); // Image type (1 = ICO)
  dataView.setUint16(4, numImages, true); // Number of images

  let currentOffset = headerSize + directorySize;

  // ICONDIRENTRY directory headers
  for (let i = 0; i < numImages; i++) {
    const img = images[i];
    const entryOffset = headerSize + i * 16;

    dataView.setUint8(entryOffset + 0, img.width);
    dataView.setUint8(entryOffset + 1, img.height);
    dataView.setUint8(entryOffset + 2, 0); // Color count (0 = >256 colors)
    dataView.setUint8(entryOffset + 3, 0); // Reserved
    dataView.setUint16(entryOffset + 4, 1, true); // Color planes (1)
    dataView.setUint16(entryOffset + 6, 32, true); // Bits per pixel (32)
    dataView.setUint32(entryOffset + 8, img.size, true); // Size of PNG data in bytes
    dataView.setUint32(entryOffset + 12, currentOffset, true); // Offset of PNG data

    // Copy PNG data bytes
    uint8View.set(img.data, currentOffset);
    currentOffset += img.size;
  }

  return new Blob([buffer], { type: 'image/x-icon' });
}
