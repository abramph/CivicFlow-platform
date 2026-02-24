/**
 * PDF font paths - resolves to bundled Inter font from typeface-inter.
 * Avoids Helvetica/AFM which can fail in bundled builds.
 */
const path = require('node:path');
const { app } = require('electron');

function resolveFont(relativePath) {
  // app.getAppPath() returns project root in dev, app dir when packaged
  const appPath = app?.getAppPath?.() ?? path.resolve(process.cwd());
  return path.join(appPath, 'node_modules', 'typeface-inter', relativePath);
}

/** Path to Inter Variable (regular) - TTF */
function getInterFontPath() {
  return resolveFont(path.join('Inter Variable', 'Inter.ttf'));
}

/** Path to Inter Bold - WOFF (PDFKit supports WOFF) */
function getInterBoldFontPath() {
  return resolveFont(path.join('Inter Hinted for Windows', 'Web', 'Inter-Bold.woff'));
}

module.exports = {
  getInterFontPath,
  getInterBoldFontPath,
};
