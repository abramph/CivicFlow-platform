const { initializeDatabase, getDatabase } = require("../db");

function db() {
  return getDatabase() || initializeDatabase();
}

async function getSetupStatus() {
  const row = db().prepare("SELECT setup_completed FROM organization_settings WHERE id = 1").get();
  const completed = Number(row?.setup_completed ?? 0) === 1;
  return { completed, setupCompleted: completed };
}

module.exports = {
  getSetupStatus,
};
