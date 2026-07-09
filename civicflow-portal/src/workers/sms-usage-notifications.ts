import { notifyOrgAdminsOfSmsUsageThresholds } from "@/lib/sms-usage-notifications";

async function main() {
  const result = await notifyOrgAdminsOfSmsUsageThresholds();
  console.log(`[sms-usage-notifications-worker] notified=${result.notified}`);
}

main()
  .catch((error) => {
    console.error("[sms-usage-notifications-worker] failed", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
