import { processPendingReminderLogs } from "@/lib/reminders";

async function main() {
  const result = await processPendingReminderLogs(100);
  console.log(`[reminders-worker] processed=${result.processed}`);
}

main()
  .catch((error) => {
    console.error("[reminders-worker] failed", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
