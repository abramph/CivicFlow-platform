const { ipcMain } = require("electron");
const { registerIpcHandlers } = require("./ipc-handlers");

const REQUIRED_CHANNELS = [
  "get-dashboard-stats",
  "organization:get",
  "db:campaigns:list",
  "db:campaigns:listActive",
  "db:categories:list",
  "reports:kpis",
  "expenditures:list",
  "db:meetings:list",
  "payments:listPendingExternal"
];

function ensureRequiredChannels() {
  REQUIRED_CHANNELS.forEach((channel) => {
    if (!ipcMain._invokeHandlers?.has(channel)) {
      ipcMain.handle(channel, async () => {
        console.warn(`Fallback handler used for ${channel}`);
        return [];
      });
    }
  });
}

// Register everything
function registerAllIpc() {
  console.log("Registering ALL IPC handlers...");
  registerIpcHandlers();
  ensureRequiredChannels();
  console.log("All IPC handlers registered");
}

module.exports = { registerAllIpc };
