const db = require('../db/database');
const path = require('path');

module.exports = function validateRequest(req, res, next) {
const rawKey = req.headers['x-api-key'] || req.get('x-api-key') || '';
const apiKey = String(rawKey).trim();
const dbPath = path.join(__dirname, '..', 'db', 'cloud.db');

console.log('--- AUTH DEBUG ---');
console.log('Using DB file:', dbPath);
console.log('Incoming API key:', apiKey);

const org = db.prepare(
'SELECT * FROM organizations WHERE api_key = ?'
).get(apiKey);

console.log('Org lookup result:', org);
console.log('------------------');

if (!org) {
return res.status(401).json({
success: false,
error: 'Unauthorized'
});
}

req.org = org;
next();
};
