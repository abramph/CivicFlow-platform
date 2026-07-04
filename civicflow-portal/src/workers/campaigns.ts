import { processScheduledCampaigns } from "@/lib/communication-campaigns";

async function main() {
  const result = await processScheduledCampaigns(100);
  console.log(`[campaigns-worker] processed=${result.processed} sent=${result.sent} failed=${result.failed}`);
}

main()
  .catch((error) => {
    console.error("[campaigns-worker] failed", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
