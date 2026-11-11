import { Effect, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YES,
  type Ran,
  TIMED_OUT,
  keptGoingOn,
  pushToMain,
  lane,
  codexRuns,
  remoteGit,
  heldAt,
  askedFor,
  inClone,
  holds,
  roundsOf,
  moveMain,
  headBefore,
  TOUCHED,
  REDONE_MARK,
  WRITES_REDONE,
  REDO,
  SEE,
  answeredWith,
} from "./lane-harness.ts";

// A test writer's restart and redo when a stopped lane is typed again, and a writer whose run on the
// base fails. The shared setup is in ./lane-harness.ts. Today's version.

describe("a stopped lane, typed again", () => {
  beforeEach(() => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Tracker 194: only a restart before the test writer, or at a first one, starts the branch over.
  // Any other keeps the work on it: the restart names no kept ref, and the branch goes on from its head.
  describe("a restart past a first test writer", () => {
    /** Ticket 117's failure, as the box would tell it. Made up: the cause and the code. */
    const NO_REPORT = { why: "no_report", code: 1, ms: 726_000, tail: "Error: boom" } as const;
    /** The restarts on the ticket, in turn. */
    const restartsOf = (ran: Ran) => ran.facts.filter((f) => f.type === "restarted");
    /** A restart that put the branch on main as it was: no kept ref, and its head goes on. */
    const keptItsBranch = (restart: Ran["facts"][number] | undefined, said: string) => {
      expect(restart, said).toBeDefined();
      expect(restart?.head, said).toMatch(/^[0-9a-f]{40}$/);
      expect(restart?.head, "the branch held work main lacks").not.toBe(restart?.onto);
      expect(restart, said).not.toHaveProperty("kept");
      expect(restart?.to, said).not.toBe(restart?.onto);
    };

    // A run on the base that fails is stuck, never let through, so no build starts on tests that never
    // ran there (stages/test-writer/machine.ts). A redo's run is no different.
    it("exam_touched, `test_wrong`, and every run of the redo on the base fails: it ends stuck `run_failed` with the cause, and the lane stops at the test writer in round 2, with no build on the redo", async () => {
      const ran = await lane({
        within: 50,
        picks: YES,
        queues: { exam_touched: ["test_wrong"] },
        failOnBase: NO_REPORT,
        failOnBaseFrom: 1,
        fake: {
          writesAt: { build: { 0: [{ path: "src/lower.test.ts", text: TOUCHED }] } },
          answers: REDO,
          see: SEE,
        },
      });
      const said = ran.lines.join("\n");
      expect(ran.lines, said).not.toContain(TIMED_OUT);
      // The redo's run failed: its end says why, beside `run_failed`.
      const asked = ran.facts.findIndex((f) => f.type === "asked" && String(f.ask).startsWith("a-exam_touched-"));
      expect(asked, said).toBeGreaterThan(-1);
      const redo = ran.facts.slice(asked).find((f) => f.type === "ended" && f.stage === "test_writer");
      expect(redo?.outcome, said).toEqual({ kind: "stuck", why: "run_failed" });
      expect(redo?.failure).toEqual(NO_REPORT);
      // The lane stops there, in the round exam_touched's `test_wrong` sent it to.
      expect(roundsOf(ran, "build"), said).toEqual([1]);
      expect(heldAt(ran, 0)?.at, said).toEqual({ _tag: "run", step: "test_writer" });
      expect(heldAt(ran, 0)?.held.round).toBe(2);
    });

    it("stopped at the test writer in round 2, typed again: the branch goes on from its head", async () => {
      const ran = await lane({
        within: 50,
        picks: YES,
        failOnBase: NO_REPORT,
        again: [
          {
            between: ({ home }) => keptGoingOn(home, { at: { _tag: "run", step: "test_writer" }, round: 2 }),
          },
        ],
      });
      const said = ran.lines.join("\n");
      expect(ran.lines, said).not.toContain(TIMED_OUT);
      expect(heldAt(ran, 0)?.at, said).toEqual({ _tag: "run", step: "test_writer" });
      const restarts = restartsOf(ran);
      expect(restarts, said).toHaveLength(1);
      expect(restarts[0]).toMatchObject({ from: "test_writer" });
      keptItsBranch(restarts[0], said);
      expect(restarts[0]?.to).toBe(restarts[0]?.head);
    });

    it("a `stop` on exam_conflict in round 1, typed again: the restart at that ask keeps the branch, and asks again", async () => {
      const ON_MAIN =
        'import {expect, it} from "vitest";\n\nit("lowers on main", () => {\n\texpect("AB".toLowerCase()).toBe("ab");\n});\n';
      const ran = await lane({
        within: 50,
        picks: { ...YES, exam_conflict: "stop" },
        failMutation: true,
        again: [
          {
            between: (where) => Effect.sync(() => pushToMain(where, [{ path: "src/lower.test.ts", text: ON_MAIN }])),
          },
          {},
        ],
      });
      const said = ran.lines.join("\n");
      expect(ran.lines, said).not.toContain(TIMED_OUT);
      expect(heldAt(ran, 1)?.at, said).toEqual({
        _tag: "ask",
        for: "exam_conflict",
        step: "test_writer",
      });
      expect(heldAt(ran, 1)?.held.round).toBe(1);
      const restarts = restartsOf(ran);
      expect(restarts, said).toHaveLength(2);
      expect(restarts[1]).toMatchObject({ from: "test_writer" });
      keptItsBranch(restarts[1], said);
      expect(askedFor(ran, "exam_conflict"), said).toHaveLength(2);
      expect(codexRuns(ran.dir).filter((r) => r.step === "tests")).toHaveLength(1);
    });

    it("a stop that goes on at the test writer as the next round, in round 1, typed again: the branch goes on from its head", async () => {
      const ran = await lane({
        within: 50,
        picks: YES,
        failOnBase: NO_REPORT,
        again: [
          {
            between: ({ home }) => keptGoingOn(home, { at: { _tag: "run", step: "test_writer", round: "next" } }),
          },
        ],
      });
      const said = ran.lines.join("\n");
      expect(ran.lines, said).not.toContain(TIMED_OUT);
      expect(heldAt(ran, 0)?.held.round, said).toBe(1);
      const restarts = restartsOf(ran);
      expect(restarts, said).toHaveLength(1);
      expect(restarts[0]).toMatchObject({ from: "test_writer" });
      keptItsBranch(restarts[0], said);
      expect(restarts[0]?.to).toBe(restarts[0]?.head);
    });

    it("stopped at the build in round 1 while main moves: the restart rebases the test writer's commit onto main, and the writer does not run again", async () => {
      const ran = await lane({
        within: 50,
        picks: YES,
        ticketAfter: [
          { step: "test_writer", fact: "closed" },
          { step: "build", fact: "reopened" },
        ],
        again: [{ between: moveMain }],
      });
      const said = ran.lines.join("\n");
      expect(ran.lines, said).not.toContain(TIMED_OUT);
      expect(heldAt(ran, 0)?.at, said).toEqual({ _tag: "run", step: "build" });
      expect(heldAt(ran, 0)?.held.round).toBe(1);
      const restarts = restartsOf(ran);
      expect(restarts, said).toHaveLength(1);
      expect(restarts[0]).toMatchObject({ from: "build", head: headBefore(ran), conflicts: [] });
      keptItsBranch(restarts[0], said);
      const to = String(restarts[0]?.to);
      expect(to).not.toBe(restarts[0]?.head);
      expect(holds(ran, to, "docs/elsewhere.md")).toBe(true);
      expect(holds(ran, to, "src/lower.test.ts")).toBe(true);
      expect(
        codexRuns(ran.dir).filter((r) => r.step === "tests"),
        said,
      ).toHaveLength(1);
      expect(ran.lines.at(-1)).toContain("ended: done");
    });
  });

  // Tracker 193: a redo that keeps its commit but is sent back to the writer, by the route (rows 28,
  // 29 and 35, ./routes.ts) or by the owner's `again`, stays owed. Each run after it is the redo
  // again, of the touched file alone, and no build starts on tests the base never passed.
  describe("a redo sent back to the writer", () => {
    /** The plain plan's one Property, as `behavior` says it. */
    const property = (behavior: "new" | "existing") => ({
      when: "a name holds capitals",
      result: "it comes back in lower case",
      why: "two forms of one name would not match",
      behavior,
      tool: "test",
      code: [],
    });

    it.each([
      {
        name: "ask:owner:fails_on_base",
        outcome: { kind: "ask", who: "owner", for: "fails_on_base" },
        behavior: "existing",
        first: "green",
        redo: "red",
      },
      {
        name: "ask:owner:already_passes",
        outcome: { kind: "ask", who: "owner", for: "already_passes" },
        behavior: "new",
        first: "red",
        redo: "green",
      },
      {
        name: "stuck:no_result",
        outcome: { kind: "stuck", why: "no_result" },
        behavior: "new",
        first: "red",
        redo: null,
      },
    ] as const)(
      "exam_touched, `test_wrong`, and the redo ends $name each time: the route's rerun and the owner's `again` are the redo again, never `skip:no_properties`, and no build starts",
      async ({ outcome, behavior, first, redo }) => {
        const ran = await lane({
          within: 50,
          picks: YES,
          queues: { exam_touched: ["test_wrong"], step: ["again", "stop"] },
          onBaseSays: (nth, tests) =>
            nth > 0 && redo === null
              ? []
              : tests.map((t) => ({
                  property: t.property,
                  result: nth === 0 ? first : (redo ?? first),
                })),
          fake: {
            writesAt: { build: { 0: [{ path: "src/lower.test.ts", text: TOUCHED }] } },
            // Every redo writes the touched file again, as a writer told to redo it does.
            answers: {
              ...REDO,
              tests: [null, ...Array.from({ length: 6 }, () => WRITES_REDONE)],
              plan: [{ with: { properties: [property(behavior)] } }],
            },
            see: SEE,
          },
        });
        const said = ran.lines.join("\n");
        expect(ran.lines, said).not.toContain(TIMED_OUT);
        const asked = ran.facts.findIndex((f) => f.type === "asked" && String(f.ask).startsWith("a-exam_touched-"));
        expect(asked, said).toBeGreaterThan(-1);
        // Every writer's end after the owner's `test_wrong` is the redo's: none skips.
        const ends = ran.facts.slice(asked).filter((f) => f.type === "ended" && f.stage === "test_writer");
        expect(
          ends.map((f) => f.outcome),
          said,
        ).toEqual(ends.map(() => outcome));
        expect(ends.length, said).toBeGreaterThanOrEqual(3);
        // Each of them ran the touched file's test on the base, and nothing else.
        const redos = ran.onBase.slice(1);
        expect(
          redos.map((r) => r.files),
          said,
        ).toEqual(ends.map(() => ["src/lower.test.ts"]));
        // The route's one rerun asks the owner; `again` runs the redo, and `stop` stops at it.
        expect(askedFor(ran, "step"), said).toHaveLength(2);
        expect(roundsOf(ran, "build"), said).toEqual([1]);
        expect(heldAt(ran, 0)?.at, said).toEqual({ _tag: "run", step: "test_writer" });
      },
    );

    // The other way through `writtenAgain`'s `passed`: a redo that tests one Property and says no
    // test can check the other ends `cannot_test`, and every test it wrote did as the plan says.
    // The person lets the rest through, and the redo goes on the head as a `done` one does.
    // scenario: the real test writer process reopens a temporary checkout and refuses a redo there.
    it("scenario: exam_touched, `test_wrong`, and the redo ends ask:owner:cannot_test: after the owner's `go_on`, the redo is on the build's head and nothing is touched", async () => {
      const SECOND = {
        ...property("new"),
        when: "a name is in lower case already",
        result: "it comes back as it was",
      };
      /** The first writer's file: one test for each Property. */
      const BOTH =
        'import {expect, it} from "vitest";\nimport {lower} from "./lower.ts";\n\nit("lowers capitals", () => {\n\texpect(lower("AB")).toBe("ab");\n});\n\nit("keeps lower case", () => {\n\texpect(lower("ab")).toBe("ab");\n});\n';
      const ran = await lane({
        within: 50,
        picks: YES,
        queues: { exam_touched: ["test_wrong"], step: ["go_on"] },
        onBaseSays: (_, tests) => tests.map((t) => ({ property: t.property, result: "red" })),
        fake: {
          writesAt: { build: { 0: [{ path: "src/lower.test.ts", text: TOUCHED }] } },
          answers: {
            tests: [
              {
                with: {
                  files: [{ path: "src/lower.test.ts", text: BOTH }],
                  answers: [
                    {
                      property: "p1",
                      kind: "test",
                      file: "src/lower.test.ts",
                      name: "lowers capitals",
                    },
                    {
                      property: "p2",
                      kind: "test",
                      file: "src/lower.test.ts",
                      name: "keeps lower case",
                    },
                  ],
                },
              },
              {
                with: {
                  ...WRITES_REDONE.with,
                  answers: [
                    ...WRITES_REDONE.with.answers,
                    { property: "p2", kind: "cannot", why: "no test can tell it from a copy" },
                  ],
                },
              },
            ],
            plan: [{ with: { properties: [property("new"), SECOND] } }],
          },
          see: SEE,
        },
      });
      const said = ran.lines.join("\n");
      expect(ran.lines, said).not.toContain(TIMED_OUT);
      const asked = ran.facts.findIndex((f) => f.type === "asked" && String(f.ask).startsWith("a-exam_touched-"));
      expect(asked, said).toBeGreaterThan(-1);
      const redo = ran.facts.slice(asked).find((f) => f.type === "ended" && f.stage === "test_writer");
      expect(redo?.outcome, said).toEqual({ kind: "ask", who: "owner", for: "cannot_test" });
      expect(answeredWith(ran, "go_on"), said).toHaveLength(1);
      const { head, touched } = Schema.decodeUnknownSync(
        Schema.Struct({ head: Schema.String, touched: Schema.Array(Schema.String) }),
      )(redo?.carry);
      expect(touched).toEqual([]);
      expect(inClone(ran, "show", `${head}:src/lower.test.ts`)).toContain(REDONE_MARK);
      // The build goes on from that head, as its next round.
      const builds = codexRuns(ran.dir).filter((r) => r.step === "build");
      expect(builds, said).toHaveLength(2);
      expect(builds[1]?.seen["src/lower.test.ts"]).toContain(REDONE_MARK);
      expect(roundsOf(ran, "build"), said).toEqual([1, 2]);
    });
  });
});

// Tracker 193 and 194, from ticket 117: its test writer's run on the base failed and said nothing,
// and a restart there would have rebased the writer's commit onto a main that added the same file.
describe("a test writer whose run on the base fails", () => {
  beforeEach(() => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Ticket 117's failure, as the box would tell it. Made up: the cause and the code. */
  const NO_REPORT = { why: "no_report", code: 1, ms: 726_000, tail: "Error: boom" } as const;
  /** The writer's ends on the ticket, in turn. */
  const writerEnds = (ran: Ran) => ran.facts.filter((f) => f.type === "ended" && f.stage === "test_writer");

  it("keeps the cause on its `ended`, and the stuck comment names the cause and each row it could not test", async () => {
    const NEVER = "no test can build a name with no letters";
    const SECOND = {
      when: "a name has no letters",
      result: "it comes back as it was",
      why: "an empty form would match every other",
      behavior: "new",
      tool: "test",
      code: [],
    };
    /** The fake writer's answer: one test, and one Property it says no test can check. */
    const ONE_EACH = {
      with: {
        answers: [
          { property: "p1", kind: "test", file: "src/lower.test.ts", name: "lowers capitals" },
          { property: "p2", kind: "cannot", why: NEVER },
        ],
      },
    };
    const ran = await lane({
      within: 50,
      picks: YES,
      failOnBase: NO_REPORT,
      fake: {
        answers: {
          plan: [
            {
              with: {
                properties: [
                  {
                    when: "a name holds capitals",
                    result: "it comes back in lower case",
                    why: "two forms of one name would not match",
                    behavior: "new",
                    tool: "test",
                    code: [],
                  },
                  SECOND,
                ],
              },
            },
          ],
          tests: [ONE_EACH, ONE_EACH, ONE_EACH, ONE_EACH],
        },
      },
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    const [first] = writerEnds(ran);
    expect(first?.outcome, said).toEqual({ kind: "stuck", why: "run_failed" });
    expect(first?.failure).toEqual(NO_REPORT);
    expect(first?.carry).toMatchObject({ cannot: [{ when: SECOND.when, why: NEVER }] });
    const stuck = ran.facts
      .filter((f) => f.type === "commented")
      .map((f) => String(f.body))
      .filter((body) => body.startsWith("test_writer is stuck."));
    expect(stuck, said).not.toEqual([]);
    expect(stuck[0]).toContain("no_report");
    expect(stuck[0]).toContain(SECOND.when);
    expect(stuck[0]).toContain(NEVER);
  });

  it("stopped at round 1 while main adds the writer's own file: the restart starts over from main, keeps the old commit, asks no exam_conflict, and the writer runs on main", async () => {
    const ON_MAIN =
      'import {expect, it} from "vitest";\n\nit("lowers on main", () => {\n\texpect("AB".toLowerCase()).toBe("ab");\n});\n';
    const ran = await lane({
      within: 50,
      picks: { ...YES, exam_conflict: "again" },
      failOnBase: NO_REPORT,
      again: [
        {
          between: (where) => Effect.sync(() => pushToMain(where, [{ path: "src/lower.test.ts", text: ON_MAIN }])),
        },
      ],
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    // The first line stopped at the test writer, in its first round.
    expect(heldAt(ran, 0)?.at, said).toEqual({ _tag: "run", step: "test_writer" });
    expect(heldAt(ran, 0)?.held.round).toBe(1);

    expect(askedFor(ran, "exam_conflict"), said).toEqual([]);
    const restarted = ran.facts.filter((f) => f.type === "restarted");
    expect(restarted, said).toHaveLength(1);
    const [restart] = restarted;
    expect(restart).toMatchObject({
      from: "test_writer",
      conflicts: [],
      kept: expect.stringMatching(/^refs\/kept\//),
    });
    // The old commit stays under the kept ref, on the remote.
    const kept = String(restart?.kept);
    expect(remoteGit(ran.remote, "rev-parse", kept)).toBe(String(restart?.head));
    // The writer after the restart starts on main as the restart read it.
    const at = ran.facts.indexOf(restart ?? { type: "" });
    const after = ran.facts.slice(at).find((f) => f.type === "ended" && f.stage === "test_writer");
    expect((after?.carry as { readonly base?: string } | undefined)?.base, said).toBe(restart?.onto);
  });
});
