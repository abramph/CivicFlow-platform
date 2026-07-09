import { processRetryableSmsMessages } from "@/lib/sms-queue";

async function main() {
  const result = await processRetryableSmsMessages();
  console.log(`[sms-queue-worker] processed=${result.processed}`);
}

main()
  .catch((error) => {
    console.error("[sms-queue-worker] failed", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
