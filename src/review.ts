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
export const Finding = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number(),
  quote: z.string(),
  problem: z.string(),
  seen: z.string(),
});
export type Finding = z.infer<typeof Finding>;

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
const Spotted = Finding.omit({ id: true, seen: true });
export type Spotted = z.infer<typeof Spotted>;

/**
 * Ask the reviewer to read the diff. It returns new findings, and for each
 * finding still open from an earlier round, whether it is fixed now.
 */
export const inspect = Cmd.define("inspect", {
  input: z.object({ issue: Issue, diff: z.string(), open: z.array(Finding).readonly() }),
  ok: z.object({
    findings: z.array(Spotted).readonly(),
    rechecks: z.array(z.object({ id: z.string(), fixed: z.boolean() })).readonly(),
  }),
  err: ["agent_failed"],
});

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
}

export type RoutedDeviation = Deviation & { readonly relation: Relation };

type Held = { readonly input: ReviewInput; readonly extra: readonly Deviation[] };

type Scoping = Held & {
  readonly phase: "scoping";
  readonly routed: Readonly<Record<string, Relation | null>>;
};
type Sorting = Held & {
  readonly phase: "sorting";
  /** New findings whose quotes are in the diff, waiting on the router. */
  readonly found: readonly Finding[];
  /** Open findings the reviewer says are not fixed. */
  readonly still: readonly Finding[];
  /** Findings on lines the diff did not touch: filed, never blocking. */
  readonly notes: readonly Finding[];
  readonly routed: Readonly<Record<string, Relation | null>>;
};

/** Why review stopped and is waiting on a person. */
export type ReviewPark =
  | { readonly kind: "scope_unsure"; readonly deviations: readonly RoutedDeviation[] }
  | {
      readonly kind: "finding_unsure";
      readonly findings: readonly Finding[];
      readonly from: Sorting;
    }
  | { readonly kind: "reviewer_failed" }
  | { readonly kind: "router_failed"; readonly from: Scoping | Sorting };

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
}

export type ReviewParkAnswer = {
  [K in keyof ReviewParkAnswers]: { readonly park: K; readonly answer: ReviewParkAnswers[K] };
}[keyof ReviewParkAnswers];

export type Review =
  | { readonly phase: "idle" }
  | Scoping
  | (Held & { readonly phase: "reading" })
  | Sorting
  | (Held & { readonly phase: "parked"; readonly why: ReviewPark })
  /** The change may go on. `deviations` and `notes` are for the person who reads the result. */
  | {
      readonly phase: "passed";
      readonly deviations: readonly Deviation[];
      readonly notes: readonly Finding[];
    }
  /** Back to the builder. `open` is every finding it must fix; `notes` were filed this round. */
  | {
      readonly phase: "failed";
      readonly feedback: string;
      readonly open: readonly Finding[];
      readonly notes: readonly Finding[];
    }
  | { readonly phase: "dropped"; readonly why: ReviewPark };

export type ReviewMsg =
  | { readonly type: "start"; readonly input: ReviewInput }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume" }
  | { readonly type: "answer"; readonly answer: ReviewParkAnswer };

export type ReviewCmd = ReturnType<typeof route> | ReturnType<typeof inspect>;
type Step = readonly [Review, readonly ReviewCmd[]];

const stay = (s: Review): Step => [s, []];
const held = (s: Held): Held => ({ input: s.input, extra: s.extra });
const park = (s: Held, why: ReviewPark): Step => [{ phase: "parked", ...held(s), why }, []];
const fail = (feedback: string, open: readonly Finding[], notes: readonly Finding[] = []): Step => [
  { phase: "failed", feedback, open, notes },
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
 * Whether an open finding is fixed. The reviewer's word is not enough: the
 * file must also differ from when the finding was made, or be out of the
 * change altogether. A "fixed" on an untouched file keeps the finding open.
 */
function isFixed(snapshot: Snapshot, f: Finding, saysFixed: boolean): boolean {
  const file = snapshot[f.file];
  return saysFixed && (file === undefined || fingerprint(file.text) !== f.seen);
}

const describe = (f: Finding) => `- [${f.id}] ${f.file}:${f.line} \`${f.quote.trim()}\`: ${f.problem}`;

const startReading = (s: Held): Step => [
  { phase: "reading", ...held(s) },
  [inspect({ issue: s.input.issue, diff: s.input.diff, open: s.input.open })],
];

const routeChange = (s: Held, d: Deviation) =>
  route({ key: d.file, about: "change", text: d.why, goal: s.input.issue.goal });
const routeFinding = (s: Held, f: Finding) =>
  route({ key: f.id, about: "finding", text: f.problem, goal: s.input.issue.goal });

/** The questions still out in a routing phase, asked again. */
const unanswered = (s: Scoping | Sorting): readonly ReviewCmd[] =>
  s.phase === "scoping"
    ? s.extra.filter((d) => s.routed[d.file] === null).map((d) => routeChange(s, d))
    : s.found.filter((f) => s.routed[f.id] === null).map((f) => routeFinding(s, f));

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
    return fail(
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
    return fail(
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
 * its file has changed since. The new findings in the diff go to the router.
 */
function read(
  s: Held,
  report: { readonly findings: readonly Spotted[]; readonly rechecks: readonly { readonly id: string; readonly fixed: boolean }[] },
): Step {
  const { snapshot } = s.input;
  const named = report.findings.map((f, i) => ({
    ...f,
    id: `r${s.input.round}-${i + 1}`,
    seen: fingerprint(snapshot[f.file]?.text ?? ""),
  }));
  const found = named.filter((f) => placeOf(snapshot, f) === "in_diff");
  const notes = named.filter((f) => placeOf(snapshot, f) === "outside_diff");
  const still = s.input.open.filter(
    (f) => !isFixed(snapshot, f, report.rechecks.some((r) => r.id === f.id && r.fixed)),
  );
  const sorting: Sorting = {
    phase: "sorting",
    ...held(s),
    found,
    still,
    notes,
    routed: Object.fromEntries(found.map((f) => [f.id, null])),
  };
  return found.length === 0 ? finish(sorting, {}) : [sorting, unanswered(sorting)];
}

/** Every new finding has an answer; an unsure one parks, unless a person already decided. */
function settleFindings(s: Sorting): Step {
  if (s.found.some((f) => s.routed[f.id] === null)) return stay(s);
  const unsure = s.found.filter((f) => s.routed[f.id] === "unsure");
  return unsure.length > 0 ? park(s, { kind: "finding_unsure", findings: unsure, from: s }) : finish(s, {});
}

/**
 * How the round ends. Related findings and unfixed ones go back to the
 * builder; unrelated ones are filed. `decided` is a person's answer, which
 * outranks the router.
 */
function finish(s: Sorting, decided: Readonly<Record<string, "fix" | "note">>): Step {
  const fix = (f: Finding) => decided[f.id] === "fix" || (decided[f.id] === undefined && s.routed[f.id] === "related");
  const open = [...s.still, ...s.found.filter(fix)];
  const notes = [...s.notes, ...s.found.filter((f) => !fix(f))];
  if (open.length === 0) return [{ phase: "passed", deviations: s.extra, notes }, []];
  return fail(
    [
      `Review found problems to fix:`,
      ...open.map(describe),
      `If you think a finding is wrong, answer dispute with its id and why.`,
    ].join("\n"),
    open,
    notes,
  );
}

function resume(s: Review): Step {
  switch (s.phase) {
    case "scoping":
    case "sorting":
      return [s, unanswered(s)];
    case "reading":
      return startReading(s);
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
          ? fail(answer.feedback, s.input.open)
          : stay(s);
    case "finding_unsure": {
      if (answer.kind !== "decide") return stay(s);
      const fix = new Set(answer.fix);
      return finish(s.why.from, Object.fromEntries(s.why.findings.map((f) => [f.id, fix.has(f.id) ? "fix" : "note"])));
    }
    case "reviewer_failed":
      return startReading(s);
    case "router_failed":
      return [s.why.from, unanswered(s.why.from)];
  }
}

export const review = defineMachine({
  types: { model: {} as Review, msg: {} as ReviewMsg, ctx: undefined },
  cmds: [route, inspect],
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
    inspect_ok: (s, m): Step => (s.phase === "reading" ? read(s, m.value) : stay(s)),
    inspect_err: (s): Step => (s.phase === "reading" ? park(s, { kind: "reviewer_failed" }) : stay(s)),
  },
});

/** Is review finished, one way or another? The lane reads this after every step it hands down. */
export const isOver = (s: Review): s is Extract<Review, { phase: "passed" | "failed" | "dropped" }> =>
  s.phase === "passed" || s.phase === "failed" || s.phase === "dropped";
