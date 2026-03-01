const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");

const projectRoot = process.cwd();
const lockFile = path.join(projectRoot, ".next", "dev", "lock");
const shouldKill = process.argv.includes("--kill");

if (shouldKill && process.platform === "win32") {
  try {
    const portsToClear = [3000, 3001];
    const killed = new Set();

    for (const port of portsToClear) {
      const netstat = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: "utf8" });
      const lines = netstat
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => line.includes(`:${port}`) && line.includes("LISTENING"));

      for (const line of lines) {
        const parts = line.split(/\s+/);
        const pid = parts[parts.length - 1];
        if (!pid || killed.has(pid)) continue;
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        killed.add(pid);
      }
    }

    if (killed.size > 0) {
      console.log(`[dev:clean] Stopped process(es) on ports 3000/3001: ${Array.from(killed).join(", ")}`);
    } else {
      console.log("[dev:clean] No process listening on ports 3000/3001.");
    }
  } catch {
    console.log("[dev:clean] No process listening on ports 3000/3001.");
  }
}

try {
  fs.rmSync(lockFile, { force: true });
  console.log("[dev:clean] Cleared stale Next.js lock file (if present).");
} catch (error) {
  console.warn("[dev:clean] Could not remove lock file:", error.message);
}

const nextBin = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
const child = spawn(nextBin, ["dev"], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
