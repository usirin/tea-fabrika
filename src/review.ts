import { Cmd, defineMachine } from "@demlik/tea";
import { z } from "zod";
import { Issue } from "./issue.ts";

// Review, as its own machine. It gets a built change whose tests passed and
// says whether it may go on. Each check is owned by whoever does it best:
//
//   code    which files changed outside the criteria, and whether the
//           builder listed them; whether a finding's quote is really there
//   router  whether an extra change, or a finding, is about the ticket's goal
//   agent   reading the diff for problems the tests cannot see; it only
//           finds, and never decides pass or fail
//   missing a file the change left out: Jev asks of every untouched file in
//           the packages the change touched whether the ticket needs it
//           changed too (experiment 36); it runs beside the agent
//   person  whatever the router is unsure about
//
// The lane holds it as a child and reads how it ended: passed, failed (back to
// the builder, with the findings) or dropped by a person.

/** A file the builder changed that no criterion names, and its reason. */
export const Deviation = z.object({ file: z.string(), why: z.string() });
export type Deviation = z.infer<typeof Deviation>;

/**
 * A problem the reviewer found, pinned to one line it quotes. The id is the
 * machine's. `seen` is a fingerprint of the file when the finding was made:
 * a later "fixed" only counts once the file is different.
 */
export const QuotedFinding = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number(),
  quote: z.string(),
  problem: z.string(),
  seen: z.string(),
});
export type QuotedFinding = z.infer<typeof QuotedFinding>;

/**
 * A file the change did not touch and likely should have. It has no line to
 * quote: it is fixed once the change touches the file, by code, whatever the
 * reviewer says. It carries a `kind` and a quoted finding does not, so a
 * finding saved before this one existed still reads as a quoted one.
 */
export const MissedFinding = z.object({
  kind: z.literal("missed"),
  id: z.string(),
  file: z.string(),
  problem: z.string(),
});
export type MissedFinding = z.infer<typeof MissedFinding>;

export const Finding = z.union([MissedFinding, QuotedFinding]);
export type Finding = QuotedFinding | MissedFinding;

export const isMissed = (f: Finding): f is MissedFinding => "kind" in f && f.kind === "missed";

/** Where a finding points, for a person: a line, or a whole file. */
export const whereOf = (f: Finding) => (isMissed(f) ? f.file : `${f.file}:${f.line}`);

/** One changed file as the check saw it: its text after the change, and the lines the diff touched. */
export const Snapshot = z.record(
  z.string(),
  z.object({ text: z.string(), lines: z.array(z.number()).readonly() }),
);
export type Snapshot = z.infer<typeof Snapshot>;

const Relation = z.enum(["related", "unrelated", "unsure"]);
export type Relation = z.infer<typeof Relation>;

/**
 * Ask the router whether a text is about the ticket's goal: an extra change's
 * reason, or a finding's problem. `key` comes back with the answer, so the
 * machine knows which question it settles.
 */
export const route = Cmd.define("route", {
  input: z.object({
    key: z.string(),
    about: z.enum(["change", "finding"]),
    text: z.string(),
    goal: z.string(),
  }),
  ok: z.object({ key: z.string(), relation: Relation, confidence: z.number() }),
  err: ["router_failed"],
});

/** A finding as the reviewer writes it, before the machine checks its quote and names it. */
const Spotted = QuotedFinding.omit({ id: true, seen: true });
export type Spotted = z.infer<typeof Spotted>;

/**
 * A finding a person already settled in an earlier round: filed as a note, or
 * withdrawn after the builder disputed it. Raising it again changes nothing.
 */
const decision = { decision: z.enum(["filed", "withdrawn"]) };
export const Decided = z.union([MissedFinding.extend(decision), QuotedFinding.extend(decision)]);
export type Decided = Finding & { readonly decision: "filed" | "withdrawn" };

/**
 * Ask the reviewer to read the diff. It returns new findings, and for each
 * finding still open from an earlier round, whether it is fixed now. It is
 * told what was already decided, so it does not raise it again.
 */
export const inspect = Cmd.define("inspect", {
  input: z.object({
    issue: Issue,
    diff: z.string(),
    /** Only quoted findings: whether a missed file is fixed is code's to say. */
    open: z.array(QuotedFinding).readonly(),
    decided: z.array(Decided).readonly(),
  }),
  ok: z.object({
    findings: z.array(Spotted).readonly(),
    rechecks: z.array(z.object({ id: z.string(), fixed: z.boolean() })).readonly(),
  }),
  err: ["agent_failed"],
});

/**
 * Ask the matcher whether a new finding makes the same point as one already
 * decided: the net under a reviewer that raises it again anyway. `to` is the
 * decided finding's id, or `null` for "a different point" and for "not sure".
 */
export const match = Cmd.define("match", {
  input: z.object({
    key: z.string(),
    text: z.string(),
    candidates: z.array(z.object({ id: z.string(), text: z.string() })).readonly(),
  }),
  ok: z.object({ key: z.string(), to: z.string().nullable(), confidence: z.number() }),
  err: ["matcher_failed"],
});

/**
 * What the missing-file reader answers. `checked`: every candidate was asked,
 * and `flagged` are the ones at or above the floor. `too_many`: there were
 * more candidates than the cap, so none was asked.
 */
export const MissingAnswer = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("checked"),
    asked: z.number(),
    flagged: z.array(z.object({ file: z.string(), yes: z.number() })).readonly(),
  }),
  z.object({ kind: z.literal("too_many"), candidates: z.number(), cap: z.number() }),
]);
export type MissingAnswer = z.infer<typeof MissingAnswer>;

/**
 * How the missing-file check went, kept on review's result. `unread` is a
 * reader that failed. Like `too_many`, it means nothing was checked: the lane
 * goes on, and the result says the check was skipped.
 */
export type MissingCheck = MissingAnswer | { readonly kind: "unread" };

/**
 * How the missing-file check went for the change a person is asked to approve.
 * Review's own outcomes, plus two it never gives: `no_change`, a lane a person
 * finished with nothing built, so there was no change to check; and
 * `not_recorded`, a run saved before the lane kept the outcome, which may or
 * may not have checked.
 */
export type MissingOnRecord = MissingCheck | { readonly kind: "no_change" } | { readonly kind: "not_recorded" };

/** The approval record's line for the check. A skip says so in capitals: it is easy to read past. */
export function missingLine(m: MissingOnRecord): string {
  switch (m.kind) {
    case "checked":
      return `missing-file check: ran, asked ${m.asked} file(s), ${m.flagged.length} flagged`;
    case "too_many":
      return `missing-file check: SKIPPED, ${m.candidates} files to ask is over the cap of ${m.cap}`;
    case "unread":
      return "missing-file check: SKIPPED, the reader failed";
    case "no_change":
      return "missing-file check: not run, nothing was built";
    case "not_recorded":
      return "missing-file check: not recorded, the run was saved before the lane kept it";
  }
}

/** Ask which untouched files the change should have touched too. */
export const findMissing = Cmd.define("find_missing", {
  input: z.object({ issue: Issue, diff: z.string(), changed: z.array(z.string()).readonly() }),
  ok: MissingAnswer,
  err: ["reader_failed"],
});

/** A new finding the matcher tied to a decided one, kept on the result so a person can check it. */
export interface Matched {
  readonly finding: Finding;
  readonly to: string;
}

/** What review is handed: the ticket and everything the check saw of the change. */
export interface ReviewInput {
  readonly issue: Issue;
  /** Which build this is, so finding ids from different rounds never clash. */
  readonly round: number;
  readonly diff: string;
  readonly changed: readonly string[];
  readonly snapshot: Snapshot;
  readonly deviations: readonly Deviation[];
  /** Findings from earlier rounds the builder was asked to fix. */
  readonly open: readonly Finding[];
  /** Findings a person settled in earlier rounds. */
  readonly decided: readonly Decided[];
  /**
   * The last round the budget allows: the list of findings is frozen. Open
   * findings must still be fixed; a new one is filed and blocks nothing, so a
   * reviewer cannot keep the lane going by finding something new each round.
   */
  readonly frozen: boolean;
}

export type RoutedDeviation = Deviation & { readonly relation: Relation };

type Held = { readonly input: ReviewInput; readonly extra: readonly Deviation[] };

type Scoping = Held & {
  readonly phase: "scoping";
  readonly routed: Readonly<Record<string, Relation | null>>;
};

/** What the reviewer hands back: new findings, and whether each open one is fixed. */
type Report = {
  readonly findings: readonly Spotted[];
  readonly rechecks: readonly { readonly id: string; readonly fixed: boolean }[];
};

/**
 * The reviewer and the missing-file check run side by side. Each answer is
 * `null` until it is in; the round is read once both are.
 */
type Reading = Held & {
  readonly phase: "reading";
  readonly report: Report | null;
  readonly missing: MissingCheck | null;
};

/** What a round has found so far, once the quotes are checked. */
type Read = {
  /** How the missing-file check went. */
  readonly missing: MissingCheck;
  /** Files the check says the change left out, not raised before: back to the builder, unrouted. */
  readonly missed: readonly MissedFinding[];
  /** New findings whose quotes are in the diff. */
  readonly found: readonly Finding[];
  /** Open findings the reviewer says are not fixed. */
  readonly still: readonly Finding[];
  /** Findings on lines the diff did not touch: filed, never blocking. */
  readonly notes: readonly Finding[];
  /** New findings tied to a decided one: settled already, kept in sight. */
  readonly matched: readonly Matched[];
  /** New findings in a frozen round: filed, and shown to the builder as not required. */
  readonly late: readonly Finding[];
};

type Matching = Held &
  Read & {
    readonly phase: "matching";
    /** Each new finding's match: `null` while asked, then the decided id or "none". */
    readonly matches: Readonly<Record<string, string | null>>;
  };
type Sorting = Held &
  Read & {
    readonly phase: "sorting";
    readonly routed: Readonly<Record<string, Relation | null>>;
  };

/** What a match answer stores for "no decided finding makes this point". */
const NONE = "none";

/** Why review stopped and is waiting on a person. */
export type ReviewPark =
  | { readonly kind: "scope_unsure"; readonly deviations: readonly RoutedDeviation[] }
  | {
      readonly kind: "finding_unsure";
      readonly findings: readonly Finding[];
      readonly from: Sorting;
    }
  | { readonly kind: "reviewer_failed" }
  | { readonly kind: "router_failed"; readonly from: Scoping | Sorting }
  | { readonly kind: "matcher_failed"; readonly from: Matching };

type Drop = { readonly kind: "drop" };

export interface ReviewParkAnswers {
  /** `accept`: the extra changes may stay. `rebuild`: tell the builder what to do about them. */
  readonly scope_unsure:
    | { readonly kind: "accept" }
    | { readonly kind: "rebuild"; readonly feedback: string }
    | Drop;
  /** `decide`: the findings in `fix` go back to the builder, the rest are filed as notes. */
  readonly finding_unsure: { readonly kind: "decide"; readonly fix: readonly string[] } | Drop;
  readonly reviewer_failed: { readonly kind: "retry" } | Drop;
  readonly router_failed: { readonly kind: "retry" } | Drop;
  readonly matcher_failed: { readonly kind: "retry" } | Drop;
}

export type ReviewParkAnswer = {
  [K in keyof ReviewParkAnswers]: { readonly park: K; readonly answer: ReviewParkAnswers[K] };
}[keyof ReviewParkAnswers];

export type Review =
  | { readonly phase: "idle" }
  | Scoping
  | Reading
  | Matching
  | Sorting
  | (Held & { readonly phase: "parked"; readonly why: ReviewPark })
  /**
   * The change may go on. `deviations`, `notes`, `matched` and `missing` are
   * for the person who reads the result.
   */
  | {
      readonly phase: "passed";
      readonly deviations: readonly Deviation[];
      readonly notes: readonly Finding[];
      readonly matched: readonly Matched[];
      readonly missing: MissingCheck;
    }
  /**
   * Back to the builder. `open` is every finding it must fix; `notes` were
   * filed this round. `missing` is `null` when the round failed before the
   * check ran: on scope.
   */
  | {
      readonly phase: "failed";
      readonly feedback: string;
      readonly open: readonly Finding[];
      readonly notes: readonly Finding[];
      readonly matched: readonly Matched[];
      readonly missing: MissingCheck | null;
    }
  | { readonly phase: "dropped"; readonly why: ReviewPark };

export type ReviewMsg =
  | { readonly type: "start"; readonly input: ReviewInput }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume" }
  | { readonly type: "answer"; readonly answer: ReviewParkAnswer };

export type ReviewCmd =
  | ReturnType<typeof route>
  | ReturnType<typeof inspect>
  | ReturnType<typeof match>
  | ReturnType<typeof findMissing>;
type Step = readonly [Review, readonly ReviewCmd[]];

const stay = (s: Review): Step => [s, []];
const held = (s: Held): Held => ({ input: s.input, extra: s.extra });
const park = (s: Held, why: ReviewPark): Step => [{ phase: "parked", ...held(s), why }, []];
/** Fail on scope, before the round is read: the missing-file check never ran. */
const failEarly = (feedback: string, open: readonly Finding[]): Step => [
  { phase: "failed", feedback, open, notes: [], matched: [], missing: null },
  [],
];

/**
 * Where a finding's quote sits, by code: on a line the diff touched, on some
 * other line of a changed file, or nowhere this review can see. The quote must
 * be on the line the finding names; a fragment of the line is enough.
 */
export function placeOf(snapshot: Snapshot, f: Spotted): "in_diff" | "outside_diff" | "missing" {
  const file = snapshot[f.file];
  const quote = f.quote.trim();
  const line = file?.text.split("\n")[f.line - 1];
  if (file === undefined || line === undefined || quote === "" || !line.includes(quote)) return "missing";
  return file.lines.includes(f.line) ? "in_diff" : "outside_diff";
}

/** A short fingerprint of a file's text (FNV-1a), so a finding can tell whether its file changed. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/**
 * Whether an open finding is fixed. A missed file is fixed once the change
 * touches it. For a quoted finding the reviewer's word is not enough: the file
 * must also differ from when the finding was made, or be out of the change
 * altogether. A "fixed" on an untouched file keeps the finding open.
 */
function isFixed(input: ReviewInput, f: Finding, saysFixed: boolean): boolean {
  if (isMissed(f)) return input.changed.includes(f.file);
  const file = input.snapshot[f.file];
  return saysFixed && (file === undefined || fingerprint(file.text) !== f.seen);
}

const describe = (f: Finding) =>
  isMissed(f) ? `- [${f.id}] ${f.file}: ${f.problem}` : `- [${f.id}] ${f.file}:${f.line} \`${f.quote.trim()}\`: ${f.problem}`;

const quoted = (findings: readonly Finding[]): readonly QuotedFinding[] => findings.flatMap((f) => (isMissed(f) ? [] : [f]));

const inspectFor = (s: Held) =>
  inspect({ issue: s.input.issue, diff: s.input.diff, open: quoted(s.input.open), decided: s.input.decided });
const findMissingFor = (s: Held) => findMissing({ issue: s.input.issue, diff: s.input.diff, changed: s.input.changed });

/** Hand the diff to the reviewer and the missing-file check at once. */
const startReading = (s: Held): Step => [
  { phase: "reading", ...held(s), report: null, missing: null },
  [inspectFor(s), findMissingFor(s)],
];

/** One of the two readers answered: read the round once the other has too. */
const settleReading = (s: Reading): Step =>
  s.report === null || s.missing === null ? stay(s) : read(s, s.report, s.missing);

const routeChange = (s: Held, d: Deviation) =>
  route({ key: d.file, about: "change", text: d.why, goal: s.input.issue.goal });
const routeFinding = (s: Held, f: Finding) =>
  route({ key: f.id, about: "finding", text: f.problem, goal: s.input.issue.goal });
const matchFinding = (s: Held, f: Finding) =>
  match({ key: f.id, text: f.problem, candidates: s.input.decided.map((d) => ({ id: d.id, text: d.problem })) });

/** The questions still out in a reading, routing or matching phase, asked again. */
const unanswered = (s: Scoping | Reading | Matching | Sorting): readonly ReviewCmd[] => {
  switch (s.phase) {
    case "reading":
      return [...(s.report === null ? [inspectFor(s)] : []), ...(s.missing === null ? [findMissingFor(s)] : [])];
    case "scoping":
      return s.extra.filter((d) => s.routed[d.file] === null).map((d) => routeChange(s, d));
    case "matching":
      return s.found.filter((f) => s.matches[f.id] === null).map((f) => matchFinding(s, f));
    case "sorting":
      return s.found.filter((f) => s.routed[f.id] === null).map((f) => routeFinding(s, f));
  }
};

/**
 * The scope, by code: a file no criterion names must be one the builder
 * listed with a reason, and the listed ones go to the router. A listed file
 * the diff does not touch is ignored.
 */
function start(input: ReviewInput): Step {
  const named = new Set(input.issue.criteria.flatMap((c) => (c.kind === "example" ? [c.file] : [])));
  const outside = input.changed.filter((file) => !named.has(file));
  const unlisted = outside.filter((file) => !input.deviations.some((d) => d.file === file));
  if (unlisted.length > 0) {
    return failEarly(
      `You changed ${unlisted.join(", ")}, which no criterion names, and did not list it. Undo it, or list it as a deviation with why.`,
      input.open,
    );
  }
  const extra = outside.flatMap((file) => input.deviations.find((d) => d.file === file) ?? []);
  if (extra.length === 0) return startReading({ input, extra });
  const scoping: Scoping = {
    phase: "scoping",
    input,
    extra,
    routed: Object.fromEntries(extra.map((d) => [d.file, null])),
  };
  return [scoping, unanswered(scoping)];
}

/** Every extra change has an answer: one that does not serve the ticket fails, an unsure one parks. */
function settleScope(s: Scoping): Step {
  const routed: RoutedDeviation[] = [];
  for (const d of s.extra) {
    const relation = s.routed[d.file];
    if (relation === null || relation === undefined) return stay(s);
    routed.push({ ...d, relation });
  }
  const unrelated = routed.filter((d) => d.relation === "unrelated");
  if (unrelated.length > 0) {
    return failEarly(
      `These changes do not serve the ticket: ${unrelated.map((d) => `${d.file} (${d.why})`).join("; ")}. Undo them; they can be filed as their own issue.`,
      s.input.open,
    );
  }
  if (routed.some((d) => d.relation === "unsure")) return park(s, { kind: "scope_unsure", deviations: routed });
  return startReading(s);
}

/**
 * The reviewer answered. Code checks every new finding's quote: one that is
 * not there is dropped, one on a line the diff did not touch is filed as a
 * note. An open finding stays open unless the reviewer says it is fixed and
 * its file has changed since. In a frozen round the new ones in the diff are
 * filed as late, and nobody is asked about them. Otherwise, when a person has
 * decided findings before, they go to the matcher first; the rest go to the router.
 *
 * A file the missing-file check flags becomes a missed finding, unless one on
 * that file is open or decided already. It goes back to the builder without
 * the router: the check's question was already "does the ticket need this
 * file". In a frozen round it is filed as late, like any new finding.
 */
function read(s: Held, report: Report, missing: MissingCheck): Step {
  const { snapshot, round: n } = s.input;
  const named = report.findings.map((f, i) => ({
    ...f,
    id: `r${n}-${i + 1}`,
    seen: fingerprint(snapshot[f.file]?.text ?? ""),
  }));
  const found = named.filter((f) => placeOf(snapshot, f) === "in_diff");
  const notes = named.filter((f) => placeOf(snapshot, f) === "outside_diff");
  const still = s.input.open.filter(
    (f) => !isFixed(s.input, f, report.rechecks.some((r) => r.id === f.id && r.fixed)),
  );
  const raised = new Set([...s.input.open, ...s.input.decided].filter(isMissed).map((f) => f.file));
  const flagged = missing.kind === "checked" ? missing.flagged.filter((x) => !raised.has(x.file)) : [];
  const missed = flagged.map(
    (x, i): MissedFinding => ({
      kind: "missed",
      id: `r${n}-m${i + 1}`,
      file: x.file,
      problem: `The change does not touch ${x.file}, and the ticket looks like it needs that file changed too (${x.yes.toFixed(2)}). Change it, or dispute this finding with why it can stay as it is.`,
    }),
  );
  if (s.input.frozen) return startSorting(s, { missing, missed: [], found: [], still, notes, matched: [], late: [...missed, ...found] });
  const round: Read = { missing, missed, found, still, notes, matched: [], late: [] };
  if (found.length === 0 || s.input.decided.length === 0) return startSorting(s, round);
  const matching: Matching = {
    phase: "matching",
    ...held(s),
    ...round,
    matches: Object.fromEntries(found.map((f) => [f.id, null])),
  };
  return [matching, unanswered(matching)];
}

/** Every new finding has its match. One tied to a decided finding is settled already; the rest go on. */
function settleMatches(s: Matching): Step {
  if (s.found.some((f) => s.matches[f.id] === null)) return stay(s);
  const to = (f: Finding) => s.matches[f.id] ?? NONE;
  return startSorting(s, {
    missing: s.missing,
    missed: s.missed,
    found: s.found.filter((f) => to(f) === NONE),
    still: s.still,
    notes: s.notes,
    matched: [...s.matched, ...s.found.filter((f) => to(f) !== NONE).map((f) => ({ finding: f, to: to(f) }))],
    late: s.late,
  });
}

/** Send the round's new findings to the router, or finish when there are none. */
function startSorting(s: Held, round: Read): Step {
  const sorting: Sorting = {
    phase: "sorting",
    ...held(s),
    ...round,
    routed: Object.fromEntries(round.found.map((f) => [f.id, null])),
  };
  return round.found.length === 0 ? finish(sorting, {}) : [sorting, unanswered(sorting)];
}

/** Every new finding has an answer; an unsure one parks, unless a person already decided. */
function settleFindings(s: Sorting): Step {
  if (s.found.some((f) => s.routed[f.id] === null)) return stay(s);
  const unsure = s.found.filter((f) => s.routed[f.id] === "unsure");
  return unsure.length > 0 ? park(s, { kind: "finding_unsure", findings: unsure, from: s }) : finish(s, {});
}

/**
 * How the round ends. Related findings and unfixed ones go back to the
 * builder; unrelated and late ones are filed. `decided` is a person's answer,
 * which outranks the router.
 */
function finish(s: Sorting, decided: Readonly<Record<string, "fix" | "note">>): Step {
  const fix = (f: Finding) => decided[f.id] === "fix" || (decided[f.id] === undefined && s.routed[f.id] === "related");
  const open = [...s.still, ...s.missed, ...s.found.filter(fix)];
  const notes = [...s.notes, ...s.late, ...s.found.filter((f) => !fix(f))];
  const { matched, missing } = s;
  if (open.length === 0) return [{ phase: "passed", deviations: s.extra, notes, matched, missing }, []];
  const feedback = [
    `Review found problems to fix:`,
    ...open.map(describe),
    `If you think a finding is wrong, answer dispute with its id and why.`,
    ...(s.late.length === 0
      ? []
      : [`Also seen this round, after the list was frozen. Not required; they are filed:`, ...s.late.map(describe)]),
  ].join("\n");
  return [{ phase: "failed", feedback, open, notes, matched, missing }, []];
}

function resume(s: Review): Step {
  switch (s.phase) {
    case "reading": {
      // A round saved before the missing-file check had neither answer field: both were still out.
      const reading: Reading = { ...s, report: s.report ?? null, missing: s.missing ?? null };
      return [reading, unanswered(reading)];
    }
    case "matching":
    case "sorting": {
      // A round saved before the check never ran it: say so, rather than claim it found nothing.
      const read = { ...s, missing: s.missing ?? { kind: "unread" as const }, missed: s.missed ?? [] };
      return [read, unanswered(read)];
    }
    case "scoping":
      return [s, unanswered(s)];
    default:
      return stay(s);
  }
}

function answerPark(s: Extract<Review, { phase: "parked" }>, { park: kind, answer }: ReviewParkAnswer): Step {
  if (kind !== s.why.kind) return stay(s);
  if (answer.kind === "drop") return [{ phase: "dropped", why: s.why }, []];
  switch (s.why.kind) {
    case "scope_unsure":
      return answer.kind === "accept"
        ? startReading(s)
        : answer.kind === "rebuild"
          ? failEarly(answer.feedback, s.input.open)
          : stay(s);
    case "finding_unsure": {
      if (answer.kind !== "decide") return stay(s);
      const fix = new Set(answer.fix);
      return finish(s.why.from, Object.fromEntries(s.why.findings.map((f) => [f.id, fix.has(f.id) ? "fix" : "note"])));
    }
    case "reviewer_failed":
      return startReading(s);
    case "router_failed":
    case "matcher_failed":
      return [s.why.from, unanswered(s.why.from)];
  }
}

export const review = defineMachine({
  types: { model: {} as Review, msg: {} as ReviewMsg, ctx: undefined },
  cmds: [route, inspect, match, findMissing],
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    start: (s, m): Step => (s.phase === "idle" ? start(m.input) : stay(s)),
    resume: (s): Step => resume(s),
    answer: (s, m): Step => (s.phase === "parked" ? answerPark(s, m.answer) : stay(s)),
    route_ok: (s, m): Step => {
      const { key, relation } = m.value;
      if (s.phase === "scoping" && s.routed[key] === null) {
        return settleScope({ ...s, routed: { ...s.routed, [key]: relation } });
      }
      if (s.phase === "sorting" && s.routed[key] === null) {
        return settleFindings({ ...s, routed: { ...s.routed, [key]: relation } });
      }
      return stay(s);
    },
    route_err: (s): Step =>
      s.phase === "scoping" || s.phase === "sorting" ? park(s, { kind: "router_failed", from: s }) : stay(s),
    inspect_ok: (s, m): Step =>
      s.phase === "reading" && s.report === null ? settleReading({ ...s, report: m.value }) : stay(s),
    inspect_err: (s): Step => (s.phase === "reading" ? park(s, { kind: "reviewer_failed" }) : stay(s)),
    // A failed check is skipped, never parked: it only adds findings, so the round can be read without it.
    find_missing_ok: (s, m): Step =>
      s.phase === "reading" && s.missing === null ? settleReading({ ...s, missing: m.value }) : stay(s),
    find_missing_err: (s): Step =>
      s.phase === "reading" && s.missing === null ? settleReading({ ...s, missing: { kind: "unread" } }) : stay(s),
    match_ok: (s, m): Step =>
      s.phase === "matching" && s.matches[m.value.key] === null
        ? settleMatches({ ...s, matches: { ...s.matches, [m.value.key]: m.value.to ?? NONE } })
        : stay(s),
    match_err: (s): Step => (s.phase === "matching" ? park(s, { kind: "matcher_failed", from: s }) : stay(s)),
  },
});

/** Is review finished, one way or another? The lane reads this after every step it hands down. */
export const isOver = (s: Review): s is Extract<Review, { phase: "passed" | "failed" | "dropped" }> =>
  s.phase === "passed" || s.phase === "failed" || s.phase === "dropped";
