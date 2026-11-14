// Today's version is frozen (decision 0525): its paths are named here once. Every check that walks
// the repo imports these names, and the freeze guard in CI (`.github/ci/freeze.mjs`) refuses an
// edit under them. Plain JS with JSDoc types, like `.github/ci/changes.mjs`: no install and no type
// stripping, so the `changes` job runs it on the runner's own Node. It sits in oxlint-plugins/ so
// the temp repos stylelint.test.ts makes, which copy that folder, carry it too.
import { existsSync, globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The frozen roots (0525). A path under one may be deleted, never added or changed. */
export const frozen = /** @type {const} */ (["apps/", "programs/", "packages/", "bin/"]);

/** Live inside a frozen root: the design package both versions use (0456). */
export const shared = /** @type {const} */ (["packages/fabrika-design/"]);

/** @param {string} path a repo-relative path, `/`-separated */
export const isFrozen = (path) =>
  frozen.some((root) => path.startsWith(root)) && !shared.some((root) => path.startsWith(root));

/**
 * What a whole-repo run hands its tool: every top-level entry that is not frozen, plus each shared
 * folder. `.git` and `node_modules` never.
 * @param {readonly string[]} entries the names `readdirSync(root)` gives
 * @returns {string[]}
 */
export const liveRoots = (entries) => [
  ...entries.filter((name) => name !== ".git" && name !== "node_modules" && !isFrozen(`${name}/`)),
  ...shared.map((root) => root.slice(0, -1)),
];

/**
 * The workspace package folders, repo-relative and sorted: every folder a `packages` glob of
 * `pnpm-workspace.yaml` matches that holds a `package.json`. `*` is one path part, as pnpm reads it
 * here (and `workspace-reach.ts` with it). A `!` glob is refused, since this does not read one.
 * @param {string} root the repo's own folder
 * @param {readonly string[]} globs
 * @returns {string[]}
 */
export const packageDirs = (root, globs) => {
  if (globs.some((glob) => glob.startsWith("!"))) {
    throw new Error("frozen: a negated workspace glob is not read");
  }

  return [...new Set(globs.flatMap((glob) => globSync(glob, { cwd: root })))]
    .map((dir) => dir.split("\\").join("/"))
    .filter((dir) => existsSync(join(root, dir, "package.json")))
    .sort();
};

/**
 * The live workspace package folders: the repo-relative ones given, less today's frozen ones and
 * the workspace root itself.
 * @param {readonly string[]} dirs
 * @returns {string[]}
 */
export const livePackages = (dirs) => dirs.filter((dir) => dir !== "" && dir !== "." && !isFrozen(`${dir}/`));

// `node oxlint-plugins/frozen.mjs packages` prints the live package folders, one per line, for
// scripts/typecheck.sh. The workspace is the checkout that holds this file, whatever folder the run
// starts in, and is read from its `pnpm-workspace.yaml`, never asked of pnpm. `yaml` is imported
// only here, so freeze.mjs's no-install import of this file never loads it. It exits 2 when the
// file is missing, does not parse, has no `packages` list or yields no package: that never reads
// as none.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, "..");
  /** @param {string} why */
  const fail = (why) => {
    console.error(`frozen: ${why}`);
    process.exit(2);
  };

  if (process.argv[2] !== "packages") {
    fail("usage: node oxlint-plugins/frozen.mjs packages");
  }

  const { parse } = await import("yaml");
  /** @type {unknown} */
  let workspace = null;

  try {
    workspace = parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"));
  } catch (error) {
    fail(`pnpm-workspace.yaml could not be read: ${String(error)}`);
  }

  const globs =
    typeof workspace === "object" && workspace !== null && "packages" in workspace ? workspace.packages : undefined;

  if (!Array.isArray(globs) || !globs.every((glob) => typeof glob === "string")) {
    fail("pnpm-workspace.yaml has no packages list");
  } else {
    const live = livePackages(packageDirs(root, globs));

    if (live.length === 0) {
      fail("pnpm-workspace.yaml names no live package");
    }

    for (const dir of live) {
      console.log(dir);
    }
  }
}
