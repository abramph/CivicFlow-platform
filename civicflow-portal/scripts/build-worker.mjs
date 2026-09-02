import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Worker-isolation follow-up (Security Patch A deployment review).
 *
 * Compiles the spreadsheet-parsing worker (spreadsheet-parser.ts +
 * spreadsheet-parser-worker-entry.ts) to plain CommonJS under
 * dist-workers/, using a dedicated tsconfig.worker.json scoped to just
 * those two files.
 *
 * Why a separate compile step rather than relying on Next.js's own
 * build: `next build`'s webpack bundling only knows about files reached
 * through static `import`/`require` graphs it can trace from the app's
 * pages/routes. A worker_threads Worker is instantiated with a runtime
 * file-path string (`new Worker(path)`), which is invisible to that
 * trace -- Next has no reason to emit or bundle a file only ever
 * referenced that way. This step exists specifically so the worker
 * script is a real, demonstrated build artifact on disk before
 * spreadsheet-parser-worker-client.ts ever tries to load it, rather than
 * assuming a source .ts file happens to be loadable at runtime.
 *
 * `exceljs` (spreadsheet-parser.ts's only external dependency) is
 * deliberately left as a plain `require("exceljs")` in the compiled
 * output, NOT bundled -- this repo does not use Next's `output:
 * "standalone"` mode, so the full node_modules tree (exceljs included,
 * a real `dependencies` entry) is present alongside the running server
 * in production regardless; there is no reason to duplicate it into a
 * second bundled copy.
 *
 * This script must run as part of `npm run build`, before `next build`,
 * so the compiled artifact exists by the time the production server
 * starts (see spreadsheet-parser-worker-client.ts's resolveWorkerScript
 * for the runtime path-resolution logic that depends on this).
 */

const projectRoot = process.cwd();
// Invoke TypeScript's own JS entry point via `node`, not the .bin/tsc.cmd
// shim -- execFileSync spawning a Windows .cmd file directly requires a
// shell (EINVAL otherwise), and going through `node` + the real script
// path avoids that platform difference entirely.
const tscScript = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");
const tsconfigPath = path.join(projectRoot, "tsconfig.worker.json");
const expectedArtifact = path.join(projectRoot, "dist-workers", "spreadsheet-parser-worker-entry.js");

if (!existsSync(tsconfigPath)) {
  console.error("[build-worker] tsconfig.worker.json not found -- cannot compile the isolated parser worker.");
  process.exit(1);
}
if (!existsSync(tscScript)) {
  console.error(`[build-worker] TypeScript compiler not found at ${tscScript}.`);
  process.exit(1);
}

try {
  execFileSync(process.execPath, [tscScript, "-p", tsconfigPath], { stdio: "inherit", cwd: projectRoot });
} catch (error) {
  console.error("[build-worker] Worker compile failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!existsSync(expectedArtifact)) {
  console.error(`[build-worker] Compile reported success but the expected artifact is missing: ${expectedArtifact}`);
  process.exit(1);
}

console.log(`[build-worker] Compiled isolated spreadsheet-parser worker -> ${path.relative(projectRoot, expectedArtifact)}`);
