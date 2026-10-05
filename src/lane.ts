import { Cmd, defineMachine } from "@demlik/tea";
import { z } from "zod";
import { Issue, testNames } from "./issue.ts";

/** How many builds one issue gets before a person is asked. */
export const MAX_ATTEMPTS = 3;

/**
 * Write the issue's tests from its examples, lock them, and run them once on
 * the code before anyone changed it. Code writes them, so a test asserts
 * exactly its example and no model decides whether a criterion is met.
 */
export const prepare = Cmd.define("prepare", {
  input: z.object({ issue: Issue }),
  ok: z.object({
    passing: z.array(z.string()).readonly(),
    failing: z.array(z.string()).readonly(),
    output: z.string(),
  }),
  err: ["could_not_run"],
});

/**
 * Ask the builder for a change. `feedback` is why the last attempt was sent
 * back. `session` is the builder's own conversation, named by the lane before
 * the first build, so a build killed halfway is picked up in the same
 * conversation and a retry remembers what it tried.
 */
export const build = Cmd.define("build", {
  input: z.object({
    issue: Issue,
    feedback: z.string().nullable(),
    session: z.object({
      id: z.string(),
      /** Whether the conversation may already exist: any build but a lane's very first. */
      continues: z.boolean(),
    }),
  }),
  ok: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("done"), summary: z.string() }),
    z.object({
      kind: z.literal("contradiction"),
      criterion: z.string(),
      call: z.string(),
      why: z.string(),
    }),
    z.object({ kind: z.literal("blocked"), why: z.string() }),
  ]),
  err: ["agent_failed"],
});

/** Run the tests and read the diff. No model is involved in this one. */
export const check = Cmd.define("check", {
  input: z.object({}),
  ok: z.object({
    passed: z.boolean(),
    output: z.string(),
    diff: z.string(),
    passingTests: z.array(z.string()).readonly(),
    touched: z.array(z.string()).readonly(),
  }),
  err: ["could_not_run"],
});

/** Why a lane stopped and is waiting on a person. The list is closed. */
export type ParkCause =
  /** Rules no call can show yet: a check for their kind does not exist. */
  | { readonly kind: "unchecked"; readonly criteria: readonly string[] }
  /** Examples whose tests did not run at all on the untouched code: a call that does not parse, say. */
  | { readonly kind: "tests_broken"; readonly missing: readonly string[]; readonly output: string }
  /** Every example already holds on the untouched code. */
  | { readonly kind: "nothing_to_build"; readonly passing: readonly string[] }
  | { readonly kind: "could_not_run"; readonly step: "prepare" | "check" }
  | { readonly kind: "builder_failed" }
  | { readonly kind: "builder_blocked"; readonly why: string }
  /** The builder says an example breaks its own rule. Both are shown, side by side. */
  | {
      readonly kind: "contradiction";
      readonly criterion: string;
      readonly rule: string;
      readonly call: string;
      readonly result: string;
      readonly why: string;
    }
  | { readonly kind: "out_of_attempts"; readonly feedback: string };

type Drop = { readonly kind: "drop" };

/**
 * What a person may answer to each park, and nothing else. An answer that
 * does not fit the park the lane is in leaves it parked.
 */
export interface ParkAnswers {
  /** `skip`: build against the example criteria alone. */
  readonly unchecked: { readonly kind: "skip" } | Drop;
  readonly tests_broken: { readonly kind: "retry" } | Drop;
  /** `accept`: the work is already done. */
  readonly nothing_to_build: { readonly kind: "accept" } | Drop;
  readonly could_not_run: { readonly kind: "retry" } | Drop;
  readonly builder_failed: { readonly kind: "retry" } | Drop;
  readonly builder_blocked: { readonly kind: "rebuild"; readonly feedback: string } | Drop;
  /** `keep`: the example stands, and the builder is told so. */
  readonly contradiction: { readonly kind: "keep"; readonly note: string } | Drop;
  readonly out_of_attempts: { readonly kind: "more"; readonly attempts: number } | Drop;
}

/** An answer to one kind of park, tagged with the park it answers. */
export type ParkAnswer = {
  [K in keyof ParkAnswers]: { readonly park: K; readonly answer: ParkAnswers[K] };
}[keyof ParkAnswers];

type Working = {
  readonly issue: Issue;
  readonly attempt: number;
  /** How many builds this lane may have; a person can raise it. */
  readonly limit: number;
  /** The builder's conversation. */
  readonly session: string;
};

const working = (s: Working): Working => ({
  issue: s.issue,
  attempt: s.attempt,
  limit: s.limit,
  session: s.session,
});

export type Lane =
  | { readonly phase: "idle" }
  | (Working & { readonly phase: "preparing" })
  | (Working & { readonly phase: "building"; readonly feedback: string | null })
  | (Working & { readonly phase: "checking" })
  | (Working & { readonly phase: "done" })
  | (Working & { readonly phase: "parked"; readonly why: ParkCause })
  | (Working & { readonly phase: "dropped"; readonly why: ParkCause });

export type LaneMsg =
  /** `session` names the builder's conversation; the host makes it, so the reducer stays pure. */
  | { readonly type: "start"; readonly issue: Issue; readonly session: string }
  /** Sent once after booting from saved state: re-issue whatever was in flight. */
  | { readonly type: "resume"; readonly at: number }
  | { readonly type: "answer"; readonly answer: ParkAnswer; readonly at: number };

export type LaneCmd =
  | ReturnType<typeof prepare>
  | ReturnType<typeof build>
  | ReturnType<typeof check>;

type Step = readonly [Lane, readonly LaneCmd[]];
type Parked = Extract<Lane, { phase: "parked" }>;
type Building = Extract<Lane, { phase: "building" }>;

const stay = (s: Lane): Step => [s, []];

const park = (s: Working, why: ParkCause): Step => [
  { phase: "parked", ...working(s), why },
  [],
];

const startPreparing = (s: Working): Step => [
  { phase: "preparing", ...working(s) },
  [prepare({ issue: s.issue })],
];

/** The build Cmd for a lane in `s`. Only a lane's very first build starts a new conversation. */
const buildFor = (s: Working, feedback: string | null, continues: boolean) =>
  build({ issue: s.issue, feedback, session: { id: s.session, continues } });

/** Build again, one attempt further on. */
function rebuild(s: Working, feedback: string): Step {
  const next = { ...working(s), attempt: s.attempt + 1 };
  return [{ phase: "building", ...next, feedback }, [buildFor(next, feedback, true)]];
}

/** Send the work back to the builder, or park once the attempts are spent. */
function rebuildOrPark(s: Working, feedback: string): Step {
  return s.attempt >= s.limit
    ? park(s, { kind: "out_of_attempts", feedback })
    : rebuild(s, feedback);
}

/**
 * The tests ran on the untouched code. Every example must have run, and at
 * least one must fail: an issue whose examples all hold already has nothing
 * for a builder to do. An example that holds already is kept, as a guard.
 */
function prepared(
  s: Working,
  { passing, failing, output }: { readonly passing: readonly string[]; readonly failing: readonly string[]; readonly output: string },
): Step {
  const ran = new Set([...passing, ...failing]);
  const missing = testNames(s.issue).filter((name) => !ran.has(name));
  if (missing.length > 0) return park(s, { kind: "tests_broken", missing, output });
  if (failing.length === 0) return park(s, { kind: "nothing_to_build", passing });
  return [{ phase: "building", ...working(s), feedback: null }, [buildFor(s, null, false)]];
}

/** The builder says an example breaks its rule. Park on it if the example is real. */
function contradicted(s: Building, answer: { readonly criterion: string; readonly call: string; readonly why: string }): Step {
  const criterion = s.issue.criteria.find((c) => c.id === answer.criterion);
  const example =
    criterion?.kind === "example" ? criterion.examples.find((e) => e.call === answer.call) : undefined;
  if (criterion === undefined || example === undefined) {
    return rebuildOrPark(
      s,
      `You named ${answer.call} under "${answer.criterion}", and the issue has no such example. Name one exactly as the tests have it, or finish the work.`,
    );
  }
  return park(s, {
    kind: "contradiction",
    criterion: criterion.id,
    rule: criterion.rule,
    call: example.call,
    result: example.result,
    why: answer.why,
  });
}

/**
 * Re-issue what a lane booted from saved state was waiting on. A Cmd that was
 * in flight when the process died may run a second time: that is the window
 * tea names, and the builder resumes its own conversation to make it cheap.
 */
function resume(s: Lane): Step {
  switch (s.phase) {
    case "preparing":
      return [s, [prepare({ issue: s.issue })]];
    case "building":
      return [s, [buildFor(s, s.feedback, true)]];
    case "checking":
      return [s, [check({})]];
    default:
      return stay(s);
  }
}

/** A person's answer to the park the lane is in. Any other answer changes nothing. */
function answerPark(s: Parked, { park: kind, answer }: ParkAnswer): Step {
  if (kind !== s.why.kind) return stay(s);
  if (answer.kind === "drop") return [{ ...s, phase: "dropped" }, []];
  switch (s.why.kind) {
    case "unchecked":
    case "tests_broken":
      return startPreparing(s);
    case "nothing_to_build":
      return [{ phase: "done", ...working(s) }, []];
    case "could_not_run":
      return s.why.step === "prepare"
        ? startPreparing(s)
        : [{ phase: "checking", ...working(s) }, [check({})]];
    case "builder_failed":
      return [{ phase: "building", ...working(s), feedback: null }, [buildFor(s, null, true)]];
    case "builder_blocked":
      return answer.kind === "rebuild" ? rebuild(s, answer.feedback) : stay(s);
    case "contradiction":
      return answer.kind === "keep"
        ? rebuild(
            s,
            `A person checked ${s.why.call} -> ${s.why.result} against "${s.why.rule}": the example stands.${answer.note === "" ? "" : ` ${answer.note}`}`,
          )
        : stay(s);
    case "out_of_attempts":
      return answer.kind === "more"
        ? rebuild({ ...working(s), limit: s.limit + answer.attempts }, s.why.feedback)
        : stay(s);
  }
}

/**
 * One issue, from "start" to done or parked: write its tests, build, run the
 * tests. Every cell ignores a Msg that arrives in a phase it does not belong
 * to, so a late answer changes nothing.
 */
export const lane = defineMachine({
  types: { model: {} as Lane, msg: {} as LaneMsg, ctx: undefined },
  cmds: [prepare, build, check],
  init: (loaded) => [loaded ?? { phase: "idle" }, []],
  update: {
    start: (s, m): Step => {
      if (s.phase !== "idle") return stay(s);
      const first: Working = { issue: m.issue, attempt: 1, limit: MAX_ATTEMPTS, session: m.session };
      const unchecked = m.issue.criteria.flatMap((c) => (c.kind === "unchecked" ? [c.id] : []));
      return unchecked.length > 0
        ? park(first, { kind: "unchecked", criteria: unchecked })
        : startPreparing(first);
    },
    resume: (s): Step => resume(s),
    answer: (s, m): Step => (s.phase === "parked" ? answerPark(s, m.answer) : stay(s)),
    prepare_ok: (s, m): Step => (s.phase === "preparing" ? prepared(s, m.value) : stay(s)),
    prepare_err: (s): Step =>
      s.phase === "preparing" ? park(s, { kind: "could_not_run", step: "prepare" }) : stay(s),
    build_ok: (s, m): Step => {
      if (s.phase !== "building") return stay(s);
      switch (m.value.kind) {
        case "done":
          return [{ phase: "checking", ...working(s) }, [check({})]];
        case "contradiction":
          return contradicted(s, m.value);
        case "blocked":
          return park(s, { kind: "builder_blocked", why: m.value.why });
      }
    },
    build_err: (s): Step =>
      s.phase === "building" ? park(s, { kind: "builder_failed" }) : stay(s),
    check_ok: (s, m): Step => {
      if (s.phase !== "checking") return stay(s);
      if (m.value.touched.length > 0) {
        return rebuildOrPark(
          s,
          `You changed ${m.value.touched.join(", ")}, which you may not change. It was put back. Change the code instead.`,
        );
      }
      return m.value.passed
        ? [{ phase: "done", ...working(s) }, []]
        : rebuildOrPark(s, `Tests failed:\n${m.value.output}`);
    },
    check_err: (s): Step =>
      s.phase === "checking" ? park(s, { kind: "could_not_run", step: "check" }) : stay(s),
  },
});
