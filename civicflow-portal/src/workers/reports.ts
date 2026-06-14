import { processQueuedReportExports } from "@/lib/reports";

async function main() {
  const result = await processQueuedReportExports(50);
  console.log(`[reports-worker] processed=${result.processed}`);
}

main()
  .catch((error) => {
    console.error("[reports-worker] failed", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
