// gc.ts: `box.sh gc [--dry-run]`. Remove the boxes whose work is safe somewhere else, so dead boxes
// never fill the disk again. Today's lead tooling, run on our own laptop; it is not product.
//
//   a box is kept while   a process has its cwd there, or its git index, HEAD log or folder changed
//                         in the last 2 h (lastTouched; gc's own reads write none of them),
//                         or drive kept it stuck less than 24 h ago and its lane has not landed,
//                         or it holds uncommitted or untracked files and its lane has not landed
//                         (a backup saves only HEAD, so they would be lost); once it landed, the
//                         files go first into the main checkout as a stash (keepFiles), and a box
//                         whose git data is not its own `<box>-gitdata` keeps them
//   else it is removed    when its branch (minus -wip) has a merged pull request, or its HEAD is
//                         on a remote branch; else its HEAD is pushed as the bot to <branch>-wip
//                         first (fabrikalfa/<box>-wip when that is refused), and kept if both fail
//   then                  every state/<box>.box whose box folder is gone is removed too, and every
//                         linked worktree of the main checkout outside the boxes folder whose
//                         lane landed (decideWorktree): its branch stays in the main checkout
//   and                   boxfiles.ts sweeps what a landed lane's gone boxes left beside the boxes:
//                         their files and mutation folders move to the main checkout's runs/, their
//                         views and Codex homes go (boxfiles.ts says when)
//
// A box's tree is in BOXES/box (lane.ts boxTree); one made before that layout is still in BOXES.
//
// A lane's pinned scripts (BOXES/pins/<lane>.<pid>, lane.ts pinFolder) are removed by the lane's own
// scope; a pin a killed lane left goes once no running process names it and it is older than IDLE
// (decidePin).
//
// Before any folder goes, keepruns.sh moves its runs/ (raw samples, never in git) into the main
// checkout's runs/<folder>/; when that fails, the folder is kept.
//
// Every keep is printed with its reason, so a box that never goes is seen (field note
// 2026-11-09-254: gc's own git status reset the idle clock, so for a day no box was ever removed).
//
// Last, mutbox.ts removes what the mutation container left in Docker (0045).
//
// It never runs a command inside a box: it reads the box's git data with hooks off, and fetches
// from it into the main checkout, as `box.sh fetch` does. One line per box removed, then a total.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { Result, Schema } from "effect";
import { boxTree, boxTrees, IDLE, oldBoxTree, pinsFolder, wipOf } from "./lane.ts";
import { GC_SECONDS } from "./mutbox.ts";
import { type PgrepAnswer, pgrepAnswer } from "./pgrep.ts";

const HOUR = 3_600_000;
export const STUCK = 24 * HOUR;

/** What gc saw of one box. All of it is read before anything is decided. */
export type Seen = {
  readonly name: string;
  /** `null`: no `.git` here, so it is not a box (a log folder, a half-made box). */
  readonly git: { readonly head: string | null; readonly branch: string | null } | null;
  /** The processes whose working folder is in the box. */
  readonly busy: readonly number[];
  /** Milliseconds since lastTouched. */
  readonly idle: number;
  /** Milliseconds since drive kept this box stuck; `null` when drive did not keep it. */
  readonly stuck: number | null;
  readonly merged: boolean;
  readonly onRemote: boolean;
  /** Uncommitted and untracked files in the box; `null` when git could not say. */
  readonly dirty: number | null;
};

export const Verdict = Schema.TaggedUnion({
  keep: { reason: Schema.String },
  remove: { reason: Schema.Literals(["merged", "closed", "on_remote"]) },
  backup: { to: Schema.Array(Schema.String) },
});
export type Verdict = typeof Verdict.Type;
const keep = (reason: string) => Verdict.cases.keep.make({ reason });
const remove = (reason: "merged" | "closed" | "on_remote") => Verdict.cases.remove.make({ reason });

/** What gc does with one lane's pinned scripts. */
export const PinVerdict = Schema.TaggedUnion({
  keep: { reason: Schema.String },
  remove: { reason: Schema.String },
});
export type PinVerdict = typeof PinVerdict.Type;

/** The branch a box's commits are backed up to, best first. */
export const backupsOf = (name: string, branch: string | null): string[] => {
  const own = `fabrikalfa/${name}-wip`;
  const wip = branch === null ? null : wipOf(branch);
  return wip?.startsWith("fabrikalfa/") && wip !== own ? [wip, own] : [own];
};

/** The `state/*.box` files whose box folder is gone: facts of a dead box, which stepcommit would
 * otherwise still read. A box saves its facts only after its folder exists, so none is half made. */
export const deadFacts = (files: readonly string[], boxes: ReadonlySet<string>): string[] =>
  files.filter((f) => f.endsWith(".box") && !boxes.has(f.slice(0, -".box".length)));

/**
 * The Check for one lane's pinned scripts, pure. A pin goes only when no process names it and it is
 * IDLE old; a process list pgrep cannot read keeps it, never reads as none running.
 */
export const decidePin = (holders: PgrepAnswer, idle: number): PinVerdict =>
  holders._tag === "refused"
    ? PinVerdict.cases.keep.make({ reason: "pgrep cannot list processes, so a lane may still run from it" })
    : holders.count > 0
      ? PinVerdict.cases.keep.make({ reason: `${holders.count} running processes name it` })
      : idle < IDLE
        ? PinVerdict.cases.keep.make({ reason: "made less than 2 h ago" })
        : PinVerdict.cases.remove.make({ reason: "no running process names it" });

/** The Check, pure. */
export const decide = (s: Seen): Verdict => {
  if (s.git === null) {
    return keep("not a git checkout");
  }

  if (s.busy.length > 0) {
    return keep(`a process is working in it (pid ${s.busy.join(", ")})`);
  }

  if (s.idle < IDLE) {
    return keep(`touched ${Math.round(s.idle / 60_000)} min ago`);
  }

  // A stuck box is kept for the lead to read, until its lane lands (0019).
  if (s.stuck !== null && s.stuck < STUCK && !s.merged) {
    return keep(`stuck, kept by drive ${Math.round(s.stuck / HOUR)} h ago`);
  }

  if (s.git.head === null) {
    return keep("no HEAD commit");
  }

  // A backup pushes HEAD only, so files never committed would go with the folder (field note
  // 2026-11-09-42: a box removed with 10 uncommitted product files). The lead saves or drops them,
  // until the lane lands: then gc keeps them in the main checkout first (`refs/keep/box/<box>-files`,
  // a stash), since a drive box never commits and so always holds its step's files uncommitted.
  if (s.dirty === null) {
    return keep("its files could not be read");
  }

  if (s.dirty > 0 && !s.merged) {
    return keep(`${s.dirty} uncommitted files`);
  }

  if (s.merged) {
    return remove("merged");
  }

  if (s.onRemote) {
    return remove("on_remote");
  }

  return Verdict.cases.backup.make({ to: backupsOf(s.name, s.git.branch) });
};

/** What gc saw of one linked worktree of the main checkout, outside the boxes folder. */
export type SeenWorktree = {
  readonly branch: string | null;
  readonly locked: boolean;
  readonly busy: readonly number[];
  readonly idle: number;
  readonly dirty: number | null;
  /** The pull requests holding its work (worktreePrs): what state each is in. */
  readonly prs: readonly PrState[];
};

export type PrState = "OPEN" | "MERGED" | "CLOSED";

/** The pull requests holding a worktree's work: those of its own branch (minus -wip), of every
 * remote branch whose tip is its HEAD, and every one whose head commit is its HEAD. A lead's
 * worktree is often pushed under another name (botpush to fabrikalfa/<lane>), so its own branch
 * name alone missed a merged lane and gc kept it for good (2026-11-09: PR 623's worktree). */
export const worktreePrs = (
  w: {
    readonly branch: string | null;
    readonly head: string | null;
    readonly tips: readonly string[];
  },
  byRef: ReadonlyMap<string, readonly PrState[]>,
  byHead: ReadonlyMap<string, readonly PrState[]>,
): PrState[] => [
  ...(w.branch === null ? [] : (byRef.get(w.branch.replace(/(-wip)+$/, "")) ?? [])),
  ...w.tips.flatMap((t) => byRef.get(t.replace(/(-wip)+$/, "")) ?? []),
  ...(w.head === null ? [] : (byHead.get(w.head) ?? [])),
];

/** A worktree goes once its lane landed, clean and idle. Its branch stays in the main checkout, so
 * only the folder goes; a worktree with no lane branch is someone's own and stays. */
export const decideWorktree = (w: SeenWorktree): Verdict => {
  if (w.locked) {
    return keep("locked");
  }

  if (w.busy.length > 0) {
    return keep(`a process is working in it (pid ${w.busy.join(", ")})`);
  }

  if (w.idle < IDLE) {
    return keep(`touched ${Math.round(w.idle / 60_000)} min ago`);
  }

  if (w.branch === null) {
    return keep("no branch checked out");
  }

  if (w.dirty === null) {
    return keep("its files could not be read");
  }

  if (w.dirty > 0) {
    return keep(`${w.dirty} uncommitted files`);
  }

  if (w.prs.includes("OPEN")) {
    return keep("its pull request is open");
  }

  if (w.prs.includes("MERGED")) {
    return remove("merged");
  }

  if (w.prs.includes("CLOSED")) {
    return remove("closed");
  }

  return keep("no pull request yet");
};

// ---------------------------------------------------------------- the world

// GIT_OPTIONAL_LOCKS=0: git status then never refreshes the index or makes index.lock, so a read
// leaves every mtime lastTouched reads as it was.
const sh = (cmd: string, args: readonly string[], cwd?: string) => {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
};

const SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

type Env = { readonly MAIN: string; readonly BOXES: string; readonly GH_REPO: string };

const loadEnv = (): Env => {
  const r = sh("sh", [
    "-c",
    '. "$0" && printf "%s\\n%s\\n%s\\n" "$MAIN" "$BOXES" "$GH_REPO"',
    join(import.meta.dirname, "env.sh"),
  ]);
  const [MAIN = "", BOXES = "", GH_REPO = ""] = r.out.split("\n");

  if (r.code !== 0 || !MAIN || !BOXES) {
    throw new Error(`env.sh failed: ${r.err}`);
  }

  return { MAIN, BOXES, GH_REPO };
};

/** How many uncommitted and untracked files a box holds, read from its git data with hooks and
 * fsmonitor off; `null` when git cannot say. */
export const dirtyIn = (gitDir: string, box: string): number | null => {
  const r = sh("git", [
    ...SAFE,
    "-c",
    "status.renames=false",
    `--git-dir=${gitDir}`,
    `--work-tree=${box}`,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  // No rename pairs, so each NUL-ended entry is one file.
  return r.code === 0 ? r.out.split("\0").filter(Boolean).length : null;
};

/** Keep a box's uncommitted and untracked files in `main` at `ref`, as one stash commit (`git stash
 * push -u`, ignored files left out), read and fetched with hooks and fsmonitor off; false: not kept. */
export const keepFiles = (gitDir: string, box: string, main: string, ref: string): boolean =>
  sh(
    "git",
    [
      ...SAFE,
      `--git-dir=${gitDir}`,
      `--work-tree=${box}`,
      "-c",
      "user.name=gc",
      "-c",
      "user.email=gc@localhost",
      "stash",
      "push",
      "-q",
      "-u",
    ],
    box,
  ).code === 0 && sh("git", ["-C", main, ...SAFE, "fetch", "-q", "-f", gitDir, `refs/stash:${ref}`]).code === 0;

/** The folder a box's `.git` file points at, or the `.git` folder itself. */
const gitDirOf = (box: string): string | null => {
  const dot = join(box, ".git");

  if (!existsSync(dot)) {
    return null;
  }

  if (statSync(dot).isDirectory()) {
    return dot;
  }

  const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, "utf8"));

  if (!m?.[1]) {
    return null;
  }

  return isAbsolute(m[1].trim()) ? m[1].trim() : resolve(box, m[1].trim());
};

const mtime = (path: string) => (existsSync(path) ? statSync(path).mtimeMs : 0);

/** When the HEAD log's newest entry was written, from its own time stamp, in ms; 0 when none. Not
 * the file's mtime: git gc's reflog expiry rewrites every worktree's log and so changes that. */
export const lastLogged = (log: string): number => {
  if (!existsSync(log)) {
    return 0;
  }

  const last = readFileSync(log, "utf8").trimEnd().split("\n").at(-1) ?? "";
  const m = / (\d+) [+-]\d{4}\t/.exec(last);
  return m?.[1] ? Number(m[1]) * 1000 : 0;
};

/** When work last happened in a box: the newest of its folder (a box being made), its index (an
 * add, a checkout) and its HEAD log's newest entry (a commit, a reset). Never the git data folder
 * itself: any git command's lock files change that. */
export const lastTouched = (box: string, gitDir: string | null): number =>
  Math.max(
    mtime(box),
    gitDir === null ? 0 : Math.max(mtime(join(gitDir, "index")), lastLogged(join(gitDir, "logs", "HEAD"))),
  );

/** Every working folder some process sits in, with its pid, from one lsof call. */
const cwds = (): { readonly pid: number; readonly path: string }[] => {
  const out: { pid: number; path: string }[] = [];
  let pid = 0;

  for (const l of sh("lsof", ["-a", "-d", "cwd", "-Fpn"]).out.split("\n")) {
    if (l.startsWith("p")) {
      pid = Number(l.slice(1));
    } else if (l.startsWith("n/")) {
      out.push({ pid, path: l.slice(1) });
    }
  }

  return out;
};

const pidsIn = (busyIn: readonly { pid: number; path: string }[], dir: string) => [
  ...new Set(busyIn.filter((c) => c.path === dir || c.path.startsWith(`${dir}/`)).map((c) => c.pid)),
];

/** Box name to when drive kept it stuck, from `state/<lane>.json`. */
const keptByDrive = (boxes: string): Map<string, number> => {
  const kept = new Map<string, number>();
  const dir = join(boxes, "state");

  if (!existsSync(dir)) {
    return kept;
  }

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    // A state file that does not read is skipped, from the step where it stopped reading.
    Result.try(() => {
      const lane = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        steps?: { box?: string; kept?: boolean; ended?: string }[];
      };

      for (const step of lane.steps ?? []) {
        if (step.kept && step.box) {
          kept.set(step.box, Date.parse(step.ended ?? "") || Date.now());
        }
      }
    });
  }

  return kept;
};

const sizeMb = (paths: readonly string[]) => {
  const there = paths.filter(existsSync);

  if (there.length === 0) {
    return 0;
  }

  const r = sh("du", ["-sk", ...there]);
  return Math.round(
    r.out
      .split("\n")
      .filter(Boolean)
      .reduce((n, l) => n + Number(l.split("\t")[0] ?? 0), 0) / 1024,
  );
};

/** Move a folder's runs/ into the main checkout's runs/ before it is removed; false: keep it. */
const keepRuns = (dir: string): boolean => {
  const r = sh("sh", [join(import.meta.dirname, "keepruns.sh"), dir]);

  if (r.out.trim()) {
    console.log(r.out.trim());
  }

  return r.code === 0;
};

const main = () => {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");

  if (args.some((a) => a !== "--dry-run")) {
    console.error("usage: box.sh gc [--dry-run]");
    process.exit(2);
  }

  const env = loadEnv();

  if (!existsSync(env.BOXES)) {
    console.log("gc: no boxes folder");
    return;
  }

  const repo = (...a: string[]) => sh("git", ["-C", env.MAIN, ...SAFE, ...a]);
  const common = resolve(env.MAIN, repo("rev-parse", "--git-common-dir").out.trim());
  repo("fetch", "-q", "origin");
  const prsOf = new Map<string, PrState[]>();
  const prsAt = new Map<string, PrState[]>();
  const listed = sh("gh", [
    "pr",
    "list",
    "-R",
    env.GH_REPO,
    "--state",
    "all",
    "--limit",
    "5000",
    "--json",
    "headRefName,headRefOid,state",
    "-q",
    '.[] | "\\(.state) \\(.headRefName) \\(.headRefOid)"',
  ]);

  if (listed.code !== 0) {
    console.error(`gc: gh could not list pull requests: ${listed.err.trim()}`);
    process.exit(1);
  }

  for (const line of listed.out.split("\n")) {
    const [state, ref, oid] = line.split(" ");

    if (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") {
      continue;
    }

    if (ref) {
      prsOf.set(ref, [...(prsOf.get(ref) ?? []), state]);
    }

    if (oid) {
      prsAt.set(oid, [...(prsAt.get(oid) ?? []), state]);
    }
  }

  const merged = new Set([...prsOf].filter(([, s]) => s.includes("MERGED")).map(([r]) => r));
  const busyIn = cwds();
  const kept = keptByDrive(env.BOXES);
  const now = Date.now();
  let removed = 0;
  let freed = 0;
  let keptCount = 0;
  const foldersIn = (dir: string, skip: (name: string) => boolean) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !skip(d.name))
          .map((d) => d.name)
      : [];
  const boxes = [
    ...foldersIn(boxTrees(env.BOXES), (n) => n.endsWith("-view")).map((name) => ({
      name,
      box: boxTree(env.BOXES, name),
    })),
    ...foldersIn(env.BOXES, (n) => n === "state" || n === "box" || n === "pins" || n.endsWith("-gitdata")).map(
      (name) => ({
        name,
        box: oldBoxTree(env.BOXES, name),
      }),
    ),
  ].sort((a, b) => a.name.localeCompare(b.name));
  // The boxes this run removed, or would remove: boxfiles.ts sweeps only a box whose tree is gone.
  const gone: string[] = [];

  for (const { name, box } of boxes) {
    const gitDir = gitDirOf(box);
    const git =
      gitDir === null
        ? null
        : (() => {
            const g = (...a: string[]) => sh("git", [...SAFE, `--git-dir=${gitDir}`, ...a]);
            const head = g("rev-parse", "--verify", "-q", "HEAD^{commit}").out.trim() || null;
            const branch = g("symbolic-ref", "-q", "--short", "HEAD").out.trim() || null;
            return { head, branch };
          })();
    const head = git?.head ?? null;
    const inMain = head !== null && repo("cat-file", "-e", `${head}^{commit}`).code === 0;
    const onRemote =
      inMain && repo("for-each-ref", "--count=1", "--contains", head, "refs/remotes/origin").out.trim() !== "";
    const branch = git?.branch?.replace(/(-wip)+$/, "") ?? null;
    const seen: Seen = {
      name,
      git,
      busy: pidsIn(busyIn, box),
      idle: now - lastTouched(box, gitDir),
      stuck: kept.has(name) ? now - (kept.get(name) ?? now) : null,
      merged: branch !== null && merged.has(branch),
      onRemote,
      dirty: gitDir === null ? null : dirtyIn(gitDir, box),
    };
    const verdict = decide(seen);

    if (verdict._tag === "keep") {
      console.log(`keep ${name}: ${verdict.reason}`);
      keptCount += 1;
      continue;
    }

    let reason: string = verdict._tag === "remove" ? verdict.reason : "";

    // A merged lane's box may hold commits no remote has: keep its HEAD in the main checkout.
    if (verdict._tag === "remove" && !onRemote && !dry) {
      if (repo("fetch", "-q", "-f", box, `HEAD:refs/keep/box/${name}`).code !== 0) {
        console.log(`keep ${name}: could not save its HEAD`);
        keptCount += 1;
        continue;
      }

      reason += `, HEAD kept at refs/keep/box/${name}`;
    }

    // A landed lane's box with files never committed: they go into the main checkout as a stash, the
    // untracked ones too (git ignores node_modules), before the folder goes.
    if (verdict._tag === "remove" && (seen.dirty ?? 0) > 0) {
      const kept = `refs/keep/box/${name}-files`;

      // Only a box's own git data: a stash in a worktree of the main checkout would land in its refs.
      if (gitDir !== join(env.BOXES, `${name}-gitdata`)) {
        console.log(`keep ${name}: ${seen.dirty} uncommitted files`);
        keptCount += 1;
        continue;
      }

      if (!dry) {
        if (!keepFiles(gitDir, box, env.MAIN, kept)) {
          console.log(`keep ${name}: could not keep its ${seen.dirty} uncommitted files`);
          keptCount += 1;
          continue;
        }
      }

      reason += `, ${seen.dirty} uncommitted files ${dry ? "would be " : ""}kept at ${kept}`;
    }

    if (verdict._tag === "backup") {
      if (dry) {
        reason = `would back up to ${verdict.to[0]}`;
      } else {
        // Fetch the box's HEAD and step notes into the main checkout, then push from there.
        const ref = `refs/gc/${name}`;

        if (repo("fetch", "-q", "-f", box, `HEAD:${ref}`).code !== 0) {
          console.log(`keep ${name}: could not fetch its HEAD`);
          keptCount += 1;
          continue;
        }

        if (repo("fetch", "-q", "-f", box, `refs/notes/fabrika:refs/notes/box-${name}`).code === 0) {
          repo("notes", "--ref=fabrika", "merge", "-q", "-s", "cat_sort_uniq", `box-${name}`);
        }

        const pushed = verdict.to.find(
          (to) => sh("node", [join(import.meta.dirname, "botpush.mjs"), env.MAIN, to, ref]).code === 0,
        );
        repo("update-ref", "-d", ref);

        if (pushed === undefined) {
          console.log(`keep ${name}: backup push refused (${verdict.to.join(", ")})`);
          keptCount += 1;
          continue;
        }

        reason = `backed up to ${pushed}`;
      }
    }

    const twin = gitDir === join(env.BOXES, `${name}-gitdata`) ? [gitDir] : [];
    const mb = sizeMb([box, ...twin]);

    if (!dry && !keepRuns(box)) {
      console.log(`keep ${name}: could not keep its runs/`);
      keptCount += 1;
      continue;
    }

    if (!dry) {
      if (gitDir?.startsWith(`${join(common, "worktrees")}/`)) {
        repo("worktree", "remove", "--force", "--force", box);
      }

      rmSync(box, { recursive: true, force: true });

      for (const t of twin) {
        rmSync(t, { recursive: true, force: true });
      }
    }

    removed += 1;
    freed += mb;
    gone.push(name);
    console.log(`${dry ? "would remove" : "removed"} ${name}: ${reason}, ${mb} MB`);
  }

  const state = join(env.BOXES, "state");
  const left = new Set([...foldersIn(boxTrees(env.BOXES), () => false), ...foldersIn(env.BOXES, () => false)]);
  const dead = existsSync(state) ? deadFacts(readdirSync(state), left) : [];

  for (const f of dead) {
    if (!dry) {
      rmSync(join(state, f), { force: true });
    }

    console.log(`${dry ? "would remove" : "removed"} state/${f}: its box is gone`);
  }

  // A lane's pinned scripts: its own scope removes them, so one left here is a lane that was
  // killed. It goes once no running process names it and it is older than IDLE.
  const pins = pinsFolder(env.BOXES);

  for (const name of foldersIn(pins, () => false)) {
    const folder = join(pins, name);
    const holders = sh("pgrep", ["-f", folder]);
    const verdict = decidePin(pgrepAnswer(holders.code, holders.out), now - statSync(folder).mtimeMs);

    if (verdict._tag === "remove" && !dry) {
      rmSync(folder, { recursive: true, force: true });
    }

    console.log(
      verdict._tag === "keep"
        ? `keep pins/${name}: ${verdict.reason}`
        : `${dry ? "would remove" : "removed"} pins/${name}: ${verdict.reason}`,
    );
  }

  // What a landed lane's gone boxes left beside the boxes. Landed is the lane's own branch with a
  // merged pull request and no open one, from the listing above: boxfiles.ts judges it per lane.
  const swept = spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, "boxfiles.ts"),
      "--boxes",
      env.BOXES,
      "--main",
      env.MAIN,
      ...(dry ? ["--dry-run"] : []),
      ...gone.flatMap((name) => ["--gone", name]),
      ...[...prsOf].flatMap(([ref, states]) => [
        ...(states.includes("MERGED") ? ["--merged", ref] : []),
        ...(states.includes("OPEN") ? ["--open", ref] : []),
      ]),
    ],
    { encoding: "utf8" },
  );
  process.stdout.write(swept.stdout ?? "");
  process.stderr.write(swept.stderr ?? "");

  if (!dry) {
    repo("worktree", "prune");
  }

  // Linked worktrees outside the boxes folder: a lead's or an agent's own checkout of a lane.
  let trees = 0;
  const blocks = repo("worktree", "list", "--porcelain").out.split("\n\n").filter(Boolean);

  for (const block of blocks.slice(1)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9) ?? "";

    if (!path || path === env.MAIN || path.startsWith(`${env.BOXES}/`) || !existsSync(path)) {
      continue;
    }

    const ref = lines.find((l) => l.startsWith("branch "))?.slice("branch refs/heads/".length);
    const gitDir = gitDirOf(path);
    const branch = ref ?? null;
    const head = lines.find((l) => l.startsWith("HEAD "))?.slice(5) ?? null;
    const tips =
      head === null
        ? []
        : repo("for-each-ref", "--points-at", head, "--format=%(refname:lstrip=3)", "refs/remotes/origin")
            .out.split("\n")
            .filter(Boolean);
    const verdict = decideWorktree({
      branch,
      locked: lines.some((l) => l === "locked" || l.startsWith("locked ")),
      busy: pidsIn(busyIn, path),
      idle: now - lastTouched(path, gitDir),
      dirty: gitDir === null ? null : dirtyIn(gitDir, path),
      prs: worktreePrs({ branch, head, tips }, prsOf, prsAt),
    });

    if (verdict._tag !== "remove") {
      console.log(`keep worktree ${path}: ${verdict._tag === "keep" ? verdict.reason : ""}`);
      keptCount += 1;
      continue;
    }

    const mb = sizeMb([path]);

    if (!dry && !keepRuns(path)) {
      console.log(`keep worktree ${path}: could not keep its runs/`);
      keptCount += 1;
      continue;
    }

    // Without --force: git itself refuses a worktree with changes, a second guard.
    if (!dry && repo("worktree", "remove", path).code !== 0) {
      console.log(`keep worktree ${path}: git worktree remove refused`);
      keptCount += 1;
      continue;
    }

    trees += 1;
    freed += mb;
    console.log(`${dry ? "would remove" : "removed"} worktree ${path}: ${verdict.reason}, ${mb} MB`);
  }

  // The mutation container's leftovers (0045): a container a dead run left, and images over a
  // week old. mutbox.ts knows which are safe to remove, and keeps a live run's. Each of its Docker
  // calls has its own bound; GC_SECONDS is a second guard, so a hung Docker never holds the chain
  // (2026-11-10: a `docker ps` here never returned, and two lanes sat 1 h 50 min).
  if (!dry) {
    const swept = spawnSync(
      process.execPath,
      [join(import.meta.dirname, "mutbox.ts"), "gc", "--lock", join(env.BOXES, "state", "docker.lock")],
      { encoding: "utf8", timeout: GC_SECONDS * 1000 },
    );
    process.stdout.write(swept.stdout ?? "");

    if (swept.error !== undefined) {
      console.log(`mutbox gc: stopped after ${GC_SECONDS} s (${swept.error.message}); the rest waits for the next gc`);
    }
  }

  console.log(
    `gc: ${dry ? "would remove" : "removed"} ${removed} boxes and ${trees} worktrees, ${freed} MB; kept ${keptCount}`,
  );
};

if (import.meta.main) {
  main();
}
