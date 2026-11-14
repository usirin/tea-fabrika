// Today's version is frozen (decision 0525): its paths are named here once. Every check that walks
// the repo imports these names, and the freeze guard in CI (`.github/ci/freeze.mjs`) refuses an
// edit under them. Plain JS with JSDoc types, like `.github/ci/changes.mjs`: no install and no type
// stripping, so the `changes` job runs it on the runner's own Node. It sits in oxlint-plugins/ so
// the temp repos stylelint.test.ts makes, which copy that folder, carry it too.
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";
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
 * The live workspace package folders, repo-relative, from `pnpm ls -r --depth -1 --json`. The
 * workspace root itself is not one.
 * @param {readonly {path: string}[]} listed
 * @param {string} root the repo's own folder
 * @returns {string[]}
 */
export const livePackages = (listed, root) =>
  listed.map((p) => relative(root, p.path).split("\\").join("/")).filter((dir) => dir !== "" && !isFrozen(`${dir}/`));

// `node oxlint-plugins/frozen.mjs packages` prints the live package folders, one per line, for
// scripts/typecheck.sh. It exits 2 when pnpm cannot list the workspace: that never reads as none.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, "..");

  if (process.argv[2] !== "packages") {
    console.error("usage: node oxlint-plugins/frozen.mjs packages");
    process.exit(2);
  }

  const listed = spawnSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 ** 28,
  });

  /** @type {unknown} */
  let parsed = null;

  try {
    parsed = JSON.parse(listed.stdout ?? "");
  } catch {
    parsed = null;
  }

  if (
    listed.status !== 0 ||
    !Array.isArray(parsed) ||
    !parsed.every((p) => typeof p === "object" && p !== null && typeof p.path === "string")
  ) {
    console.error(`frozen: pnpm could not list the workspace: status ${listed.status}\n${listed.stderr ?? ""}`);
    process.exit(2);
  }

  for (const dir of livePackages(parsed, root)) {
    console.log(dir);
  }
}
