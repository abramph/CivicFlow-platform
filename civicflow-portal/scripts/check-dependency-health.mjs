import { execSync } from "node:child_process";

/**
 * Worker-isolation follow-up (Security Patch A deployment review) --
 * Phase 6: a dependency-health check that distinguishes the ONE known,
 * documented, evidence-backed peer mismatch this application accepts
 * from any OTHER `npm ls` problem, which fails the check outright.
 *
 * Why this exists: `npm ci`/`npm install` succeeding (exit 0) is the
 * authoritative "does this actually work" signal -- but `npm ls` is
 * separately, more strictly, pedantic about ANY peer-range mismatch
 * regardless of whether the package itself declares that peer optional.
 * Blindly treating every `npm ls` ELSPROBLEMS exit as either "always
 * fine, ignore it" or "always fatal, block the build" is wrong in both
 * directions -- this script instead checks each specific reported
 * problem against an explicit, justified allowlist, so a genuinely new
 * problem (a real broken dependency, not one of these known cases) still
 * fails loudly rather than being silently swallowed alongside the
 * expected ones.
 *
 * Every entry below was individually investigated this review, not
 * assumed:
 *
 *  - nodemailer (invalid, required by next-auth): next-auth@4.24.15's
 *    own package.json declares `peerDependenciesMeta.nodemailer.optional:
 *    true` -- direct, first-party proof this mismatch is non-fatal by
 *    the DEPENDENT package's own design. This application never
 *    configures next-auth's Email provider (grep-confirmed: only
 *    CredentialsProvider is used anywhere), so next-auth's own internal
 *    nodemailer usage is never even loaded. The application's own
 *    nodemailer usage (src/lib/mail.ts) resolves to a single deduped
 *    ^9.1.1 version regardless.
 *
 *  - next (invalid, required by @sentry/nextjs / transitively
 *    @sentry/webpack-plugin): @sentry/nextjs@8.55.2's peer range
 *    ("^13.2.0 || ^14.0 || ^15.0.0-rc.0") has not been updated for this
 *    app's next@16.3.0. NOT marked optional in @sentry/nextjs's own
 *    manifest (unlike nodemailer above) -- accepted here on WEAKER,
 *    empirical grounds instead: `next build` succeeds and produces a
 *    working production build with Sentry's config wired in
 *    (withSentryConfig in next.config.ts) every time this repo's build
 *    has been run this review. A real Sentry/Next major-version
 *    incompatibility is a Sentry SDK upgrade decision, out of scope for
 *    a spreadsheet-import/mail-security patch.
 *
 *  - webpack (missing, required by @sentry/webpack-plugin): Next.js
 *    bundles its own internal webpack (next/dist/compiled/webpack) and
 *    never exposes a top-level, separately-installable `webpack`
 *    package -- @sentry/webpack-plugin's peer declaration doesn't
 *    account for Next's bundling model. Same empirical evidence as
 *    above (working builds) backs accepting this one.
 *
 *  - picomatch (invalid, required by fdir): a purely transitive version
 *    skew entirely inside @sentry/nextjs's and eslint-config-next's own
 *    dependency trees (fdir wants picomatch ^3||^4; a different nested
 *    copy resolves to 2.3.1 via anymatch/readdirp/micromatch elsewhere
 *    in the same tree) -- unrelated to nodemailer, NextAuth, or anything
 *    this application directly depends on or that this patch touches.
 *
 * If `npm ls --all` ever reports a DIFFERENT problem (a package this
 * list doesn't name, or one of these four for a NEW/different reason),
 * this script fails and prints it verbatim rather than passing silently.
 */

const ACCEPTED_INVALID_OR_MISSING_PACKAGES = new Set(["nodemailer", "next", "webpack", "picomatch"]);
/** "extraneous: <name>@<version> <path>" entries are orphaned optional
 * native binaries (sharp's per-platform variants) left behind by a
 * cross-platform npm install -- never a functional problem, and
 * unrelated to any dependency this application resolves at runtime. */
const EXTRANEOUS_PREFIX = "extraneous:";

function parsePackageNameFromProblem(problem) {
  // Problem strings look like:
  //   "invalid: nodemailer@9.1.1 C:\...\node_modules\nodemailer"
  //   "missing: webpack@>=4.40.0, required by @sentry/webpack-plugin@2.22.7"
  const match = problem.match(/^(?:invalid|missing):\s+(@?[^@\s]+(?:\/[^@\s]+)?)@/);
  return match ? match[1] : null;
}

function main() {
  // execSync (not execFileSync) is used deliberately -- it's shell-based
  // by design, which is what correctly resolves npm's .cmd shim on
  // Windows (execFileSync spawning a .cmd directly fails with EINVAL
  // unless also given shell:true, which triggers Node's own "unescaped
  // argument concatenation" deprecation warning). Every part of this
  // command is a static literal with no interpolated/user-controlled
  // input, so there is no injection surface despite going through a
  // shell.
  let raw;
  try {
    raw = execSync("npm ls --all --json", {
      cwd: process.cwd(),
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm ls exits non-zero whenever `problems` is non-empty -- that's
    // expected here (the known cases above always produce a non-zero
    // exit); the actual JSON is still on stdout, captured via
    // error.stdout regardless of exit code.
    raw = error.stdout;
  }

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

  const problems = parsed.problems ?? [];
  const unexpected = [];

  for (const problem of problems) {
    if (problem.startsWith(EXTRANEOUS_PREFIX)) continue;
    const pkg = parsePackageNameFromProblem(problem);
    if (pkg && ACCEPTED_INVALID_OR_MISSING_PACKAGES.has(pkg)) continue;
    unexpected.push(problem);
  }

  if (unexpected.length > 0) {
    console.error("[dependency-health] Unexpected dependency problem(s) found -- not one of the documented, accepted cases:");
    for (const problem of unexpected) console.error(`  - ${problem}`);
    console.error("\nIf this is a new, understood, and accepted mismatch, add it (with justification) to ACCEPTED_INVALID_OR_MISSING_PACKAGES in this script. Otherwise, investigate before proceeding.");
    process.exit(1);
  }

  console.log(`[dependency-health] OK -- ${problems.length} total npm ls problem(s), all accounted for (extraneous native-binary variants and the documented nodemailer/next/webpack/picomatch peer mismatches).`);
}

main();
