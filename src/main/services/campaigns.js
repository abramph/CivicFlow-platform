const { initializeDatabase, getDatabase } = require("../db");

function db() {
  return getDatabase() || initializeDatabase();
}

async function listCampaigns() {
  return db().prepare("SELECT * FROM campaigns ORDER BY COALESCE(start_date, created_at) DESC, id DESC").all();
}

async function createCampaign(campaign = {}) {
  const result = db()
    .prepare("INSERT INTO campaigns (name, start_date, end_date, notes, goal_amount_cents) VALUES (?, ?, ?, ?, ?)")
    .run(
      campaign.name ?? "",
      campaign.start_date ?? null,
      campaign.end_date ?? null,
      campaign.notes ?? null,
      Number(campaign.goal_amount_cents ?? 0)
    );

  return result.lastInsertRowid;
}

async function deleteCampaign(id) {
  return db().prepare("DELETE FROM campaigns WHERE id = ?").run(id).changes > 0;
}

module.exports = {
  listCampaigns,
  createCampaign,
  deleteCampaign,
};
