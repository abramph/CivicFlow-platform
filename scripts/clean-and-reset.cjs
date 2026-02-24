#!/usr/bin/env node
/**
 * Clean build artifacts and provide database reset instructions
 * Run with: node scripts/clean-and-reset.cjs
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const dirsToClean = [
  '.vite',
  'dist',
  'out',
  'build',
  'dist-forge',
];

console.log('🧹 Cleaning build artifacts...\n');

let cleaned = 0;
for (const dir of dirsToClean) {
  const dirPath = path.join(process.cwd(), dir);
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`✅ Deleted: ${dir}/`);
      cleaned++;
    } catch (err) {
      console.error(`❌ Failed to delete ${dir}/:`, err.message);
    }
  }
}

if (cleaned === 0) {
  console.log('ℹ️  No build artifacts found to clean.\n');
} else {
  console.log(`\n✅ Cleaned ${cleaned} build artifact directory/directories.\n`);
}

// Database location info
const appDataPath = os.platform() === 'win32' 
  ? path.join(os.homedir(), 'AppData', 'Roaming', 'Civicflow')
  : path.join(os.homedir(), '.config', 'Civicflow');

console.log('📁 Database Location Information:\n');
console.log('The SQLite database is stored at:');
console.log(`  ${appDataPath}/app.db\n`);
console.log('To reset the database:');
console.log('1. Close the CivicFlow app completely');
console.log('2. Navigate to the directory above');
console.log('3. Delete the "Civicflow" folder (or just the app.db file inside it)');
console.log('4. Restart the app - it will recreate the database with correct schema\n');

console.log('🔨 Next steps:');
console.log('1. npm install');
console.log('2. npx electron-rebuild');
console.log('3. npm run build');
console.log('4. npm run dist\n');
