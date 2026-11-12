// Today's CI for both versions. No installed dependencies: changes and field can
// decide what to run before pnpm setup or cache restoration.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @typedef {{check: boolean, typecheck: boolean, test: boolean, next: boolean, e2e: boolean, field: boolean}} Flags */
/** @typedef {(args: string[]) => {status: number | null, stdout: string}} Runner */
const all = { check: true, typecheck: true, test: true, next: true, e2e: true, field: true };
const today = ["apps/", "programs/", "packs/", "wip/", "legacy/", "packages/"];
const helper = "next/apps/fabrika/src/exam/plant.ts";
const commits = "next/apps/fabrika/src/exam/commits.ts";
/**
 * Field rows: a direct `.jsonl` file, or anything in a log's folder, where each new row is its own
 * file (decision 0090). field-check.ts names and checks them; a misnamed file fails there.
 * @param {string} path
 */
const rows = (path) => /^field\/[^/]+\.jsonl$/.test(path) || /^field\/(?:notes|runs|findings)\//.test(path);
const readTrees = ["programs/", "fixtures/", "packages/", "next/"];
const skillTrees = [".agents/skills/", ".claude/skills/"];
/** @param {string} path */
const script = (path) => /^\.agents\/skills\/[^/]+\/scripts\//.test(path);

/** Skill prose is checked in the changes job on every event. @param {string} path */
const prose = (path) =>
  (path.startsWith(".agents/skills/") && path.endsWith(".md") && !script(path)) ||
  /^\.claude\/skills\/[^/]+$/.test(path);

const readFolders = new Set(["brief", "briefs", "prompt", "prompts"]);

/**
 * Markdown a program or test reads: briefs, prompts and fixtures are inputs.
 * @param {string} path
 */
const reads = (path) =>
  path.endsWith(".md") &&
  (readTrees.some((tree) => path.startsWith(tree)) ||
    path
      .split("/")
      .slice(0, -1)
      .some((dir) => readFolders.has(dir)));

/** @param {string} path */
const markdown = (path) => path.endsWith(".md") && !reads(path) && !skillTrees.some((tree) => path.startsWith(tree));

/** @param {string} path */
const safe = (path) => rows(path) || markdown(path);

/** @param {string} path */
const old = (path) => today.some((tree) => path.startsWith(tree)) && !path.startsWith("packages/fabrika-design/");

/**
 * A PR skips a job only when every path is explicitly safe for that job.
 * Amendment 3: field's runner starts on every event; this flag gates its install
 * and row check, so Markdown in field/ alone does not install Effect.
 * @param {readonly string[] | null} paths
 * @param {string} event
 * @returns {Flags}
 */
export const classify = (paths, event) => {
  if (event !== "pull_request" || paths === null || paths.length === 0) {
    return { ...all };
  }

  if (paths.some(reads)) {
    return { ...all, field: paths.some(rows) };
  }

  /** @param {string} path */
  const quiet = (path) => safe(path) || prose(path);
  // The typecheck is its own job so it answers at once, beside lint and build; it reads the same
  // paths as check, so it runs where check runs.
  const check = !paths.every(quiet);
  return {
    check,
    typecheck: check,
    test: !paths.every((path) => quiet(path) || (path.startsWith("next/") && path !== helper && path !== commits)),
    next: !paths.every((path) => quiet(path) || script(path) || old(path)),
    e2e: !paths.every((path) => quiet(path) || script(path) || path.startsWith("next/")),
    field: paths.some(rows),
  };
};

/** @typedef {Flags & {build: boolean}} Jobs */

/**
 * What one event runs: classify's flags, plus `build`, the slow half of check (its promises gate
 * and `pnpm build`). A draft pull request runs only the fast jobs: changes, field, typecheck and
 * check's lint (owner, 2026-11-11, 0134's amendment). Marking it ready starts a run with
 * `draft` false, so the full set runs on that head before it can merge. Only a pull request can
 * be a draft; on any other event the flag is ignored.
 * @param {readonly string[] | null} paths
 * @param {string} event
 * @param {boolean} draft
 * @returns {Jobs}
 */
export const jobs = (paths, event, draft) => {
  const flags = classify(paths, event);

  if (event === "pull_request" && draft) {
    return { ...flags, test: false, next: false, e2e: false, build: false };
  }

  return { ...flags, build: flags.check };
};

/** @param {string} sha */
export const validSha = (sha) => /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha);
/** @type {Runner} */
const git = (args) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 2 ** 28 });

/**
 * No shell interpolation. PR paths start at the merge base; pushes use before.
 * A rename is a deletion and an addition. NUL preserves all legal Git names.
 * @param {string} base
 * @param {string} head
 * @param {string} event
 * @param {Runner} [run]
 * @returns {string[] | null}
 */
export const readPaths = (base, head, event, run = git) => {
  if (!validSha(base) || !validSha(head)) {
    return null;
  }

  let from = base;

  if (event === "pull_request") {
    const merged = run(["merge-base", base, head]);

    if (merged.status !== 0) {
      return null;
    }

    from = merged.stdout.trim();

    if (!validSha(from)) {
      return null;
    }
  }

  const diff = run(["diff", "--no-renames", "--name-only", "-z", from, head, "--"]);

  if (diff.status !== 0 || (diff.stdout !== "" && !diff.stdout.endsWith("\0"))) {
    return null;
  }

  return diff.stdout === "" ? [] : diff.stdout.slice(0, -1).split("\0");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const event = process.env["EVENT"] ?? "";
  const paths = readPaths(process.env["BASE"] ?? "", process.env["HEAD"] ?? "", event);
  // `github.event.pull_request.draft`: "true" on a draft, "false" or empty otherwise. Anything but
  // "true" runs the full set, so a value we cannot read never skips a job.
  const flags = jobs(paths, event, process.env["DRAFT"] === "true");
  const output = `${Object.entries(flags)
    .map(([job, enabled]) => `${job}=${enabled}`)
    .join("\n")}\n`;
  process.stdout.write(output);
  const file = process.env["GITHUB_OUTPUT"];

  if (file) {
    appendFileSync(file, output);
  }

  if (paths === null) {
    console.error("changes: history could not be read; every job is enabled");
    process.exitCode = 1;
  }
}
