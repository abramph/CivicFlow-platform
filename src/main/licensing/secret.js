const crypto = require('node:crypto');

// Single source of truth for the 16-part secret salt.
const SALT_PARTS = [
  '4HXQ-D5Q3-6459-VM7N',
  'DDB9-LNC9-TBFD-KSYG',
  'US6X-W4YY-KFDN-YZEW',
  'W23C-VYJJ-X9HU-6F6E',
  'J44N-KT3F-RXV4-RUBE',
  'PXBK-H5L9-KQVD-5R9S',
  'LZLR-WFK7-KN4F-P6PG',
  'S2RD-PPND-VM2E-G9UG',
  'FJ3G-HSKL-QQRF-7DKD',
  'U9BH-D354-5NSF-3L5C',
  'BWJ4-QHUE-2YBS-X53L',
  '857X-AELN-MG5B-SA7X',
  'GRF8-YENC-VCBE-F9ZT',
  'EXCH-SDCC-KHDN-3Q82',
  'LGKS-LWTH-CBZ9-M4W7',
  'FKBW-MV2E-8N2M-DHYS',
];

function deriveSecret() {
  return crypto.createHash('sha256').update(SALT_PARTS.join('|'), 'utf8').digest('hex');
}

module.exports = {
  SALT_PARTS,
  deriveSecret,
};
