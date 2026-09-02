import { execSync } from "node:child_process";

/**
 * Worker-isolation follow-up (Security Patch A deployment review) --
 * Phase 6: a dependency-health check that distinguishes the documented,
 * evidence-backed peer mismatches this application accepts from any
 * OTHER `npm ls` problem, which fails the check outright.
 *
 * Why this exists: `npm ci`/`npm install` succeeding (exit 0) is the
 * authoritative "does this actually work" signal -- but `npm ls` is
 * separately, more strictly, pedantic about ANY peer-range mismatch
 * regardless of whether the package itself declares that peer optional.
 * Blindly treating every `npm ls` ELSPROBLEMS exit as either "always
 * fine, ignore it" or "always fatal, block the build" is wrong in both
 * directions.
 *
 * Deployment-review follow-up -- tightened from an earlier, looser
 * version of this script that matched on PACKAGE NAME alone (e.g. any
 * "invalid: nodemailer@..." problem, regardless of version or which
 * peer range it violated). That is too broad: a nodemailer major bump,
 * or next-auth tightening its own peer range further, would have
 * matched and passed silently instead of failing. Every baseline entry
 * below now requires an EXACT match on package name, installed
 * version, and the specific expected-range/required-by string `npm ls`
 * reports -- read directly from `npm ls --all --json`'s per-dependency
 * `invalid`/`problems` fields (not just the top-level `problems` array,
 * which doesn't carry the expected-range detail on its own). If ANY of
 * those three things drift -- a version change on either side, or a
 * different peer requirement -- the match fails and the new state is
 * reported as unexpected, not silently absorbed.
 *
 * Every entry below was individually investigated this review, not
 * assumed. See BASELINE_INVALID/BASELINE_MISSING below for exact
 * values and per-entry justification/optionality.
 */

/** "extraneous: <name>@<version> <path>" entries are orphaned optional
 * native binaries (sharp's per-platform variants) left behind by a
 * cross-platform npm install -- never a functional problem, and
 * unrelated to any dependency this application resolves at runtime.
 * These are accepted by prefix, not by exact match, since the specific
 * set of orphaned platform variants can legitimately vary by install
 * environment without indicating any real problem. */
const EXTRANEOUS_PREFIX = "extraneous:";

/**
 * Exact baseline for "invalid: <name>@<version> <path>" problems.
 * `expected` must match the `invalid` field npm ls reports on that
 * dependency node EXACTLY (e.g. `"^7.0.7" from node_modules/next-auth`).
 */
const BASELINE_INVALID = [
  {
    name: "nodemailer",
    version: "9.1.1",
    expected: '"^7.0.7" from node_modules/next-auth',
    optional: true,
    justification:
      "next-auth@4.24.15's own package.json declares peerDependenciesMeta.nodemailer.optional:true -- direct, " +
      "first-party proof this is non-fatal by the DEPENDENT package's own design. This app never configures " +
      "next-auth's Email provider (only CredentialsProvider is used anywhere), so next-auth's internal nodemailer " +
      "usage is never loaded. The app's own nodemailer usage (src/lib/mail.ts) resolves to a single deduped ^9.1.1.",
  },
  {
    name: "next",
    version: "16.3.0",
    expected: '"^13.2.0 || ^14.0 || ^15.0.0-rc.0" from node_modules/@sentry/nextjs',
    optional: false,
    justification:
      "@sentry/nextjs@8.55.2's peer range has not been updated for this app's next@16.3.0. NOT marked optional -- " +
      "accepted on weaker, empirical grounds instead: `next build` succeeds and produces a working production " +
      "build with Sentry's config wired in (withSentryConfig in next.config.ts) on every build this review. A " +
      "real incompatibility is a Sentry SDK upgrade decision, out of scope for this patch.",
  },
  {
    name: "picomatch",
    version: "2.3.1",
    expected: '"^3 || ^4" from node_modules/fdir',
    optional: false,
    justification:
      "Purely transitive version skew entirely inside @sentry/nextjs's and eslint-config-next's own dependency " +
      "trees (fdir wants picomatch ^3||^4; a different nested copy resolves to 2.3.1 via anymatch/readdirp/" +
      "micromatch elsewhere in the same tree) -- unrelated to nodemailer, NextAuth, or anything this application " +
      "directly depends on or that this patch touches. Not marked optional; accepted empirically (same as next).",
  },
];

/**
 * Exact baseline for "missing: <name>@<range>, required by <pkg>@<v>"
 * problems (no installed version exists at all for these).
 */
const BASELINE_MISSING = [
  {
    name: "webpack",
    requiredRange: ">=4.40.0",
    requiredBy: "@sentry/webpack-plugin@2.22.7",
    optional: false,
    justification:
      "Next.js bundles its own internal webpack (next/dist/compiled/webpack) and never exposes a top-level, " +
      "separately-installable `webpack` package -- @sentry/webpack-plugin's peer declaration doesn't account for " +
      "Next's bundling model. Accepted on the same empirical grounds as next/picomatch above.",
  },
];

function runNpmLsAllJson() {
  // execSync (not execFileSync) is used deliberately -- it's shell-based
  // by design, which is what correctly resolves npm's .cmd shim on
  // Windows (execFileSync spawning a .cmd directly fails with EINVAL
  // unless also given shell:true, which triggers Node's own "unescaped
  // argument concatenation" deprecation warning). Every part of this
  // command is a static literal with no interpolated/user-controlled
  // input, so there is no injection surface despite going through a
  // shell.
  try {
    return execSync("npm ls --all --json", {
      cwd: process.cwd(),
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm ls exits non-zero whenever `problems` is non-empty -- expected
    // here; the JSON is still on stdout, captured via error.stdout
    // regardless of exit code.
    return error.stdout;
  }
}

/** Walks the dependency tree collecting every node that reports an
 * `invalid` or `missing`/`peerMissing` condition, alongside its exact
 * version and the exact expected-range string npm attached to it --
 * this is the detail the top-level `problems` array alone doesn't
 * carry, and what makes exact (not just name-based) matching possible. */
function collectDependencyProblems(root) {
  const invalidFindings = [];
  const missingFindings = [];

  function walk(node) {
    for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
      if (dep.invalid) {
        invalidFindings.push({ name, version: dep.version, expected: dep.invalid });
      }
      if (Array.isArray(dep.problems)) {
        for (const problem of dep.problems) {
          const missingMatch = problem.match(/^missing:\s+(@?\S+)@(\S+),\s+required by\s+(\S+)$/);
          if (missingMatch) {
            missingFindings.push({ name: missingMatch[1], requiredRange: missingMatch[2], requiredBy: missingMatch[3] });
          }
        }
      }
      if (dep.dependencies) walk(dep);
    }
  }
  walk(root);
  return { invalidFindings, missingFindings };
}

function findBaselineMatch(baseline, finding, keys) {
  return baseline.find((entry) => keys.every((key) => entry[key] === finding[key]));
}

function main() {
  const raw = runNpmLsAllJson();
  if (!raw) {
    console.error("[dependency-health] npm ls produced no output to check.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[dependency-health] Could not parse `npm ls --all --json` output.");
    process.exit(1);
  }

  const topLevelProblems = parsed.problems ?? [];
  const extraneousCount = topLevelProblems.filter((p) => p.startsWith(EXTRANEOUS_PREFIX)).length;

  const { invalidFindings, missingFindings } = collectDependencyProblems(parsed);

  const unexpectedInvalid = invalidFindings.filter((f) => !findBaselineMatch(BASELINE_INVALID, f, ["name", "version", "expected"]));
  const unexpectedMissing = missingFindings.filter((f) => !findBaselineMatch(BASELINE_MISSING, f, ["name", "requiredRange", "requiredBy"]));

  if (unexpectedInvalid.length > 0 || unexpectedMissing.length > 0) {
    console.error("[dependency-health] Unexpected dependency problem(s) -- not an EXACT match to any documented, accepted baseline entry:");
    for (const f of unexpectedInvalid) console.error(`  - invalid: ${f.name}@${f.version} (expected ${f.expected})`);
    for (const f of unexpectedMissing) console.error(`  - missing: ${f.name}@${f.requiredRange}, required by ${f.requiredBy}`);
    console.error(
      "\nA version bump, a changed peer range, or a genuinely new problem all land here -- this is not a false " +
      "positive to silence by loosening the match. If this specific new state has been individually investigated " +
      "and is understood to be safe, add it as a new exact baseline entry (with justification) in this script. " +
      "Otherwise, investigate before proceeding."
    );
    process.exit(1);
  }

  console.log(`[dependency-health] OK -- ${extraneousCount} extraneous native-binary variant(s), and the following documented baseline mismatches, each exact-matched (package + version + expected range/required-by):`);
  for (const entry of BASELINE_INVALID) {
    const seen = invalidFindings.some((f) => f.name === entry.name && f.version === entry.version && f.expected === entry.expected);
    console.log(`  - ${seen ? "present" : "not present this run"}: invalid ${entry.name}@${entry.version} (expected ${entry.expected}) -- optional=${entry.optional}`);
  }
  for (const entry of BASELINE_MISSING) {
    const seen = missingFindings.some((f) => f.name === entry.name && f.requiredRange === entry.requiredRange && f.requiredBy === entry.requiredBy);
    console.log(`  - ${seen ? "present" : "not present this run"}: missing ${entry.name}@${entry.requiredRange}, required by ${entry.requiredBy} -- optional=${entry.optional}`);
  }
}

main();
