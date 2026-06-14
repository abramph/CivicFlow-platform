import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const staleDevDir = path.join(projectRoot, ".next", "dev");

try {
  fs.rmSync(staleDevDir, { recursive: true, force: true });
  console.log("[prebuild-clean] Removed stale .next/dev artifacts.");
} catch (error) {
  console.warn("[prebuild-clean] Could not remove .next/dev:", error instanceof Error ? error.message : String(error));
}
