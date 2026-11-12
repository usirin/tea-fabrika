import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { parseSync } from "oxc-parser";

/**
 * Today's tooling. A lead-script test starts its scripts as child processes, so Vitest's import
 * graph cannot see what it reads. This derives it instead, once, from the scripts themselves:
 * `vitest.config.ts` hands each test's reads to Vitest with `addWatchFile`, so `--changed` and
 * `--related` pick the test, and `pnpm lint` (lint.ts) fails on what the derivation cannot see.
 * Nothing is written in a test.
 *
 * A file under a skill's `scripts/` folder names another in one of three ways, and each file it
 * names there is read for names in turn:
 *
 * - By basename, as a word, if the named file is in a `scripts/` folder too: `"drive.ts"`,
 *   `join(import.meta.dirname, "box.sh")`, `"$(dirname "$0")/env.sh"`, or a comment.
 * - By a relative path to a file that exists, outside `.agents/` too:
 *   `"../../plan/scripts/plancheck.sh"`, `"../../../../next/apps/fabrika/src/exam/rows.ts"`.
 * - By a path from the repo's top to a file that exists: `join(env.MAIN, "exam-paths.json")`.
 *
 * Never a file above the repo, and outside the `scripts/` folders never a file in `node_modules/`
 * or a Markdown file. A file outside the `scripts/` folders is a
 * leaf: reached, never read for names. Most are named in a comment, and following them would reach
 * half the repo. A test that imports a script as a module gets that script's imports from Vitest.
 *
 * A name in a comment or a fixture string counts. That over-matches, which reruns a test and never
 * misses one. A path built from a variable (`${step}.sh`) is missed: `scriptReads` reports a script
 * no test reaches, and a comment that names it in the script that reads it mends that.
 */

const SCRIPTS = /^\.agents\/skills\/([^/]+)\/scripts\//;
const RELATIVE = /\.\.?\/[\w@+./-]+/g;
// A path from the top with an extension. Most such words (`Effect.gen`) are no file and drop out.
const TOP = /(?<![\w@./$-])\.?[\w@-][\w@.-]*(?:\/[\w@.-]+)*\.[A-Za-z]\w*(?![\w/])/g;
// Outside the scripts tree: a package's files, and Markdown. A Markdown change runs no test job in
// CI (.github/ci/changes.mjs), and skill prose has its own reader, skillscheck.sh.
const LEAVES_OUT = /(?:^|\/)node_modules\/|\.md$/;

/** @param {string} path */
export const isScript = (path) => SCRIPTS.test(path);

/** @param {string} path */
export const isTest = (path) => path.endsWith(".test.ts");

/** @param {string} text */
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A word that matches `name` alone: not inside a longer name.
 * @param {string} name
 */
const word = (name) => new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w.-])`);

/**
 * Every file one test reaches, each with the file that first named it.
 * @param {ReadonlyMap<string, string>} tree every file under a skill's `scripts/` folder, path to text
 * @param {(path: string) => boolean} exists whether a repo path is a file
 * @param {string} test the test's repo path, a key of `tree`
 * @returns {Map<string, string>} each reached path, to the path that named it
 */
export const reached = (tree, exists, test) => {
  const names = [...tree.keys()]
    .filter((path) => !isTest(path))
    .map((path) => ({ path, word: word(posix.basename(path)) }));
  /** @type {Map<string, string>} */
  const via = new Map();
  const queue = [test];
  /**
   * @param {string} path
   * @param {string} from
   */
  const visit = (path, from) => {
    if (path !== test && !isTest(path) && !via.has(path)) {
      via.set(path, from);
      queue.push(path);
    }
  };

  for (const from of queue) {
    // Only the scripts tree has text here, so a file outside it is a leaf.
    const source = tree.get(from) ?? "";

    for (const { path, word } of names) {
      if (word.test(source)) {
        visit(path, from);
      }
    }

    const paths = new Set([
      ...source.matchAll(RELATIVE).map(([token]) => posix.join(posix.dirname(from), token)),
      ...source.matchAll(TOP).map(([token]) => posix.normalize(token)),
    ]);

    for (const path of paths) {
      if (tree.has(path) || (!path.startsWith("../") && !LEAVES_OUT.test(path) && exists(path))) {
        visit(path, from);
      }
    }
  }

  return via;
};

/**
 * The paths a test imports bare, as `import "./x.sh?raw"`, parsed, so a comment or a string is none.
 * @param {string} test
 * @param {string} source
 */
const bare = (test, source) =>
  parseSync(test, source, { sourceType: "module" })
    .module.staticImports.filter((statement) => statement.entries.length === 0)
    .map((statement) => statement.moduleRequest.value)
    .filter((request) => request.endsWith("?raw"))
    .map((request) => posix.join(posix.dirname(test), request.slice(0, -"?raw".length)));

/**
 * What `pnpm lint` refuses in the scripts tree.
 * - `raw`: a test imports a file bare with `?raw`, as tests once declared what they read. What a
 *   script reads is derived, and what it is not derived from belongs in the script that reads it,
 *   as a comment that names it. An import that takes the text as a value is a real read and stays.
 * - `unreached`: no test reaches a script, and its skill's `SKILL.md` does not name it as a tool a
 *   person runs. Either something reads it through a path built at run time, or nothing reads it.
 * @param {ReadonlyMap<string, string>} tree
 * @param {(path: string) => boolean} exists
 * @param {(path: string) => string} prose the `SKILL.md` text a skill folder holds, "" when none
 * @returns {{raw: {test: string, path: string}[], unreached: string[]}}
 */
export const scriptReads = (tree, exists, prose) => {
  const tests = [...tree.keys()].filter(isTest);
  const reach = new Set(tests.flatMap((test) => [...reached(tree, exists, test).keys()]));
  /** @param {string} path */
  const tool = (path) => {
    const [folder = "", skill = ""] = SCRIPTS.exec(path) ?? [];
    // `flow/run.ts`, or `scripts/flow/run.ts`, but not the `run.ts` inside `flow/run.ts`.
    const name = escape(path.slice(folder.length));
    return new RegExp(`(?:(?<![\\w./-])|(?<=scripts/))${name}(?![\\w.-])`).test(
      prose(`.agents/skills/${skill}/SKILL.md`),
    );
  };
  return {
    raw: tests.flatMap((test) => bare(test, tree.get(test) ?? "").map((path) => ({ test, path }))),
    unreached: [...tree.keys()].filter((path) => !isTest(path) && !reach.has(path) && !tool(path)),
  };
};

/**
 * The scripts tree, and what `reached` and `scriptReads` ask of the rest of the repo, from the disk.
 * @param {string} root
 */
export const load = (root) => {
  const tree = new Map(
    readdirSync(join(root, ".agents/skills"), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)))
      .filter(isScript)
      .map((path) => [path, readFileSync(join(root, path), "utf8")]),
  );
  /** @param {string} path */
  const exists = (path) => statSync(join(root, path), { throwIfNoEntry: false })?.isFile() ?? false;
  /** @param {string} path */
  const prose = (path) => (exists(path) ? readFileSync(join(root, path), "utf8") : "");
  return { tree, exists, prose };
};
