import { processMeetingIntelligenceQueue } from "@/lib/labs/meeting-intelligence/worker";

async function main() {
  const result = await processMeetingIntelligenceQueue();
  console.log(
    `[meeting-intelligence-worker] submission: processed=${result.submission.processed} submitted=${result.submission.submitted} failed=${result.submission.failed} | polling: processed=${result.polling.processed} completed=${result.polling.completed} failed=${result.polling.failed}`
  );
}

main()
  .catch((error) => {
    console.error("[meeting-intelligence-worker] failed", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
