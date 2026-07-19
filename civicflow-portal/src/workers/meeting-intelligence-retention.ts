import { runMeetingIntelligenceRetentionCleanup } from "@/lib/labs/meeting-intelligence/retention";

async function main() {
  const result = await runMeetingIntelligenceRetentionCleanup();
  console.log(`[meeting-intelligence-retention-worker] scanned=${result.scanned} deleted=${result.deleted} failed=${result.failed}`);
}

main()
  .catch((error) => {
    console.error("[meeting-intelligence-retention-worker] failed", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
