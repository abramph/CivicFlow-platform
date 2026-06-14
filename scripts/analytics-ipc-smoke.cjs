const { app, ipcMain } = require('electron');
const { initializeDatabase } = require('../src/main/db');
const { registerIpcHandlers } = require('../src/main/ipc-handlers');

async function run() {
  await app.whenReady();
  initializeDatabase();
  registerIpcHandlers();

  const handler = ipcMain._invokeHandlers?.get('analytics:getSummary');
  if (typeof handler !== 'function') {
    throw new Error('analytics:getSummary handler is not registered');
  }

  const result = await handler({});
  console.log(JSON.stringify(result, null, 2));
  await app.quit();
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
