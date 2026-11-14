// The CI classifier. No installed dependencies: changes and field can decide what to run before
// pnpm setup or cache restoration. Today's version is frozen (0525): no job runs for it, so its
// paths start none of their own checks, and `e2e`, whose end-to-end tests were today's, is off.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isFrozen } from "../../oxlint-plugins/frozen.mjs";

/** @typedef {{check: boolean, typecheck: boolean, test: boolean, next: boolean, e2e: boolean, field: boolean}} Flags */
/** @typedef {(args: string[]) => {status: number | null, stdout: string}} Runner */
const all = { check: true, typecheck: true, test: true, next: true, e2e: false, field: true };
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

/** Paths no heavy job reads: field rows, plain Markdown and skill prose. @param {string} path */
const quiet = (path) => safe(path) || prose(path);

/**
 * An event whose jobs follow its changed paths, because it can read them: a pull request, a merge
 * queue's group (0174) and a push to main, whose paths are what that push brought (0175). Any
 * other event runs every job.
 * @param {string} event
 */
const scoped = (event) => event === "pull_request" || event === "merge_group" || event === "push";

/**
 * A scoped event skips a job only when every path is explicitly safe for that job.
 * Amendment 3: field's runner starts on every event; this flag gates its install
 * and row check, so Markdown in field/ alone does not install Effect.
 * `e2e` is false for every input: its job ran today's end-to-end tests, which are gone (0525),
 * so it skips wherever changes succeeds. History that cannot be read, no path at all, or an event
 * that is not scoped runs every other job.
 * @param {readonly string[] | null} paths
 * @param {string} event
 * @returns {Flags}
 */
export const classify = (paths, event) => {
  if (!scoped(event) || paths === null || paths.length === 0) {
    return { ...all };
  }

  if (paths.some(reads)) {
    return { ...all, field: paths.some(rows) };
  }

  // The typecheck is its own job so it answers at once, beside lint and build; it reads the same
  // paths as check, so it runs where check runs.
  const check = !paths.every(quiet);
  return {
    check,
    typecheck: check,
    test: !paths.every((path) => quiet(path) || (path.startsWith("next/") && path !== helper && path !== commits)),
    next: !paths.every((path) => quiet(path) || script(path) || isFrozen(path)),
    e2e: false,
    field: paths.some(rows),
  };
};

/**
 * What one event runs: classify's flags. A draft pull request runs only the fast jobs: changes, field, typecheck and
 * check's lint (owner, 2026-11-11, 0134's amendment). Marking it ready starts a run with
 * `draft` false, so the full set runs on that head before it can merge. Only a pull request can
 * be a draft; on any other event, a merge queue's group and a push included, the flag is ignored.
 * @param {readonly string[] | null} paths
 * @param {string} event
 * @param {boolean} draft
 * @returns {Flags}
 */
export const jobs = (paths, event, draft) => {
  const flags = classify(paths, event);

  if (event === "pull_request" && draft) {
    return { ...flags, test: false, next: false, e2e: false };
  }

  return flags;
};

/** @param {string} sha */
export const validSha = (sha) => /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha);
/** @type {Runner} */
export const git = (args) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 2 ** 28 });

/**
 * The commit a run's diff starts from: a pull request's merge base, or, for a push and a merge
 * queue's group, the base itself (a push uses before; a group uses its own base, the commit it was
 * built on, so the diff is the group's change). `null` when either end is no SHA or Git cannot
 * say. freeze.mjs reads its diff from the same commit.
 * @param {string} base
 * @param {string} head
 * @param {string} event
 * @param {Runner} [run]
 * @returns {string | null}
 */
export const diffBase = (base, head, event, run = git) => {
  if (!validSha(base) || !validSha(head)) {
    return null;
  }

  if (event !== "pull_request") {
    return base;
  }

  const merged = run(["merge-base", base, head]);

  if (merged.status !== 0) {
    return null;
  }

  const from = merged.stdout.trim();
  return validSha(from) ? from : null;
};

/**
 * No shell interpolation. Paths start at `diffBase`. A rename is a deletion and an addition. NUL
 * preserves all legal Git names.
 * @param {string} base
 * @param {string} head
 * @param {string} event
 * @param {Runner} [run]
 * @returns {string[] | null}
 */
export const readPaths = (base, head, event, run = git) => {
  const from = diffBase(base, head, event, run);

  if (from === null) {
    return null;
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
