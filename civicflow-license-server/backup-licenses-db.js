const fs = require("fs");
const path = require("path");

const dbPath = path.resolve(__dirname, "licenses.db");
const backupsDir = path.resolve(__dirname, "backups");

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function run() {
  if (!fs.existsSync(dbPath)) {
    console.error(`Database file not found: ${dbPath}`);
    process.exit(1);
    return;
  }

  fs.mkdirSync(backupsDir, { recursive: true });

  const fileName = `licenses-${timestamp()}.db`;
  const targetPath = path.join(backupsDir, fileName);

  fs.copyFileSync(dbPath, targetPath);

  console.log(`Backup created: ${targetPath}`);
}

run();
