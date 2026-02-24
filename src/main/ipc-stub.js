const { ipcMain } = require('electron');
const { getDatabase } = require('./db.js');

function setupIpcHandlers() {
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');
  ipcMain.handle('test', () => 'ok');
}

function registerIpcHandlers() {
  return setupIpcHandlers();
}

module.exports = { setupIpcHandlers, registerIpcHandlers };
