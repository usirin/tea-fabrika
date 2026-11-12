// boxfiles.ts: what a landed lane's boxes left beside the boxes, swept. gc runs it last; today's
// lead tooling, run on our own laptop, not product.
//
//   node boxfiles.ts --boxes <BOXES> --main <MAIN> [--dry-run] [--gone <box>]... [--merged <branch>]... [--open <branch>]...
//
// drive, chain and the lead keep each box's prompt, report, events, logs and mutation folder beside
// the boxes (`BOXES/<box>.md`, `BOXES/<box>-mutbox/`, `BOXES/state/<box>.rows.jsonl`, ...), and the
// harness keeps a Codex home per tree. Nothing removed them: 5,900 names and 9.5 GB of Codex homes
// by 2026-11-11 (ticket 601). A box's files go once all of these hold:
//
//   its lane landed     every lane whose state file (`state/<lane>.json`) names the box has a
//                       branch with a merged pull request and no open one (`--merged`, `--open`:
//                       gc's own listing). A chain's judgment box `<lane>-judge<n>` is its lane's.
//   its tree is gone    neither `BOXES/box/<box>` nor an older `BOXES/<box>`, unless gc removes it
//                       this run (`--gone`): a tree gc keeps, it keeps for a reason it printed
//   nothing is fresh    no file of the box changed in the last 2 h (gc's IDLE). Age only keeps.
//
// Then content moves into MAIN's `runs/boxes/<lane>/` (ignored by git, the owner's private archive,
// 0027), never deleted: a report or an event stream is the run's own record. A git view (a
// hard-linked mirror of MAIN's git data) is removed, and so is the box's Codex home, after its
// `sessions/` moves too.
//
// Edge cases, each with a test in boxfiles.test.ts:
//   1. landed is a merged PR on the lane's branch (less -wip) and no open one; an open one (the
//      branch used again), only a closed one, none, or a state with no branch: not landed
//   2. a box two lanes name goes only when both landed
//   3. a box whose tree is there, in either layout, stays unless gc removes it this run
//   4. a box with a file changed in the last 2 h stays
//   5. a file belongs to the longest box or lane name it starts with, then `.` or `-`: box
//      `t5-tests1` does not take `t5-tests10.md`, and box `a-tests1` does not take lane
//      `a-tests1`'s `a-tests1-rows.jsonl`
//   6. a lane's own files (its rows, plan, chain briefs) are never touched: rows may not be in
//      field/ yet
//   7. a box's git data (`-gitdata`) and sign worktree (`-sign`) are never touched: git data may
//      hold commits only the box's rm command proves safe, and git owns a worktree
//   8. a move never overwrites: a name taken under runs/ gets `-<n>`
//   9. a link is moved or removed as a link, never followed
//  10. a move or removal that fails keeps the box's other files, and says so
//  11. the main checkout's Codex home (plan and judgment turns run there) is never removed
//  12. a dry run moves and removes nothing, and prints the same lines with "would"
//
// Looked at first (0040): `tmpreaper`/`tmpwatch` and `find -mtime -delete` remove by age alone,
// which this must not; `logrotate` rotates files a program keeps writing, not files of a finished
// job; `git clean` sees only a checkout. None knows when a lane landed, which is the rule here.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { codexHomeOf } from "@kampus/fabrika-old/agents/acp";
import { Clock, Console, Effect, FileSystem, Option, Path, Schema, Stream } from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";
import { boxTree, boxView, IDLE, oldBoxTree } from "./lane.ts";

/** What boxfiles reads of a lane's state file (drive writes it). */
export const LaneState = Schema.Struct({
  lane: Schema.String,
  branch: Schema.optional(Schema.String),
  steps: Schema.optional(Schema.Array(Schema.Struct({ box: Schema.optional(Schema.String) }))),
});
export type LaneState = typeof LaneState.Type;

/** Whether a lane landed: its branch, less -wip, has a merged pull request and no open one. */
export const hasLanded = (
  branch: string | undefined,
  merged: ReadonlySet<string>,
  open: ReadonlySet<string>,
): boolean => {
  if (branch === undefined) {
    return false;
  }

  const own = branch.replace(/(-wip)+$/, "");
  return merged.has(own) && !open.has(own) && !open.has(`${own}-wip`);
};

/** The name a file belongs to: the longest of `names` it starts with, then `.` or `-`; else `null`. */
export const ownerName = (file: string, names: Iterable<string>): string | null => {
  let best: string | null = null;

  for (const name of names) {
    const next = file.charAt(name.length);

    if (file.startsWith(name) && (next === "." || next === "-") && name.length > (best?.length ?? -1)) {
      best = name;
    }
  }

  return best;
};

/** What happens to one entry of a box, by what follows the box's name. */
export const fateFor = (rest: string): "move" | "remove" | "leave" =>
  rest === "-gitdata" || rest === "-sign" ? "leave" : rest === "-view" ? "remove" : "move";

/** A chain's judgment box, by its file name: `<lane>-judge<n>` and a suffix. */
const JUDGE = /^(.+-judge\d+)[.-]/;

/** Each box, with the lanes that name it, from the lanes' state files and the names beside the boxes. */
export const boxLanes = (lanes: readonly LaneState[], names: readonly string[]): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  const add = (box: string, lane: string) => out.set(box, [...new Set([...(out.get(box) ?? []), lane])]);

  for (const l of lanes) {
    for (const step of l.steps ?? []) {
      if (step.box) {
        add(step.box, l.lane);
      }
    }
  }

  const laneNames = new Set(lanes.map((l) => l.lane));

  for (const name of names) {
    const judge = JUDGE.exec(name)?.[1];
    const lane = judge?.replace(/-judge\d+$/, "");

    if (judge !== undefined && lane !== undefined && laneNames.has(lane)) {
      add(judge, lane);
    }
  }

  return out;
};

export const Verdict = Schema.TaggedUnion({
  keep: { reason: Schema.String },
  sweep: {},
});
export type Verdict = typeof Verdict.Type;

/** The Check, pure: whether a box's files go now. */
export const judgeBox = (b: {
  readonly landed: readonly boolean[];
  readonly tree: boolean;
  readonly gone: boolean;
  /** Milliseconds since its newest file changed. */
  readonly idle: number;
}): Verdict => {
  if (b.landed.length === 0 || b.landed.includes(false)) {
    return Verdict.cases.keep.make({ reason: "its lane has not landed" });
  }

  if (b.tree && !b.gone) {
    return Verdict.cases.keep.make({ reason: "its tree is still there" });
  }

  if (b.idle < IDLE) {
    return Verdict.cases.keep.make({ reason: `a file changed ${Math.round(b.idle / 60_000)} min ago` });
  }

  return Verdict.cases.sweep.make({});
};

// ---------------------------------------------------------------- the world

const text = (stream: Stream.Stream<Uint8Array, unknown>) => stream.pipe(Stream.decodeText(), Stream.mkString);

/** How many KB `du` says the paths hold; 0 when it cannot say. `du` counts a link, never its target. */
const sizeKb = Effect.fnUntraced(
  function* (paths: ReadonlyArray<string>) {
    if (paths.length === 0) {
      return 0;
    }

    const ran = yield* ChildProcess.make("du", ["-sk", ...paths]);
    const out = yield* text(ran.stdout);
    return out
      .split("\n")
      .filter(Boolean)
      .reduce((n, l) => n + (Number(l.split("\t")[0]) || 0), 0);
  },
  Effect.scoped,
  Effect.catch(() => Effect.succeed(0)),
);

const mb = (kb: number) => Math.round(kb / 1024);

type Entry = { readonly path: string; readonly name: string; readonly fate: "move" | "remove"; readonly to: string };

export const sweep = Effect.fn("boxfiles.sweep")(function* (o: {
  readonly boxes: string;
  readonly main: string;
  readonly dry: boolean;
  readonly gone: ReadonlySet<string>;
  readonly merged: ReadonlySet<string>;
  readonly open: ReadonlySet<string>;
  readonly home: { readonly HOME?: string | undefined };
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const would = o.dry ? "would " : "";
  const list = (dir: string) => fs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([] as string[])));
  const there = (p: string) => fs.exists(p).pipe(Effect.catch(() => Effect.succeed(false)));
  /** Move `from` to `to`, or to the first of `to-1`, `to-2`, ... that is free: nothing is overwritten. */
  const moveTo = Effect.fnUntraced(function* (from: string, to: string) {
    yield* fs.makeDirectory(path.dirname(to), { recursive: true });
    let free = to;

    for (let n = 1; yield* fs.exists(free); n += 1) {
      free = `${to}-${n}`;
    }

    yield* fs.rename(from, free);
  });
  const state = path.join(o.boxes, "state");
  const lanes: LaneState[] = [];

  for (const file of yield* list(state)) {
    if (!file.endsWith(".json") || file.endsWith("-chain.json")) {
      continue;
    }

    const read = yield* fs.readFileString(path.join(state, file)).pipe(Effect.option);
    const lane = Option.flatMap(read, Schema.decodeUnknownOption(Schema.fromJsonString(LaneState)));

    if (Option.isSome(lane)) {
      lanes.push(lane.value);
    }
  }

  const beside = yield* list(o.boxes);
  const inState = yield* list(state);
  const owners = boxLanes(lanes, beside);
  const landed = new Map(lanes.map((l) => [l.lane, hasLanded(l.branch, o.merged, o.open)]));
  // Lane names count for ownership, so a lane's own files are never a box's (edge 5, 6).
  const names = [...owners.keys(), ...landed.keys()];
  const byBox = new Map<string, Entry[]>();
  const add = (dir: string, under: string) => (name: string) => {
    const owner = ownerName(name, names);

    if (owner === null || !owners.has(owner)) {
      return;
    }

    const fate = fateFor(name.slice(owner.length));
    const lane = owners.get(owner)?.[0] ?? "";

    if (fate !== "leave") {
      const to = path.join(o.main, "runs", "boxes", lane, under, name);
      byBox.set(owner, [...(byBox.get(owner) ?? []), { path: path.join(dir, name), name, fate, to }]);
    }
  };
  beside.forEach(add(o.boxes, ""));
  inState.forEach(add(state, "state"));
  // Names no lane's state file accounts for: an older box's, a lane's own, or the lead's by hand.
  const unclaimed = beside.filter((name) => !owners.has(ownerName(name, names) ?? "")).length;
  const now = yield* Clock.currentTimeMillis;
  const mainHome = codexHomeOf(o.main, o.home);
  const totals = { boxes: 0, moved: 0, movedKb: 0, removedKb: 0, waiting: 0, held: 0 };
  const lanesSwept = new Set<string>();

  for (const [box, named] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
    const trees = [boxTree(o.boxes, box), oldBoxTree(o.boxes, box)];
    const homes = trees.map((t) => codexHomeOf(t, o.home)).filter((h) => h !== mainHome);
    const entries = [...(byBox.get(box) ?? [])];
    const view = boxView(o.boxes, box);

    if (yield* there(view)) {
      entries.push({ path: view, name: path.basename(view), fate: "remove", to: "" });
    }

    for (const home of homes) {
      if (yield* there(home)) {
        const sessions = path.join(home, "sessions");
        const lane = named[0] ?? "";

        if (yield* there(sessions)) {
          const to = path.join(o.main, "runs", "boxes", lane, `${box}-codex-sessions`);
          entries.push({ path: sessions, name: `${box} Codex sessions`, fate: "move", to });
        }

        entries.push({ path: home, name: `${box} Codex home`, fate: "remove", to: "" });
      }
    }

    if (entries.length === 0) {
      continue;
    }

    let newest = 0;

    for (const e of entries) {
      const info = yield* fs.stat(e.path).pipe(Effect.option);
      newest = Math.max(
        newest,
        Option.getOrElse(
          Option.flatMap(info, (i) => i.mtime.pipe(Option.map((d) => d.getTime()))),
          () => 0,
        ),
      );
    }

    const verdict = judgeBox({
      landed: named.map((l) => landed.get(l) ?? false),
      tree: (yield* there(trees[0] ?? "")) || (yield* there(trees[1] ?? "")),
      gone: o.gone.has(box),
      idle: now - newest,
    });

    if (verdict._tag === "keep") {
      if (verdict.reason === "its lane has not landed") {
        totals.waiting += 1;
      } else {
        totals.held += 1;
        yield* Console.log(`keep files of ${box}: ${verdict.reason}`);
      }

      continue;
    }

    const moves = entries.filter((e) => e.fate === "move");
    const removes = entries.filter((e) => e.fate === "remove");
    // A Codex home's size counts its sessions twice, once moved and once removed: under by MBs.
    const movedKb = yield* sizeKb(moves.map((e) => e.path));
    const removedKb = yield* sizeKb(removes.map((e) => e.path));
    let failed: string | null = null;

    if (!o.dry) {
      for (const e of [...moves, ...removes]) {
        const done = yield* (e.fate === "move" ? moveTo(e.path, e.to) : fs.remove(e.path, { recursive: true })).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );

        if (!done) {
          failed = e.name;
          break;
        }
      }
    }

    if (failed !== null) {
      totals.held += 1;
      yield* Console.log(`keep the rest of ${box}'s files: could not ${would}move or remove ${failed}`);
      continue;
    }

    totals.boxes += 1;
    totals.moved += moves.length;
    totals.movedKb += movedKb;
    totals.removedKb += removedKb;

    for (const l of named) {
      lanesSwept.add(l);
    }

    yield* Console.log(
      `${would}sweep ${box}: ${would}move ${moves.length} to runs/boxes/${named[0] ?? ""}/ (${mb(movedKb)} MB), ${would}remove ${removes.length} (${mb(removedKb)} MB)`,
    );
  }

  yield* Console.log(
    `boxfiles: ${would}sweep ${totals.boxes} boxes of ${lanesSwept.size} landed lanes: ${would}move ${totals.moved} files and folders (${mb(totals.movedKb)} MB), ${would}remove ${mb(totals.removedKb)} MB; kept ${totals.held} for a reason above and ${totals.waiting} whose lane has not landed; ${unclaimed} names beside the boxes belong to no lane's box and stay`,
  );
});

const cli = Command.make(
  "boxfiles",
  {
    boxes: Flag.String("boxes"),
    main: Flag.String("main"),
    dry: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
    gone: Flag.String("gone").pipe(Flag.atLeast(0)),
    merged: Flag.String("merged").pipe(Flag.atLeast(0)),
    open: Flag.String("open").pipe(Flag.atLeast(0)),
  },
  ({ boxes, main, dry, gone, merged, open }) =>
    sweep({
      boxes,
      main,
      dry,
      gone: new Set(gone),
      merged: new Set(merged),
      open: new Set(open),
      home: { HOME: process.env.HOME },
    }),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(cli, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
  );
}
