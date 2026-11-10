import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import * as fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Given, type Now, carry } from "./carry.ts";
import { makeLaneHome } from "./lane-fixture.ts";
import { LaneHome, LaneWork, laneWork } from "./work.ts";

// Today's version. The law under `carry` (self-fix PR 10, Part 4), on real git, through the lane's own
// Gather: `carry` never says `kept` on a case built to be changed, and never says `stale` on a clean
// rebase far from the pull request's lines.
//
// The cases come from experiment 165's generator (part 6a), ported here as it was: one file,
// `file.txt`, with code-ish and YAML-ish blocks, a reviewed pull request `a`, main's move, and a new
// head `b`, each case labeled by how it was made (`keep`, `drop`, or `skip` where the answer is
// unclear). Seed 165, a fixed 150 runs. Each planted break must fail the law before the real `carry`
// passes it:
//
//   keepsOnId    `carry` keeps on the -U0 id instead of asking for a glance: a moved line
//   stableId     the diff's id uses `--stable` for `--verbatim`: a reindented YAML key
//
// Each case is stored with git's plumbing in the toy repository, then pushed to its origin: `a`
// onto `m<k>` at main's old commit, then `m<k>` moved to main's new one and `b` pushed under `h<k>`.

const SEED = 165;
const RUNS = 150;

type Kind = "code" | "yaml";
type Line = { text: string; kind: Kind };

const NAMES = ["add", "sub", "div", "greet", "server", "build"] as const;
const CODE_INDENTS = ["\t", "  ", "    "] as const;
const YAML_INDENTS = ["  ", "    ", "   "] as const;
type Lines = (i: string) => string[];

const CODE: readonly Lines[] = [
  (i) => [`${i}return a + b;`],
  (i) => [`${i}const s = "hello " + a;`],
  (i) => [`${i}if (a > 0) {`, `${i}${i}a = a - 1;`, `${i}}`],
  (i) => [`${i}log("value is", a);`],
  (i) => [`${i}let n = 0;`],
  (i) => [`${i}return a;`],
];

const YAML: readonly Lines[] = [
  (i) => [`${i}port: 8080`],
  (i) => [`${i}debug: false`],
  (i) => [`${i}name: "app one"`],
  (i) => [`${i}env:`, `${i}${i}mode: "a b"`],
  (i) => [`${i}retries: 3`],
  (i) => [`${i}host: "x y"`],
];

/** Lines a PR or main may add, in the indent of the line they go under. */
const NEW_CODE: readonly ((i: string) => string)[] = [
  (i) => `${i}check(a);`,
  (i) => `${i}if (b === 0) throw new Error("divide by zero");`,
  (i) => `${i}return a;`,
  () => "}",
  () => "",
];

const NEW_YAML: readonly ((i: string) => string)[] = [
  (i) => `${i}retries: 3`,
  (i) => `${i}name: "app one"`,
  (i) => `${i}debug: true`,
  () => "",
];

/**
 * One edit to one line. Three change its words; four change only whitespace. Of those four,
 * `reindent` on a YAML line and `inString` anywhere change the meaning; `reindent` on a code
 * line, `between` and `trailing` do not. A mut that does not fit its line adds a comment.
 */
type Mut = "word" | "number" | "append" | "reindent" | "inString" | "between" | "trailing";

const MUTS: readonly Mut[] = ["word", "number", "append", "reindent", "inString", "between", "trailing"];

const WS_ONLY: ReadonlySet<Mut> = new Set(["reindent", "inString", "between", "trailing"]);

const lead = (t: string) => /^\s*/.exec(t)?.[0] ?? "";

const mutate = (l: Line, m: Mut): Line => {
  const t = l.text;
  const to = (text: string): Line => ({ text, kind: l.kind });
  const append = () => to(`${t}${l.kind === "code" ? " // edited" : " # edited"}`);

  switch (m) {
    case "word": {
      const w = /[A-Za-z_]+/.exec(t);
      return w ? to(`${t.slice(0, w.index)}${w[0]}x${t.slice(w.index + w[0].length)}`) : append();
    }
    case "number": {
      const n = /\d+/.exec(t);
      return n ? to(`${t.slice(0, n.index)}${Number(n[0]) + 1}${t.slice(n.index + n[0].length)}`) : append();
    }
    case "append":
      return append();
    case "reindent": {
      if (t.trim() === "") {
        return append();
      }

      const ws = lead(t);
      return to(`${ws.startsWith("\t") ? `    ${ws.slice(1)}` : `${ws}  `}${t.slice(ws.length)}`);
    }
    case "inString": {
      const q = t.indexOf('"');
      return q < 0 ? append() : to(`${t.slice(0, q + 1)} ${t.slice(q + 1)}`);
    }
    case "between": {
      let quoted = false;

      for (let k = lead(t).length; k < t.length; k += 1) {
        if (t[k] === '"') {
          quoted = !quoted;
        }

        if (t[k] === " " && !quoted) {
          return to(`${t.slice(0, k)} ${t.slice(k)}`);
        }
      }

      return append();
    }
    case "trailing":
      return to(`${t} `);
  }
};

/** An edit on the base file: a line replaced by 0, 1 or 2 lines, or lines put into a gap. */
type Op = { kind: "replace"; line: number; to: Line[] } | { kind: "insert"; gap: number; lines: Line[] };

const spot = (o: Op) => (o.kind === "insert" ? `g${o.gap}` : `l${o.line}`);

/**
 * How many untouched base lines sit between two edits. -1 is the same line; 0 is right next to
 * it, or the same gap. 3 or more is outside git's 3 lines of context: "4 lines away" in part 3.
 */
const between = (x: Op, y: Op): number => {
  if (x.kind === "replace" && y.kind === "replace") {
    return Math.abs(x.line - y.line) - 1;
  }

  if (x.kind === "insert" && y.kind === "insert") {
    return Math.abs(x.gap - y.gap);
  }

  const r = x.kind === "replace" ? x : (y as Extract<Op, { kind: "replace" }>);
  const s = x.kind === "insert" ? x : (y as Extract<Op, { kind: "insert" }>);
  return r.line < s.gap ? s.gap - r.line - 1 : r.line - s.gap;
};

const apply = (base: readonly Line[], ops: readonly Op[]): Line[] => {
  const out: Line[] = [];

  for (let g = 0; g <= base.length; g += 1) {
    for (const o of ops) {
      if (o.kind === "insert" && o.gap === g) {
        out.push(...o.lines);
      }
    }

    const line = base[g];

    if (line === undefined) {
      continue;
    }

    const r = ops.find((o) => o.kind === "replace" && o.line === g);
    out.push(...(r?.kind === "replace" ? r.to : [line]));
  }

  return out;
};

// ---- what fast-check makes: small numbers, read by `build` below

type BlockSpec = { kind: Kind; name: number; indent: number; body: number[] };
type OpSpec = { op: "change" | "delete" | "insert"; at: number; mut: Mut; lines: number[] };
type MainSpec = OpSpec & { aim: "far" | "touch" | "any"; keep: "pr" | "main" | "both" };
type How = "same" | "split" | "tweak" | "extra" | "move" | "drop";

type Spec = {
  blocks: BlockSpec[];
  pr: OpSpec[];
  push:
    | { kind: "rebase"; main: MainSpec[] }
    | { kind: "remake"; how: How; at: number; mut: Mut; extra: OpSpec; main: MainSpec[] };
};

const opArb = fc.record({
  op: fc.constantFrom("change", "delete", "insert"),
  at: fc.nat({ max: 999 }),
  mut: fc.constantFrom(...MUTS),
  lines: fc.array(fc.nat({ max: 4 }), { minLength: 1, maxLength: 2 }),
});

const mainArb = fc.record({
  op: fc.constantFrom("change", "delete", "insert"),
  at: fc.nat({ max: 999 }),
  mut: fc.constantFrom(...MUTS),
  lines: fc.array(fc.nat({ max: 4 }), { minLength: 1, maxLength: 2 }),
  aim: fc.constantFrom("far", "touch", "any"),
  keep: fc.constantFrom("pr", "main", "both"),
});

const blocksArb: fc.Arbitrary<BlockSpec[]> = fc.array(
  fc.record({
    kind: fc.constantFrom("code", "yaml"),
    name: fc.nat({ max: NAMES.length - 1 }),
    indent: fc.nat({ max: 2 }),
    body: fc.array(fc.nat({ max: 5 }), { minLength: 1, maxLength: 4 }),
  }),
  { minLength: 2, maxLength: 5 },
);

const specArb: fc.Arbitrary<Spec> = fc.record({
  blocks: blocksArb,
  pr: fc.array(opArb, { minLength: 1, maxLength: 3 }),
  push: fc.oneof(
    fc.record({
      kind: fc.constant("rebase" as const),
      main: fc.array(mainArb, { minLength: 1, maxLength: 2 }),
    }),
    fc.record({
      kind: fc.constant("remake" as const),
      how: fc.constantFrom("same", "split", "tweak", "extra", "move", "drop"),
      at: fc.nat({ max: 999 }),
      mut: fc.constantFrom(...MUTS),
      extra: opArb,
      main: fc.array(mainArb, { maxLength: 2 }),
    }),
  ),
});

// ---- reading a spec into a case whose answer is known

const pick = <T>(xs: readonly T[], n: number): T => xs[n % xs.length] as T;

const blockLines = (b: BlockSpec): Line[] => {
  const name = pick(NAMES, b.name);
  const text =
    b.kind === "code"
      ? [`function ${name}(a, b) {`, ...b.body.flatMap((s) => pick(CODE, s)(pick(CODE_INDENTS, b.indent))), "}", ""]
      : [`${name}:`, ...b.body.flatMap((s) => pick(YAML, s)(pick(YAML_INDENTS, b.indent))), ""];
  return text.map((t) => ({ text: t, kind: b.kind }));
};

const newLines = (base: readonly Line[], gap: number, picks: readonly number[]): Line[] => {
  const near = base[gap - 1] ?? base[gap] ?? { text: "", kind: "code" };
  const indent = lead(near.text) || (near.kind === "code" ? "\t" : "  ");
  const made = near.kind === "code" ? NEW_CODE : NEW_YAML;
  return picks.map((p) => ({ text: pick(made, p)(indent), kind: near.kind }));
};

/** Every edit `s` could make, one per line (change, delete) or one per gap (insert). */
const choices = (base: readonly Line[], s: OpSpec): Op[] =>
  s.op === "insert"
    ? Array.from({ length: base.length + 1 }, (_, gap) => ({
        kind: "insert",
        gap,
        lines: newLines(base, gap, s.lines),
      }))
    : base.map((line, k) => ({
        kind: "replace",
        line: k,
        to: s.op === "delete" ? [] : [mutate(line, s.mut)],
      }));

const addOnce = (ops: Op[], o: Op | undefined) => {
  if (o !== undefined && !ops.some((p) => spot(p) === spot(o))) {
    ops.push(o);
  }
};

/**
 * Main's edits. `far` picks a spot at least 3 untouched lines from every edit in `avoid`;
 * `touch` changes the words of a line the PR changed; `any` picks any spot.
 */
const mainOps = (base: readonly Line[], specs: readonly MainSpec[], avoid: readonly Op[], touch: boolean) => {
  const out: Op[] = [];
  const touchable = avoid.flatMap((o) => (o.kind === "replace" ? [o.line] : []));

  for (const s of specs) {
    if (s.aim === "touch" && touch && touchable.length > 0) {
      const line = pick(touchable, s.at);
      const mut = WS_ONLY.has(s.mut) ? "append" : s.mut;
      addOnce(out, { kind: "replace", line, to: [mutate(base[line] as Line, mut)] });
      continue;
    }

    const all = choices(base, s);
    const far = all.filter((c) => avoid.every((a) => between(a, c) >= 3));
    addOnce(out, pick(s.aim === "far" && far.length > 0 ? far : all, s.at));
  }

  return out;
};

/** The PR made again: the same, split in two commits, or one thing different. */
const remakeOps = (base: readonly Line[], p: readonly Op[], push: Extract<Spec["push"], { kind: "remake" }>) => {
  const extra = (): { how: How; ops: Op[] } => {
    const free = choices(base, push.extra).filter((c) => !p.some((x) => spot(x) === spot(c)));
    return free.length === 0 ? { how: "same", ops: [...p] } : { how: "extra", ops: [...p, pick(free, push.at)] };
  };

  switch (push.how) {
    case "same":
    case "split":
      return { how: push.how, ops: [...p] };
    case "extra":
      return extra();
    case "tweak": {
      const spots = p.flatMap((o, k) => (o.kind === "insert" ? o.lines : o.to).map((_, j) => [k, j] as const));

      if (spots.length === 0) {
        return extra();
      }

      const [k, j] = pick(spots, push.at);
      const ops = p.map((o, n) => {
        if (n !== k) {
          return o;
        }

        const lines = (o.kind === "insert" ? o.lines : o.to).map((l, m) => (m === j ? mutate(l, push.mut) : l));
        return o.kind === "insert" ? { ...o, lines } : { ...o, to: lines };
      });
      return { how: "tweak" as How, ops };
    }
    case "move": {
      const moves = p.filter((o) => o.kind === "insert");

      if (moves.length === 0) {
        return extra();
      }

      const m = pick(moves, push.at);
      const gaps = Array.from({ length: base.length + 1 }, (_, g) => g).filter(
        (g) => !p.some((o) => o.kind === "insert" && o.gap === g),
      );

      if (gaps.length === 0) {
        return extra();
      }

      const gap = pick(gaps, Math.floor(push.at / moves.length));
      return { how: "move" as How, ops: p.map((o) => (o === m ? { ...m, gap } : o)) };
    }
    case "drop":
      return { how: "drop" as How, ops: p.filter((_, k) => k !== push.at % p.length) };
  }
};

const norm = (ls: readonly Line[]) => ls.map((l) => l.text.replace(/\s+/g, "")).filter((t) => t !== "");

const strings = (t: string) => (t.match(/"[^"]*"/g) ?? []).join("|");

const sameText = (x: readonly Line[], y: readonly Line[]) =>
  x.length === y.length && x.every((l, k) => l.text === y[k]?.text);

/** Two files that differ only in whitespace: does any of it sit where it means something? */
const meaningfulWhitespace = (x: readonly Line[], y: readonly Line[]) => {
  const nx = x.filter((l) => l.text.trim() !== "");
  const ny = y.filter((l) => l.text.trim() !== "");
  return nx.some((l, k) => {
    const m = ny[k];

    if (m === undefined || l.text === m.text) {
      return false;
    }

    return (l.kind === "yaml" && lead(l.text) !== lead(m.text)) || strings(l.text) !== strings(m.text);
  });
};

/**
 * The PR's edits `p`, made again over `e`: edits made under it, by main or by a parent branch.
 * Far apart, the PR is the same. Next to each other, the answer is unclear. On a line both
 * changed, the rebase stops and a person resolves it: the PR is not the same any more.
 */
type Over =
  | { kind: "far"; ops: Op[] }
  | { kind: "near" }
  | { kind: "same_change" }
  | { kind: "touch"; kept: MainSpec["keep"]; ops: Op[] };

const replayOver = (base: readonly Line[], p: readonly Op[], e: readonly Op[], keep: MainSpec["keep"]): Over => {
  const touches = (x: Op) => x.kind === "replace" && p.some((y) => y.kind === "replace" && y.line === x.line);
  const touched = e.filter(touches);

  if (touched.length === 0) {
    if (e.some((x) => p.some((y) => between(x, y) < 3))) {
      return { kind: "near" };
    }

    return { kind: "far", ops: [...e, ...p] };
  }

  const ops: Op[] = e.filter((x) => !touches(x));
  let kept = keep;

  for (const y of p) {
    const x = touched.find((t) => t.kind === "replace" && y.kind === "replace" && t.line === y.line);

    if (x === undefined || x.kind !== "replace" || y.kind !== "replace") {
      ops.push(y);
      continue;
    }

    if (sameText(x.to, y.to)) {
      return { kind: "same_change" };
    }

    // Keeping the other side drops the PR's change. Fine when that change had words in it.
    const words = y.to.length === 0 || norm(y.to).join() !== norm([base[y.line] as Line]).join();
    kept = keep === "main" && !words ? "pr" : keep;
    const to = kept === "pr" ? y.to : kept === "main" ? x.to : [...y.to, ...x.to];
    ops.push({ kind: "replace", line: y.line, to });
  }

  return { kind: "touch", kept, ops };
};

type Label = "keep" | "drop" | "skip";

type Built = {
  base: Line[];
  a: Line[];
  main: Line[] | null;
  b: Line[];
  split: Line[] | null;
  label: Label;
  why: string;
};

/** Read a spec into the base file, the reviewed PR, main's move, the new head and its answer. */
const build = (spec: Spec): Built => {
  const base = spec.blocks.flatMap(blockLines);
  const p: Op[] = [];

  for (const s of spec.pr) {
    addOnce(p, pick(choices(base, s), s.at));
  }

  const a = apply(base, p);
  const push = spec.push;
  const out = (b: Line[], e: Op[], label: Label, why: string, split: Line[] | null = null): Built => ({
    base,
    a,
    main: e.length > 0 ? apply(base, e) : null,
    b,
    split,
    label,
    why,
  });

  if (push.kind === "rebase") {
    const e = mainOps(base, push.main, p, true);
    const o = replayOver(base, p, e, push.main[0]?.keep ?? "pr");

    switch (o.kind) {
      case "near":
        return out([], e, "skip", "main edit 1 to 3 lines from a PR edit");
      case "same_change":
        return out([], e, "skip", "both sides made the same change");
      case "far":
        return out(apply(base, o.ops), e, "keep", "rebase, main 4+ lines away");
      case "touch":
        return out(apply(base, o.ops), e, "drop", `main changed a PR line, kept ${o.kept}`);
    }
  }

  const q = remakeOps(base, p, push);
  const e = mainOps(base, push.main, [...p, ...q.ops], false);
  const rebased = e.length > 0 ? ", rebased" : "";
  const why = `force push: ${q.how}${rebased}`;

  if (e.some((x) => [...p, ...q.ops].some((y) => between(x, y) < 3))) {
    return out([], e, "skip", "main edit 1 to 3 lines from a PR edit");
  }

  const b = apply(base, [...e, ...q.ops]);
  const split = q.how === "split" ? apply(base, [...e, ...q.ops.slice(0, Math.floor(q.ops.length / 2))]) : null;
  const before = a;
  const after = apply(base, q.ops);

  if (sameText(before, after)) {
    return out(b, e, "keep", why, split);
  }

  if (norm(before).join("\n") !== norm(after).join("\n")) {
    return out(b, e, "drop", `${why}, words`);
  }

  if (meaningfulWhitespace(before, after)) {
    return out(b, e, "drop", `${why}, whitespace in YAML indent or a string`);
  }

  return out([], e, "skip", "whitespace only, where it means nothing to the program");
};

// ---------------------------------------------------------------- the cases, as commits

const IDENTITY = {
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

const fileText = (lines: readonly Line[]) => (lines.length === 0 ? "" : `${lines.map((l) => l.text).join("\n")}\n`);

/** The smallest cases each planted break fails on, run first: a moved line, a reindented YAML key. */
const MOVED_LINE: Spec = {
  blocks: [
    { kind: "code", name: 0, indent: 0, body: [0] },
    { kind: "code", name: 1, indent: 0, body: [0] },
  ],
  pr: [{ op: "insert", at: 0, mut: "word", lines: [0] }],
  push: {
    kind: "remake",
    how: "move",
    at: 5,
    mut: "word",
    extra: { op: "insert", at: 0, mut: "word", lines: [0] },
    main: [],
  },
};

const YAML_REINDENT: Spec = {
  blocks: [
    { kind: "yaml", name: 1, indent: 0, body: [0, 1] },
    { kind: "code", name: 0, indent: 0, body: [0] },
  ],
  pr: [{ op: "change", at: 1, mut: "number", lines: [0] }],
  push: {
    kind: "remake",
    how: "tweak",
    at: 0,
    mut: "reindent",
    extra: { op: "insert", at: 0, mut: "word", lines: [0] },
    main: [],
  },
};

/** What `carry` answers, or a planted break of it. */
type Carry = typeof carry;
/** How the diff's id is read: what the lane's Gather reads, or a planted break of it. */
type Ids = (given: Given, now: Now) => { readonly given: Given; readonly now: Now };

describe("carry, over 165's generated cases, on real git", () => {
  let dir = "";
  let seed = "";
  let home = "";
  let k = 0;
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "carry-law-")));
    const made = makeLaneHome({ dir, nodeModules: join(dir, "no-modules") });
    seed = made.seed;
    home = made.home;
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const git = (input: string | null, ...args: readonly string[]) =>
    execFileSync("git", args, {
      cwd: seed,
      env: { ...process.env, ...IDENTITY },
      stdio: "pipe",
      ...(input === null ? {} : { input }),
    })
      .toString()
      .trim();
  const store = (lines: readonly Line[], parent: string | null, msg: string) => {
    const blob = git(fileText(lines), "hash-object", "-w", "--stdin");
    const tree = git(`100644 blob ${blob}\tfile.txt\n`, "mktree");
    return git(null, "commit-tree", tree, ...(parent === null ? [] : ["-p", parent]), "-m", msg);
  };
  const push = (commit: string, branch: string) =>
    git(null, "push", "--quiet", "--force", "origin", `${commit}:refs/heads/${branch}`);
  const run = <A, E>(effect: Effect.Effect<A, E, LaneWork>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(
          laneWork.pipe(Layer.provide(Layer.succeed(LaneHome, { home, checkout: seed, briefs: "", person: "owner" }))),
        ),
      ),
    );

  /** The diff's id as plain `--stable` reads it: the planted break of the id. */
  const stableId = (base: string, head: string) =>
    execFileSync("git", ["patch-id", "--stable"], {
      cwd: seed,
      input: execFileSync("git", ["diff", "-U0", base, head], { cwd: seed }),
    })
      .toString()
      .split(" ")[0] ?? "";
  /** Where `b` left the branch it goes into now: main's new commit, under which it was stored. */
  let baseNow = "";
  const STABLE: Ids = (given, now) => ({
    given: { ...given, diff: stableId(given.base, given.head) },
    now: { ...now, diff: stableId(baseNow, now.head) },
  });
  const VERBATIM: Ids = (given, now) => ({ given, now });

  /** What `answer` says of one case: the yes said at `a`, read again once the head is `b`. */
  const answerOf = async (c: Built, answer: Carry, ids: Ids) => {
    k += 1;
    const m0 = store(c.base, null, "base");
    const a = store(c.a, m0, "pr");
    const m1 = c.main === null ? m0 : store(c.main, m0, "main moves");
    const b =
      c.split === null
        ? store(c.b, m1, "pr again")
        : store(c.b, store(c.split, m1, "pr again, 1 of 2"), "pr again, 2 of 2");
    push(m0, `m${k}`);
    push(a, `a${k}`);
    const given = await run(
      Effect.gen(function* () {
        return yield* (yield* LaneWork).given(a, `m${k}`);
      }),
    );
    push(m1, `m${k}`);
    push(b, `h${k}`);
    baseNow = m1;
    const now = await run(
      Effect.gen(function* () {
        return yield* (yield* LaneWork).now(given, b);
      }),
    );
    const read = ids(given, now);
    return answer(read.given, read.now);
  };

  /** What breaks the law in one case, or nothing. */
  const broken = async (spec: Spec, answer: Carry, ids: Ids): Promise<string | null> => {
    const c = build(spec);

    if (c.label === "skip") {
      return null;
    }

    const said = await answerOf(c, answer, ids);

    if (c.label === "keep") {
      return said._tag === "stale" ? `${c.why}: built the same, and carry said stale` : null;
    }

    // A moved line keeps its -U0 id, so a glance may look at it. Anything else changed is stale.
    if (c.why.includes("move")) {
      return said._tag === "kept" ? `${c.why}: carry kept it` : null;
    }

    return said._tag === "stale" ? null : `${c.why}: built changed, and carry said ${said._tag}`;
  };

  const holds = (answer: Carry, ids: Ids = VERBATIM) =>
    fc.assert(
      fc.asyncProperty(specArb, async (spec) => {
        expect(await broken(spec, answer, ids)).toBeNull();
      }),
      {
        seed: SEED,
        numRuns: RUNS,
        endOnFailure: true,
        examples: [[MOVED_LINE], [YAML_REINDENT]],
      },
    );

  it("the two smallest cases are what they say: a moved line and a reindented YAML key, each changed", () => {
    expect(build(MOVED_LINE)).toMatchObject({ label: "drop", why: "force push: move, words" });
    expect(build(YAML_REINDENT)).toMatchObject({
      label: "drop",
      why: "force push: tweak, whitespace in YAML indent or a string",
    });
  });

  it("holds on the real carry, over 150 cases", { timeout: 600_000 }, async () => {
    await holds(carry);
  });

  it("catches keepsOnId: carry keeps on the -U0 id instead of asking for a glance", { timeout: 600_000 }, async () => {
    const keepsOnId: Carry = (given, now) =>
      now.head !== given.head && now.diff === given.diff ? { _tag: "kept", why: "replayed" } : carry(given, now);
    await expect(holds(keepsOnId)).rejects.toThrow();
  });

  it("catches stableId: the diff's id read with --stable", { timeout: 600_000 }, async () => {
    await expect(holds(carry, STABLE)).rejects.toThrow();
  });
});
