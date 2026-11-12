import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import fc from "fast-check";
import { afterAll, expect } from "vitest";

// What catchup.sh's laws share (ticket 559): the stubbed tools, one run of the script, the Git
// fixture the cleanup laws start from, and the nested-storage law. Each run of the script starts
// about 25 stubbed tools, one Node process each, and a file runs its tests one at a time, so the
// laws sit in four files vitest runs side by side: catchup.test.ts, catchup.cleanup.test.ts and the
// two catchup.nested-storage-*.test.ts.

// YAML belongs to the CI workspace package, not the lead scripts' package.
const { parse } = createRequire(new URL("../../../../.github/ci/package.json", import.meta.url))("yaml") as {
  parse: (text: string) => { jobs: { next: { strategy: { matrix: { shard: number[] } } } } };
};

// Today's tooling. GitHub, signing and pushes are stubbed. Cleanup uses disposable local Git.
const script = join(import.meta.dirname, "catchup.sh");
export const tip = "0123456789abcdef0123456789abcdef01234567";

const workflow = parse(readFileSync(join(import.meta.dirname, "../../../../.github/workflows/check.yaml"), "utf8"));

export const nextNames: string[] = workflow.jobs.next.strategy.matrix.shard.map((index: number) => `next (${index})`);

// `url` is the check run's own link, its html_url, when a law gives one.
export type Check = { name: string; status: string; conclusion: string; url?: string };
export const success = (name: string): Check => ({ name, status: "completed", conclusion: "success" });
export const matrixChecks = ["check", "e2e", "commits", ...nextNames].map(success);

const storageFiles = (root: string) => {
  const files: Record<string, string> = {};
  const visit = (path: string, name: string) => {
    const info = lstatSync(path);
    files[name] = info.isSymbolicLink()
      ? `link:${readlinkSync(path)}`
      : info.isFile()
        ? `file:${readFileSync(path).toString("base64")}`
        : "directory";

    if (info.isDirectory()) {
      for (const child of readdirSync(path)) {
        visit(join(path, child), `${name}/${child}`);
      }
    }
  };
  visit(root, ".");
  return files;
};

export const reads = ["head", "checks", "trust", "apps", "logs"] as const;
export const options = { seed: 520, numRuns: 12 };
type Call = { cmd: string; args: string[]; key?: string };
export type Post = { sub: string; ticket?: number; as: string; home: string; body?: string };
// The squash commit GitHub answers for the merged PR.
export const merged = "feedfacefeedfacefeedfacefeedfacefeedface";

export type Setup = {
  checks?: Check[];
  repo?: string;
  failures: number[];
  pending: number;
  answer: "green" | "red" | "event" | "duplicate" | "startup" | "app" | "ticket" | "trust-red";
  branch: string;
  merge: boolean;
  refused: "none" | "notes" | "branch";
  cleanup?: "clean" | "dirty" | "locked" | "unsaved" | "malformed" | "error";
  mergeFails?: boolean;
  // Cleanup trouble: worktree listing fails, keeping the head fails, the catch-up checkout is
  // not registered, or two forced worktrees share the PR branch.
  trouble?: "list" | "keep" | "unregistered" | "twins" | "missing";
  protected?: "main-work" | "main-data" | "main-child" | "main-data-child" | "state";
  protectedDepth?: number;
  storage?: {
    binding: "gitdir" | "commondir" | "objects" | "alternates" | "alternates-file";
    worktree: "catchup-900" | "driver";
    parts: string[];
    through: boolean;
    relative: boolean;
    hops: number;
  };
  deepStorage?: {
    worktree: "catchup-900" | "driver";
    location: "work" | "admin";
    kind: string;
    root: "gitdir" | "common" | "alternate";
    parts: string[];
    through: boolean;
    relative: boolean;
  };
  sharedAdmin?: "catchup-900" | "driver";
  unwalkable?: { worktree: "catchup-900" | "driver"; parts: string[] };
  // In a gh stack: `gh pr merge` refuses, and the head read again is `moved` or not.
  stack?: "none" | "same" | "moved";
  // Seconds since the start, read by `date` after that many check reads (the last one repeats).
  clock?: number[];
  // After the merge (0015): the PR's description, its state as GitHub says it, whether the merge
  // commit is on main, and the tracker's tickets by number with their state.
  body?: string;
  landed?: "MERGED" | "OPEN";
  offMain?: boolean;
  tickets?: Record<number, "open" | "closed">;
  // The last look at main refuses: main moved after the checks and the merged tree is red (552).
  stale?: boolean;
  // The pull request's state, one answer per read of it (the start read, then each look inside a
  // wait), the last one repeating. OPEN by default. UNKNOWN is gh's answer for no such PR.
  views?: View[];
  // The first looks inside a wait that fail as the network does, before one answers.
  lookFailures?: number;
  // A link GitHub gives a check run, in the default answer.
  links?: boolean;
  // Another run holds the catch-up lock the whole time, and `date` answers these seconds in turn.
  lockHeld?: number[];
  // The first check read that answers (0097: catch-up's own look at a head that lacks main) finds
  // `check` red or still running, or `e2e` missing because CI never ran it; later reads are as the
  // rest of the setup says.
  before?: "red" | "running" | "missing";
};

export type View = "OPEN" | "DRAFT" | "MERGED" | "CLOSED" | "UNKNOWN";
export const link = (name: string) => `https://github.com/fixture/repo/runs/${encodeURIComponent(name)}`;

export const green: Setup = {
  failures: [0, 0, 0, 0, 0],
  pending: 0,
  answer: "green",
  branch: "fabrikalfa/tests-520",
  merge: false,
  refused: "none",
};

// The stub uses the platform's absolute Node executable. Its PATH never contains a real gh,
// node or pnpm, and each write-capable command is refused unless handled here.
const stub = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.CATCHUP_FIXTURE;
const setup = JSON.parse(fs.readFileSync(path.join(dir, "setup.json"), "utf8"));
const stateFile = path.join(dir, "state.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
const cmd = path.basename(process.argv[1]);
const args = process.argv.slice(2);
let key;
if (cmd === "gh") {
  if (args[0] === "pr" && args[1] === "view" && args.includes("state,isDraft,mergeCommit")) key = "standing";
  else if (args[0] === "pr" && args[1] === "view")
    key = args.includes("state,mergeCommit") ? "landed" : args.includes("body") ? "body" : args.includes("headRefOid") ? "oid" : "head";
  else if (args[0] === "stack" && args[1] === "merge") key = "stack";
  else if (args[0] === "pr" && args[1] === "merge") key = "merge";
  else if (args[0] === "run" && args[1] === "view") key = "logs";
  else if (args[0] === "api" && args[1].includes("check_name=")) key = "apps";
  else if (args[0] === "api" && args[1].includes("check-runs?")) key = "checks";
  else if (args[0] === "api" && args[1].includes("actions/runs?")) key = "trust";
}
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({cmd, args, key}) + "\n");
const die = (text) => { console.error(text); process.exit(1); };
if (cmd === "gh") {
  if (!key) die("unhandled gh command");
  const n = state[key] || 0;
  state[key] = n + 1;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const index = ["head", "checks", "trust", "apps", "logs"].indexOf(key);
  if (index >= 0 && n < setup.failures[index]) {
    // Failed logs can still print a plausible result. Exit status must win.
    if (key === "logs") console.log("commits\tcheck\t2026-11-08T00:00:00Z commits: 3 commits, ticket 520");
    die("temporary " + key + " read failure");
  }
  if (key === "standing" && n < (setup.lookFailures || 0)) die("temporary standing read failure");
  if (key === "head" || key === "standing") {
    // One answer per read of the state, in order, across the start read and the looks.
    const views = setup.views || ["OPEN"];
    const seen = state.views || 0;
    state.views = seen + 1;
    fs.writeFileSync(stateFile, JSON.stringify(state));
    const view = views[Math.min(seen, views.length - 1)];
    if (view === "UNKNOWN") die("GraphQL: Could not resolve to a PullRequest with the number of 900. (repository.pullRequest)");
    const words = [view === "DRAFT" ? "OPEN" : view, String(view === "DRAFT"), view === "MERGED" ? process.env.CATCHUP_MERGED : "-"];
    console.log((key === "head" ? [...words, setup.branch] : words).join(" "));
  }
  if (key === "landed") console.log(setup.landed === "OPEN" ? "OPEN " : "MERGED " + process.env.CATCHUP_MERGED);
  if (key === "body") console.log(setup.body ?? "");
  if (key === "oid") console.log(setup.stack === "moved" ? "f".repeat(40) : process.env.CATCHUP_TIP);
  if (key === "merge" && setup.stack && setup.stack !== "none")
    die("This pull request is part of a stack and must be merged using the asynchronous merge REST API");
  if (key === "checks") {
    const pending = n - setup.failures[index] < setup.pending;
    const before = n === setup.failures[index] ? setup.before : undefined;
    if (setup.checks) {
      for (const check of setup.checks) console.log(check.name + "\t" + check.status + "\t" + check.conclusion + "\t" + (check.url ?? ""));
    } else for (const name of ["check", "e2e", "commits", ...${JSON.stringify(nextNames)}, "next"]) {
      if (before === "missing" && name === "e2e") continue;
      const red = (setup.answer === "red" || before === "red") && name === "check";
      const running = pending || (before === "running" && name === "check");
      // Existing non-waiter laws also provide a skipped bare job while the waiter changes.
      // T376's isolated laws below never add this compatibility check to a matrix answer.
      const url = setup.links ? "https://github.com/fixture/repo/runs/" + encodeURIComponent(name) : "";
      console.log(name + "\t" + (running ? "in_progress\t" : "completed\t" + (red ? "failure" : name === "next" ? "skipped" : "success")) + "\t" + url);
    }
  }
  if (key === "trust") {
    const event = setup.answer === "event" ? "push" : "pull_request_target";
    const result = setup.answer === "trust-red" ? "failure" : "success";
    if (setup.answer === "startup") console.log("70\tpull_request_target\tcompleted\tstartup_failure\t80");
    console.log("71\t" + event + "\tcompleted\t" + result + "\t81");
    if (setup.answer === "duplicate") console.log("72\tpull_request_target\tcompleted\tsuccess\t82");
  }
  if (key === "apps") console.log(setup.answer === "app" ? "impostor" : "github-actions");
  if (key === "logs") console.log("commits\tcheck\t2026-11-08T00:00:00Z commits: 3 commits, ticket " + (setup.answer === "ticket" ? "521" : "520"));
  if (key === "merge" && setup.mergeFails) die("merge refused");
  process.exit(0);
}
if (cmd === "git") {
  if (args.includes("merge-base") && args.includes(process.env.CATCHUP_MERGED)) process.exit(setup.offMain ? 1 : 0);
  if (setup.repo && (args.includes("merge-base") || args.includes("merge"))) {
    const at = args.includes("merge-base") ? args.indexOf("merge-base") : args.indexOf("merge");
    const ran = require("node:child_process").spawnSync("/usr/bin/git", ["-C", setup.repo, ...args.slice(at)], {encoding: "utf8"});
    process.stdout.write(ran.stdout || ""); process.stderr.write(ran.stderr || "");
    process.exit(ran.status ?? 1);
  }
  if (args.includes("merge-base")) process.exit(setup.merge ? 1 : 0);
  const op = args[0] === "-C" ? args.slice(2) : args;
  const local = ["update-ref", "worktree", "rev-parse", "for-each-ref", "status", "cat-file", "show-ref", "symbolic-ref", "rev-list", "config", "ls-files", "log"];
  if (setup.cleanup && args.some(a => local.includes(a)) && !["fetch", "checkout", "push"].includes(op[0]) && !args.includes("merge")) {
    if (setup.cleanup === "error" && args.includes("remove") && args.some(a => a.endsWith("driver"))) die("planted worktree removal failure");
    if (setup.trouble === "list" && args.includes("worktree") && args.includes("list")) die("planted worktree list failure");
    if (setup.trouble === "keep" && args.includes("refs/keep/pr/900")) die("planted keep ref failure");
    const ran = require("node:child_process").spawnSync("/usr/bin/git", args, {encoding: "utf8"});
    process.stdout.write(ran.stdout || ""); process.stderr.write(ran.stderr || ""); process.exit(ran.status ?? 1);
  }
  if (!setup.cleanup && (args.includes("update-ref") || args.includes("worktree"))) process.exit(0);
  if (args[0] === "rev-parse") console.log(args.includes("--short") ? process.env.CATCHUP_TIP.slice(0, 7) : process.env.CATCHUP_TIP);
  else if (args[0] === "push" && setup.refused === "branch") die("branch push refused");
  else if (!["fetch", "checkout", "push", "rev-parse"].includes(args[0]) && !args.includes("merge")) die("unhandled git command");
  process.exit(0);
}
if (cmd === "node" && args[0].endsWith("/apps/fabrika/src/cli.ts") && args[1] === "post") {
  // The tracker's own post command: list, comment and close, as an agent, on FABRIKA_HOME.
  const [sub, n] = [args[2], Number(args[3])];
  const at = args.indexOf("--body-file");
  const post = {sub, ticket: sub === "list" ? undefined : n, as: args[args.indexOf("--as") + 1], home: process.env.FABRIKA_HOME, body: at < 0 ? undefined : fs.readFileSync(args[at + 1], "utf8")};
  fs.appendFileSync(path.join(dir, "posts.jsonl"), JSON.stringify(post) + "\n");
  if (sub === "list")
    // As the real list does: open tickets only, one line each, after the logger's own prefix.
    for (const [number, state] of Object.entries(setup.tickets ?? {}))
      if (state === "open") console.log("[15:00:00.000] INFO (#2): #" + number + " open c0 A ticket");
  process.exit(0);
}
if (cmd === "node" && args[0].endsWith("/sizecap.ts")) {
  // sizecap.ts's size line (0099), with its own laws in sizecap.test.ts: here it is advice, and a failure of it
  // must stop nothing.
  if (setup.stale) die("sizecap: planted");
  console.log("size: 7 product lines; not counted: 0 test, 0 docs, 0 lock, 0 generated, 0 other lines, 0 binary files");
  process.exit(0);
}
if (cmd === "node" && args[0].endsWith("/gcloop.ts")) {
  // The box cleanup kick after a merge (0101), with its own laws in gcloop.test.ts: here it only starts.
  process.exit(0);
}
if (cmd === "node" && args[0].endsWith("/freshmain.ts")) {
  // The last look at main, with its own laws in freshmain.test.ts: here it only passes or refuses.
  if (setup.stale) die("pr 900: merge refused at the lint check: planted");
  process.exit(0);
}
if (cmd === "node" && args[0].endsWith("/box.ts")) {
  // box.sh rm runs box.ts on the real Node, with its own laws in boxrm.test.ts.
  process.exit(require("node:child_process").spawnSync(process.execPath, args, {stdio: "inherit"}).status ?? 1);
}
if (cmd === "node") {
  if (!args[0].endsWith("/botpush.mjs")) die("unhandled node command");
  if (setup.refused === "notes" || setup.refused === "branch" && setup.branch.startsWith("fabrikalfa/")) die("atomic push refused");
  process.exit(0);
}
if (cmd === "pnpm" || cmd === "nice") process.exit(0);
if (cmd === "sleep") process.exit(0);
if (cmd === "date" && setup.lockHeld) {
  const dates = state.dates || 0;
  state.dates = dates + 1;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  console.log(String(1794096000 + setup.lockHeld[Math.min(dates, setup.lockHeld.length - 1)]));
  process.exit(0);
}
if (cmd === "date") {
  const clock = setup.clock || [0];
  console.log(String(1794096000 + clock[Math.min(state.checks || 0, clock.length - 1)]));
  process.exit(0);
}
die("unhandled tool: " + cmd);
`;

// The cleanup laws share one Git fixture, built once per file on the first cleanup run (ticket 559:
// building it took about 37 Git starts per run). Git writes the folder's absolute path into the
// worktrees and boxes, so each run copies the fixture back to the folder it was built in; a file's
// tests run one at a time, so one folder serves them all. Only the branch name differs per run: the
// fixture's branch is renamed to the run's. No generated branch can spell it (no `_` in them).
const fixtures = mkdtempSync(join(tmpdir(), "cu-"));

const fixture = {
  at: join(fixtures, "run"),
  template: join(fixtures, "template"),
  branch: "fabrikalfa/fixture_branch",
  tip: "",
};

afterAll(() => rmSync(fixtures, { recursive: true, force: true }));

const buildFixture = (dir: string, git: (at: string, ...commands: string[]) => string) => {
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "home"));
  git(dir, "init", "-q", "--initial-branch=main");
  git(dir, "config", "user.name", "Fixture");
  git(dir, "config", "user.email", "fixture@example.test");
  writeFileSync(join(dir, "tracked"), "base\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  git(dir, "add", "tracked", ".gitignore");
  git(dir, "commit", "-qm", "base");
  const base = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-qb", fixture.branch);
  writeFileSync(join(dir, "tracked"), "checked head");
  git(dir, "commit", "-qam", "checked head");
  fixture.tip = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", "main");
  git(dir, "update-ref", "refs/remotes/origin/main", base);
  // Simulate a squash: the checked head is not an ancestor of main.
  writeFileSync(join(dir, "tracked"), "squashed");
  git(dir, "commit", "-qam", "landed squash");
  git(dir, "worktree", "add", "-q", "--detach", join(dir, "boxes/catchup-900"), fixture.tip);
  mkdirSync(join(dir, "boxes/catchup-900/node_modules"));
  git(dir, "worktree", "add", "-q", join(dir, "boxes/driver"), fixture.branch);
  git(dir, "branch", `${fixture.branch}-sibling`, fixture.tip);
  git(dir, "worktree", "add", "-q", join(dir, "boxes/sibling"), `${fixture.branch}-sibling`);

  for (const [name, branch] of [
    ["exact box", fixture.branch],
    ["sibling box", `${fixture.branch}-sibling`],
    ["later box", fixture.branch],
  ] as const) {
    const work = join(dir, "boxes", name),
      data = `${work}-gitdata`;
    // Isolate cleanup from the normal clone's symbolic-ref bug, tested in box.test.ts.
    mkdirSync(work);
    git(work, "init", "-q", "--initial-branch=main", `--separate-git-dir=${data}`);
    git(work, "remote", "add", "origin", dir);
    git(work, "fetch", "-q", "origin", `${branch}:refs/heads/${branch}`);
    git(work, "checkout", "-q", branch);
    expect(git(work, "remote")).toBe("origin");
    git(work, "config", "user.name", "Fixture");
    git(work, "config", "user.email", "fixture@example.test");
  }

  mkdirSync(join(dir, "boxes/state"));
  writeFileSync(join(dir, "boxes/state/driver.md"), "saved wait");
  expect(git(dir, "remote")).toBe("");
};

export const run = (setup: Setup, args: string[] = []) => {
  const dir = setup.cleanup ? fixture.at : mkdtempSync(join(tmpdir(), "cu-"));

  try {
    const bin = join(dir, "bin");
    const localEnv = {
      ...process.env,
      HOME: join(dir, "home"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      TYPESAFE_API_KEY: undefined,
    };
    const git = (at: string, ...commands: string[]) => {
      const got = spawnSync("/usr/bin/git", ["-C", at, ...commands], {
        encoding: "utf8",
        env: localEnv,
        timeout: 5_000,
      });
      expect(got.status, got.stderr).toBe(0);
      return got.stdout.trim();
    };
    let checkedTip = tip;
    let main = dir;
    let storage = "",
      history = "";
    let admin = "";
    let stored = "";
    let savedStorage: Record<string, string> = {};
    let protectedWork = "",
      protectedData = "",
      saved = "";

    if (!setup.cleanup) {
      mkdirSync(bin);
      mkdirSync(join(dir, "home"));

      // A run that never gets the lock never makes its checkout, so none is planted for it.
      if (setup.lockHeld) {
        mkdirSync(join(dir, "boxes/catchup.lock"), { recursive: true });
      } else {
        mkdirSync(join(dir, "boxes/catchup-900/node_modules"), { recursive: true });
      }
    } else {
      if (!existsSync(fixture.template)) {
        buildFixture(dir, git);
        renameSync(dir, fixture.template);
      }

      cpSync(fixture.template, dir, { recursive: true, preserveTimestamps: true });
      checkedTip = fixture.tip;
      // Renaming a branch also moves the HEAD of each worktree that has it checked out.
      git(dir, "branch", "-m", fixture.branch, setup.branch);
      git(dir, "branch", "-m", `${fixture.branch}-sibling`, `${setup.branch}-sibling`);

      for (const [name, suffix] of [
        ["exact box", ""],
        ["sibling box", "-sibling"],
        ["later box", ""],
      ] as const) {
        git(join(dir, "boxes", name), "branch", "-m", `${fixture.branch}${suffix}`, `${setup.branch}${suffix}`);
      }

      const work = join(dir, "boxes/exact box"),
        data = `${work}-gitdata`;

      if (setup.cleanup === "dirty") {
        writeFileSync(join(work, "tracked"), "dirty");
      }

      if (setup.cleanup === "unsaved") {
        writeFileSync(join(work, "tracked"), "unsaved");
        git(work, "commit", "-qam", "unsaved");
      }

      if (setup.cleanup === "malformed") {
        writeFileSync(join(data, "HEAD"), "malformed");
      }

      if (setup.cleanup === "dirty") {
        writeFileSync(join(dir, "boxes/driver/tracked"), "dirty");
      }

      if (setup.cleanup === "locked") {
        git(dir, "worktree", "lock", join(dir, "boxes/driver"));
      }

      if (setup.trouble === "unregistered") {
        git(dir, "worktree", "remove", "--force", join(dir, "boxes/catchup-900"));
        mkdirSync(join(dir, "boxes/catchup-900/node_modules"), { recursive: true });
      }

      if (setup.trouble === "twins") {
        git(dir, "worktree", "add", "-q", "-f", join(dir, "boxes/driver twin"), setup.branch);
      }

      if (setup.trouble === "missing") {
        rmSync(join(dir, "boxes/driver"), { recursive: true });
      }

      if (setup.protected) {
        protectedWork = join(dir, "boxes", setup.protected === "state" ? "state" : "protected");
        protectedData = `${protectedWork}-gitdata`;
        mkdirSync(protectedWork, { recursive: true });
        git(protectedWork, "init", "-q", `--separate-git-dir=${protectedData}`);
        git(protectedWork, "remote", "add", "origin", dir);
        git(protectedWork, "fetch", "-q", "origin", `${setup.branch}:refs/heads/${setup.branch}`);
        git(protectedWork, "checkout", "-q", setup.branch);

        if (setup.protected !== "state") {
          main =
            setup.protected === "main-work"
              ? protectedWork
              : setup.protected === "main-data"
                ? protectedData
                : join(
                    setup.protected === "main-data-child" ? protectedData : protectedWork,
                    ...Array.from({ length: setup.protectedDepth ?? 1 }, (_, i) => `nested-${i}`),
                  );
          mkdirSync(main, { recursive: true });
        }

        saved = join(setup.protected === "state" ? protectedWork : main, "saved.md");
        writeFileSync(saved, setup.branch);
      }

      expect(git(dir, "remote")).toBe("");

      // Each of these plants names the worktree whose storage it borrows.
      const worktree = setup.deepStorage?.worktree ?? setup.sharedAdmin ?? setup.unwalkable?.worktree;

      if (worktree) {
        const original = join(dir, ".git");
        admin = git(join(dir, "boxes", worktree), "rev-parse", "--absolute-git-dir");
        history = git(dir, "rev-list", "--objects", "--all");

        if (setup.sharedAdmin) {
          // A worktree removal deletes its admin directory outside the work folder.
          // MAIN is another reader of that exact directory, with the same common store.
          const common = join(dir, "main-common");
          renameSync(original, common);

          for (const name of ["catchup-900", "driver", "sibling"]) {
            writeFileSync(join(dir, "boxes", name, ".git"), `gitdir: ${join(common, "worktrees", name)}\n`);
          }

          admin = join(common, "worktrees", worktree);
          writeFileSync(original, `gitdir: ${admin}\n`);
          storage = admin;
          stored = admin;
        } else if (setup.unwalkable) {
          storage = join(original, "objects/pack", ...setup.unwalkable.parts);
          mkdirSync(join(storage, ".."), { recursive: true });
          symlinkSync(join(dir, "missing-storage"), storage);
        } else if (setup.deepStorage) {
          const path = setup.deepStorage;
          git(dir, "pack-refs", "--all");

          if (path.kind === "objects/pack") {
            git(dir, "repack", "-ad");
          }

          if (path.kind === "refs") {
            git(dir, "update-ref", "refs/keep/storage", "HEAD");
          }

          history = git(dir, "rev-list", "--objects", "--all");
          let root = original;

          if (path.root === "common") {
            root = join(dir, "main-common");
            cpSync(original, root, { recursive: true });
            rmSync(join(root, "worktrees"), { recursive: true });
            symlinkSync(join(original, "worktrees"), join(root, "worktrees"));
            writeFileSync(join(original, "commondir"), `${path.relative ? relative(original, root) : root}\n`);
          }

          if (path.root === "alternate") {
            root = join(dir, "main-alternate");
            renameSync(join(original, "objects"), root);
            mkdirSync(join(original, "objects/info"), { recursive: true });
            writeFileSync(
              join(original, "objects/info/alternates"),
              `${path.relative ? relative(join(original, "objects"), root) : root}\n`,
            );
          }

          const source = join(
            root,
            path.kind === "loose"
              ? `${path.root === "alternate" ? "" : "objects/"}${git(dir, "rev-parse", "HEAD").slice(0, 2)}`
              : path.kind.startsWith("generated")
                ? join("extra", ...path.parts, "saved")
                : path.root === "alternate"
                  ? path.kind.replace(/^objects\//, "")
                  : path.kind,
          );

          if (!existsSync(source)) {
            mkdirSync(join(source, ".."), { recursive: true });

            if (["generated-file", "packed-refs", "index"].includes(path.kind)) {
              writeFileSync(source, setup.branch);
            } else {
              mkdirSync(source);
            }
          }

          storage = join(
            path.location === "admin" ? admin : join(dir, "boxes", path.worktree, "node_modules"),
            ...path.parts,
            "borrowed",
          );
          mkdirSync(join(storage, ".."), { recursive: true });
          stored = path.through ? join(dir, "outside-storage") : storage;
          renameSync(source, stored);
          // Git names the admin folder by its real path; a relative link must use real paths
          // on both ends, or a linked temp folder (macOS /var) breaks it.
          const real = (at: string) => join(realpathSync(join(at, "..")), basename(at));
          const name = (from: string, to: string) => (path.relative ? relative(realpathSync(from), real(to)) : to);

          if (path.through) {
            symlinkSync(name(join(storage, ".."), stored), storage);
          }

          symlinkSync(name(join(source, ".."), storage), source);
        }

        if (stored) {
          savedStorage = storageFiles(stored);
        }

        expect(git(dir, "rev-list", "--objects", "--all")).toBe(history);
        const registered = git(dir, "worktree", "list", "--porcelain", "-z");
        expect(registered).toContain(`worktree ${realpathSync(join(dir, "boxes", worktree))}\0`);
      }

      if (setup.storage) {
        const path = setup.storage;
        const original = join(dir, ".git");
        storage = join(dir, "boxes", path.worktree, "node_modules", ...path.parts, "storage");
        mkdirSync(join(storage, ".."), { recursive: true });
        const name = (from: string, to: string) => (path.relative ? relative(from, to) : to);
        history = git(dir, "rev-list", "--objects", "--all");

        if (path.binding === "alternates-file") {
          const outside = join(dir, "outside-objects");
          renameSync(join(original, "objects"), outside);
          mkdirSync(join(original, "objects/info"), { recursive: true });
          writeFileSync(storage, `${name(join(original, "objects"), outside)}\n`);
          symlinkSync(name(join(original, "objects/info"), storage), join(original, "objects/info/alternates"));
        } else {
          const source = ["gitdir", "commondir"].includes(path.binding) ? original : join(original, "objects");
          const stored = path.through ? join(dir, "outside-storage") : storage;
          renameSync(source, stored);

          if (path.through) {
            symlinkSync(name(join(storage, ".."), stored), storage);
          }

          if (path.binding === "gitdir") {
            symlinkSync(name(dir, storage), original);
          }

          if (path.binding === "commondir") {
            mkdirSync(original);
            writeFileSync(join(original, "HEAD"), readFileSync(join(stored, "HEAD")));
            writeFileSync(join(original, "commondir"), `${name(original, storage)}\n`);
            // Linked worktrees already point through MAIN/.git/worktrees. Keep that
            // spelling valid while the common directory is borrowed from a worktree.
            symlinkSync(name(original, join(storage, "worktrees")), join(original, "worktrees"));
          }

          if (path.binding === "objects") {
            symlinkSync(name(original, storage), source);
          }

          if (path.binding === "alternates") {
            let next = storage;

            for (let i = 0; i < path.hops; i++) {
              const objects = i === path.hops - 1 ? source : join(dir, `alternate-${i}`);
              mkdirSync(join(objects, "info"), { recursive: true });
              writeFileSync(join(objects, "info/alternates"), `${name(objects, next)}\n`);
              next = objects;
            }
          }
        }

        expect(git(dir, "rev-list", "--objects", "--all")).toBe(history);
        expect(git(dir, "check-ignore", storage)).toBe(storage);
        const registered = git(dir, "worktree", "list", "--porcelain", "-z");

        for (const worktree of ["catchup-900", "driver"]) {
          expect(registered).toContain(`worktree ${realpathSync(join(dir, "boxes", worktree))}\0`);
        }
      }
    }

    writeFileSync(join(dir, "setup.json"), JSON.stringify(setup));

    for (const cmd of ["gh", "git", "node", "pnpm", "nice", "sleep", "date"]) {
      writeFileSync(join(bin, cmd), `#!${process.execPath}\n${stub}`, { mode: 0o755 });
    }

    const ran = spawnSync("sh", [script, "900", "520", ...args], {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: join(dir, "home"),
        FABRIKA_HOME: join(dir, "fh"),
        FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
        MAIN: main,
        BOXES: join(dir, "boxes"),
        REMOTE: "https://github.com/fixture/repo.git",
        GH_REPO: "fixture/repo",
        CATCHUP_FIXTURE: dir,
        CATCHUP_TIP: checkedTip,
        CATCHUP_MERGED: merged,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        TYPESAFE_API_KEY: undefined,
      },
    });
    expect(ran.error).toBeUndefined();
    expect(ran.signal).toBeNull();
    const posts: Post[] = (existsSync(join(dir, "posts.jsonl")) ? readFileSync(join(dir, "posts.jsonl"), "utf8") : "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const calls: Call[] = (existsSync(join(dir, "calls.jsonl")) ? readFileSync(join(dir, "calls.jsonl"), "utf8") : "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    // A run drops the lock it took and never one another run holds.
    expect(existsSync(join(dir, "boxes/catchup.lock"))).toBe(setup.lockHeld !== undefined);

    // Its own checkout is gone once the run passed the usage check, success or failure, unless it
    // holds MAIN's Git storage, or MAIN cannot be read to tell: then a line says why it stayed.
    if (calls.length > 0) {
      const guarded =
        /^kept worktree catchup-900: (holds MAIN Git storage|cannot read MAIN Git storage|MAIN, saved state or symlinked target|symlinked target)$/m.test(
          ran.stdout,
        );
      expect(existsSync(join(dir, "boxes/catchup-900")), ran.stdout).toBe(guarded);
      // A plain real MAIN, with no storage moved anywhere, never keeps it.
      const planted = setup.protected ?? setup.storage ?? setup.deepStorage ?? setup.sharedAdmin ?? setup.unwalkable;

      if (setup.cleanup && planted === undefined) {
        expect(guarded, ran.stdout).toBe(false);
      }
    }

    const remaining = readdirSync(join(dir, "boxes"));
    const keptHead = setup.cleanup
      ? spawnSync("/usr/bin/git", ["-C", dir, "rev-parse", "--verify", "refs/keep/pr/900"], {
          encoding: "utf8",
          env: localEnv,
        }).stdout.trim()
      : "";
    const state =
      setup.cleanup && existsSync(join(dir, "boxes/state/driver.md"))
        ? readFileSync(join(dir, "boxes/state/driver.md"), "utf8")
        : "";
    const inspectStorage = setup.storage || setup.deepStorage || setup.sharedAdmin || setup.unwalkable;
    const registrations = inspectStorage
      ? spawnSync("/usr/bin/git", ["-C", dir, "worktree", "list", "--porcelain", "-z"], {
          encoding: "utf8",
          env: localEnv,
        }).stdout
      : setup.cleanup
        ? git(dir, "worktree", "list", "--porcelain", "-z")
        : "";
    const after = inspectStorage
      ? spawnSync("/usr/bin/git", ["-C", dir, "rev-list", "--objects", "--all"], {
          encoding: "utf8",
          env: localEnv,
        })
      : undefined;
    return {
      code: ran.status,
      text: ran.stdout + ran.stderr,
      calls,
      posts,
      remaining,
      keptHead,
      checkedTip,
      state,
      registrations,
      storage: {
        exists: existsSync(storage),
        admin: existsSync(admin),
        saved: savedStorage,
        files: stored && existsSync(stored) ? storageFiles(stored) : {},
        history,
        code: after?.status,
        after: after?.stdout.trim(),
        error: after?.stderr,
      },
      protectedPair: [protectedWork, protectedData].map((path) => existsSync(path)),
      saved: saved && existsSync(saved) ? readFileSync(saved, "utf8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const merges = (calls: Call[]) => calls.filter((c) => c.key === "merge");

export const assertHead = (calls: Call[]) => {
  for (const call of merges(calls)) {
    expect(call.args).toContain("--match-head-commit");
    expect(call.args[call.args.indexOf("--match-head-commit") + 1]).toBe(tip);
  }

  for (const call of calls.filter((c) => c.key && ["checks", "trust", "apps"].includes(c.key))) {
    expect(call.args[1]).toContain(tip);
  }
};

// The nested-storage law (review3) runs 96 cases of three runs each, more than the rest of
// catchup.sh's laws together, so it is split by worktree over two files that vitest runs side by
// side: catchup.nested-storage-checkout.test.ts and catchup.nested-storage-driver.test.ts.
// Plant: review3's guard walks selected roots only and compares only the work folder.
// Generate storage in both the work folder and the admin directory Git also removes.
export const nestedStorage = (worktree: "catchup-900" | "driver") =>
  (["work", "admin"] as const).flatMap((location) =>
    (["gitdir", "common", "alternate"] as const).flatMap((root) =>
      ["objects/pack", "loose", "refs", "packed-refs", "logs", "index", "generated-file", "generated-folder"].map(
        (kind) => ({ worktree, location, root, kind }),
      ),
    ),
  );

export const keepsNestedStorage = ({ worktree, location, root, kind }: ReturnType<typeof nestedStorage>[number]) => {
  fc.assert(
    fc.property(
      fc.record({
        branch: fc.stringMatching(/^[a-z]{2,10}$/),
        parts: fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 6 }),
        through: fc.boolean(),
        relative: fc.boolean(),
      }),
      ({ branch, ...path }) => {
        const got = run({
          ...green,
          branch: `fabrikalfa/${branch}`,
          cleanup: "clean",
          deepStorage: { worktree, location, root, kind, ...path },
        });
        expect(got.code, got.text).toBe(0);
        expect(merges(got.calls)).toHaveLength(1);
        expect(got.remaining, got.text).toContain(worktree);
        expect(got.storage.admin, got.text).toBe(true);
        expect(got.storage.exists, got.text).toBe(true);
        expect(got.storage.files).toEqual(expect.objectContaining(got.storage.saved));
        expect(got.storage.code, got.storage.error).toBe(0);
        expect(got.storage.after).toBe(got.storage.history);
        expect(got.registrations).toContain(`/${worktree}\0`);
        expect(got.text).toMatch(new RegExp(`^kept worktree ${worktree}: [^\\n]+$`, "m"));
        expect(
          got.calls.some(
            (c) => c.cmd === "git" && c.args.includes("remove") && c.args.some((a) => a.endsWith(`/${worktree}`)),
          ),
        ).toBe(false);
        expect(got.keptHead).toBe(got.checkedTip);
        expect(got.state).toBe("saved wait");
      },
    ),
    { seed: 31862, numRuns: 3, endOnFailure: true },
  );
};
