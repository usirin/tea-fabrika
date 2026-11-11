import { Ledger, LedgerUnreachable, Stale, streams } from "@kampus/fabrika-old";
import { memoryService } from "@kampus/fabrika-old/memory";
import { demoFacts } from "@kampus/pipeline/asks/demo";
import { sendFact } from "@kampus/pipeline/asks/ledger";
import { readFacts } from "@kampus/pipeline/asks/ledger";
import { foldLedger } from "@kampus/pipeline/asks/rules";
import { planOf, ticketId } from "@kampus/pipeline/ids";
import { Asked, blindDraw, questionLine, sealAsk, Via } from "@kampus/pipeline/tickets/ask";
import { nameOf } from "@kampus/pipeline/tickets/ticket";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";
import { DRAFT, FILED, OWNER, policyFor, type Sealed } from "../../../fixtures/ask-desk/cases.ts";
import { property, ticketNumber, unicode } from "../../../fixtures/ask-desk/property.ts";
import { Author, prepareAsk, preparePending, saveCell } from "./ledger.ts";
import { save } from "./machine.ts";
import { Write } from "./ticket.ts";

// Today's version. The tracker's answer save and the sealing of parked old asks (P5, P21): a save
// that keeps meeting a newer stream gives up in words, and a parked old ask is sealed once, with
// only the evidence the ledger kept.
const LANE = "agent:lane for:owner";
const inbox = (n: number) => streams(nameOf(n)).inbox;
type Said = { readonly type: string; readonly [key: string]: unknown };

const send = (n: number, id: string, fact: Said, writer = LANE) =>
  Effect.gen(function* () {
    yield* (yield* Ledger).send(inbox(n), id, { kind: fact.type, writer, data: fact });
  });

const ticket = (n: number, ...facts: readonly Said[]) =>
  Effect.gen(function* () {
    yield* (yield* Ledger).register(nameOf(n), "user:owner");
    yield* send(n, "filed", { ...FILED }, "user:owner");

    for (const [i, fact] of facts.entries()) {
      yield* send(n, `fact/${i}`, fact);
    }
  });

const rows = (n: number) =>
  Effect.gen(function* () {
    return yield* (yield* Ledger).readStream(inbox(n));
  });

const asked = (n: number) =>
  Effect.map(rows(n), (all) => all.filter((r) => r.kind === "asked").map((r) => JSON.parse(r.data ?? "null")));

const run = <A, E>(effect: Effect.Effect<A, E, Ledger | Author>) =>
  Effect.runPromise(effect.pipe(Effect.provideService(Author, OWNER), Effect.provideService(Ledger, memoryService())));

const prepare: (n: number, ask: string, draft: unknown) => Effect.Effect<Sealed, unknown, Ledger | Author> = prepareAsk;

describe("ask desk P5: the answer save gives up on a stream that keeps changing", () => {
  property(
    "fails in words after a bounded number of stale appends, and writes nothing",
    { took: Via.cases.window.fields.took },
    async ({ took }) => {
      await run(
        Effect.gen(function* () {
          const ask = yield* sealAsk(DRAFT, policyFor(DRAFT.ask, false, blindDraw));
          yield* ticket(117, { type: "planned", version: 2, tasks: [] }, ask);
          const ledger = yield* Ledger;
          let appends = 0;
          const stale: typeof ledger = {
            ...ledger,
            append: (stream, rev) =>
              Effect.suspend(() => {
                appends++;
                return Effect.fail(new Stale({ stream, rev: typeof rev === "number" ? rev : 0 }));
              }),
          };
          const write = Schema.decodeUnknownSync(Write)({
            kind: "answer",
            ticket: 117,
            ask: ask.ask,
            answer: { _tag: "rec" },
            saw: ask.saw,
            via: { _tag: "window", took },
          });
          const result = yield* saveCell(save({ id: "click", next: 118, write })).pipe(
            Effect.provideService(Ledger, stale),
            Effect.flip,
            Effect.timeoutOption("10 seconds"),
          );
          expect(result).toMatchObject({ _tag: "Some", value: { _tag: "refused" } });
          expect(JSON.stringify(result)).toContain("The question kept changing");
          expect(appends).toBeGreaterThan(1);
          expect((yield* rows(117)).filter((r) => r.kind === "answered")).toEqual([]);
        }),
      );
    },
  );
  property(
    "says why in the person's words, with no ledger stream wording around them",
    { took: Via.cases.window.fields.took },
    async ({ took }) => {
      await run(
        Effect.gen(function* () {
          const ask = yield* sealAsk(DRAFT, policyFor(DRAFT.ask, false, blindDraw));
          yield* ticket(117, { type: "planned", version: 2, tasks: [] }, ask);
          const ledger = yield* Ledger;
          const stale: typeof ledger = {
            ...ledger,
            append: (stream, rev) => Effect.fail(new Stale({ stream, rev: typeof rev === "number" ? rev : 0 })),
          };
          const write = Schema.decodeUnknownSync(Write)({
            kind: "answer",
            ticket: 117,
            ask: ask.ask,
            answer: { _tag: "rec" },
            saw: ask.saw,
            via: { _tag: "window", took },
          });
          const error = yield* saveCell(save({ id: "click", next: 118, write })).pipe(
            Effect.provideService(Ledger, stale),
            Effect.flip,
          );
          expect(error).toEqual({ _tag: "refused", why: "The question kept changing. Try again." });
        }),
      );
    },
  );
});

const LEGACY = {
  type: "asked",
  ask: "a-approve-3",
  what: "Do you approve plan version 1?",
  picks: ["approve", "no"],
};

const restored = { ...DRAFT, rec: { _tag: "none", why: "No recommendation was recorded" } };

describe("ask desk P21: prepareAsk seals a parked ask", () => {
  property("seals an ask on a ticket nobody has answered yet", { n: ticketNumber }, async ({ n }) => {
    await run(
      Effect.gen(function* () {
        yield* ticket(n, LEGACY);
        const sealed = yield* prepare(n, "a-approve-3", restored);
        expect(sealed).toMatchObject({ format: 1, replaces: "a-approve-3" });
        expect(yield* prepare(n, "a-approve-3", restored)).toEqual(sealed);
      }),
    );
  });
  property("refuses an ask that was already answered", { n: ticketNumber }, async ({ n }) => {
    await run(
      Effect.gen(function* () {
        yield* ticket(n, LEGACY);
        yield* send(n, "answer", { type: "answered", ask: "a-approve-3", pick: "no", note: "" }, "user:owner");
        expect(yield* Effect.exit(prepare(n, "a-approve-3", restored))).toMatchObject({
          _tag: "Failure",
        });
        expect((yield* asked(n)).filter((a) => "format" in a)).toEqual([]);
      }),
    );
  });
});

/** Real plan revisions, as the pipeline stores them: experiment 89's cases. */
const demoPlans = () => demoFacts().flatMap((f) => (f.type === "planned" ? [f.data] : []));

/** The plans the pipeline stored: one for ticket 5 at two versions, and one for ticket 6. */
const stored = Effect.gen(function* () {
  const [first, second] = demoPlans();

  if (first === undefined || second === undefined) {
    return yield* Effect.die("no demo plans");
  }

  const five = ticketId("fixture/project#5");
  const six = ticketId("other/place#6");

  for (const [id, data, on] of [
    ["p1", first, five],
    ["p2", second, five],
    ["p3", first, six],
  ] as const) {
    yield* Effect.orDie(sendFact({ type: "planned", plan: planOf(on), tickets: [on], data, problems: [] }, { id }));
  }

  const track = foldLedger(yield* readFacts).plans.get(planOf(five));

  if (track === undefined) {
    return yield* Effect.die("the plan is missing");
  }

  return track;
});

const sealedOf = (all: readonly Record<string, unknown>[]) => all.flatMap((a) => (Schema.is(Asked)(a) ? [a] : []));

describe("ask desk P21: preparePending seals each parked old ask from what was kept", () => {
  property(
    "seals an approve ask with the plan at the ticket's planned version and the plan's repo",
    { version: Schema.Literals([1, 2]) },
    async ({ version }) => {
      await run(
        Effect.gen(function* () {
          const track = yield* stored;
          expect(track.versions.map((v) => v.version)).toEqual([1, 2]);
          yield* ticket(5, { type: "planned", version, tasks: [] }, LEGACY);
          yield* preparePending(5);
          const [sealed, ...more] = sealedOf(yield* asked(5));
          expect(more).toEqual([]);
          expect(sealed).toMatchObject({
            replaces: "a-approve-3",
            for: "approve",
            repo: "fixture/project",
            rec: { _tag: "none" },
            shows: {
              what: LEGACY.what,
              ticket: { title: FILED.title, body: FILED.body },
              evidence: { _tag: "plan", version, plan: track.versions[version - 1]?.data },
            },
          });
          expect(sealed?.shows.picks.map((p) => p.pick)).toEqual(["approve", "no"]);
          const withdrawn = (yield* rows(5)).filter((r) => r.kind === "withdrawn");
          expect(withdrawn).toHaveLength(1);
          // Review 8: code seals it, in its own name for the person, never as the old ask's author.
          expect(withdrawn[0]?.writer).toMatch(/^agent:\S+ for:owner$/);
          expect(withdrawn[0]?.writer).not.toBe(LANE);
        }),
      );
    },
  );
  property(
    "leaves an approve ask alone when no plan was stored for exactly this ticket",
    { version: Schema.Literals([1, 2]) },
    async ({ version }) => {
      await run(
        Effect.gen(function* () {
          yield* Effect.orDie(
            sendFact(
              {
                type: "planned",
                plan: planOf(ticketId("fixture/project#8")),
                tickets: [ticketId("fixture/project#8")],
                data: demoPlans()[0] ?? (yield* Effect.die("no demo plans")),
                problems: [],
              },
              { id: "p8" },
            ),
          );
          yield* ticket(5, { type: "planned", version, tasks: [] }, LEGACY);
          yield* preparePending(5);
          expect(sealedOf(yield* asked(5))).toEqual([]);
          expect((yield* rows(5)).filter((r) => r.kind === "withdrawn")).toEqual([]);
        }),
      );
    },
  );
  property(
    "seals a changed old ask with no replacement and leaves an answered old ask alone",
    { version: Schema.Literals([1, 2]) },
    async ({ version }) => {
      await run(
        Effect.gen(function* () {
          yield* stored;
          yield* ticket(
            5,
            { type: "planned", version, tasks: [] },
            LEGACY,
            { type: "withdrawn", ask: "a-approve-3", why: "changed" },
            { type: "asked", ask: "a-step-4", what: "Run the step again?", picks: ["again", "no"] },
          );
          yield* send(5, "answer", { type: "answered", ask: "a-step-4", pick: "no", note: "" }, "user:owner");
          const before = yield* rows(5);
          yield* preparePending(5);
          const after = yield* rows(5);
          expect(after.slice(0, before.length)).toEqual(before);
          expect(sealedOf(yield* asked(5))).toMatchObject([{ replaces: "a-approve-3" }]);
          yield* preparePending(5);
          expect(yield* rows(5)).toEqual(after);
        }),
      );
    },
  );
  property(
    "seals a step ask with the comments as other evidence, at the last ended step",
    { first: Schema.String.check(unicode), second: Schema.String.check(unicode) },
    async ({ first, second }) => {
      await run(
        Effect.gen(function* () {
          yield* ticket(
            5,
            { type: "commented", body: `First note. ${first}` },
            { type: "commented", body: `Second note. ${second}` },
            { type: "started", run: "r-build-1", stage: "build", task: null, log: null },
            {
              type: "ended",
              run: "r-build-1",
              stage: "build",
              outcome: { kind: "done", part: false },
              usd: 0,
              input: 0,
              output: 0,
              turns: 1,
            },
            { type: "asked", ask: "a-step-4", what: "Run the build again?", picks: ["again", "no"] },
          );
          yield* preparePending(5);
          const [sealed, ...more] = sealedOf(yield* asked(5));
          expect(more).toEqual([]);
          expect(sealed).toMatchObject({
            replaces: "a-step-4",
            for: "step",
            step: "build",
            repo: "unknown",
            shows: {
              evidence: { _tag: "other", text: `First note. ${first}\n\nSecond note. ${second}` },
            },
          });
        }),
      );
    },
  );
});

describe("ask desk review 2, high 2: a save the store could not take says so in plain words", () => {
  property(
    "an unreachable ledger is said as nothing saved, never as the store's own text",
    { took: Via.cases.window.fields.took },
    async ({ took }) => {
      await run(
        Effect.gen(function* () {
          const ask = yield* sealAsk(DRAFT, policyFor(DRAFT.ask, false, blindDraw));
          yield* ticket(117, { type: "planned", version: 2, tasks: [] }, ask);
          const ledger = yield* Ledger;
          const locked: typeof ledger = {
            ...ledger,
            append: () => Effect.fail(new LedgerUnreachable({ method: "append", message: "database is locked" })),
            send: () => Effect.fail(new LedgerUnreachable({ method: "send", message: "database is locked" })),
          };
          const write = Schema.decodeUnknownSync(Write)({
            kind: "answer",
            ticket: 117,
            ask: ask.ask,
            answer: { _tag: "rec" },
            saw: ask.saw,
            via: { _tag: "window", took },
          });
          const error = yield* saveCell(save({ id: "click", next: 118, write })).pipe(
            Effect.provideService(Ledger, locked),
            Effect.flip,
          );
          expect(error.why).not.toContain("database is locked");
          expect(error.why).toMatch(/ledger/i);
          expect(error.why).toContain("Nothing was saved");
          expect(error.why).toContain("Try again");
        }),
      );
    },
  );
});

/** A question past an ask's 120 characters, within an old ask's 256, as a lane's old asks wrote them. */
const LONG = `The build used all 3 rounds and the checks are still red. The last review said: ${"the parser drops a trailing comma in nested lists, ".repeat(2)}Run again?`;

describe("ask desk review 2, high 1: an old ask's long question is sealed as one line", () => {
  property(
    "keeps an approve ask's whole question beside its stored plan",
    { suffix: Schema.String.check(Schema.isPattern(/^[a-z]{0,10}$/)) },
    async ({ suffix }) => {
      const question = LONG + suffix;
      await run(
        Effect.gen(function* () {
          yield* stored;
          yield* ticket(5, { type: "planned", version: 1, tasks: [] }, { ...LEGACY, what: question });
          yield* preparePending(5);
          const [sealed] = sealedOf(yield* asked(5));
          expect(sealed?.shows.what).toBe(questionLine(question));
          expect(sealed?.shows.evidence).toMatchObject({ _tag: "plan", version: 1, text: question });
        }),
      );
    },
  );
  describe.each([
    ["rounds_spent", "a-rounds_spent-4"],
    ["exam_conflict", "a-exam_conflict-4"],
    ["step", "a-step-4"],
  ])("%s", (kind, id) => {
    property(
      "seals a question past one line, keeping all of it beside",
      { suffix: Schema.String.check(Schema.isPattern(/^[a-z]{0,10}$/)) },
      async ({ suffix }) => {
        const question = LONG + suffix;
        await run(
          Effect.gen(function* () {
            yield* ticket(
              5,
              { type: "commented", body: "First note." },
              { type: "started", run: "r-build-1", stage: "build", task: null, log: null },
              {
                type: "ended",
                run: "r-build-1",
                stage: "build",
                outcome: { kind: "done", part: false },
                usd: 0,
                input: 0,
                output: 0,
                turns: 1,
              },
              { type: "asked", ask: id, what: question, picks: ["again", "no"] },
            );
            yield* preparePending(5);
            const [sealed, ...more] = sealedOf(yield* asked(5));
            expect(more).toEqual([]);
            expect(sealed).toMatchObject({ replaces: id, for: kind });
            expect(sealed?.shows.what).toBe(questionLine(question));
            const evidence = sealed?.shows.evidence;
            expect(evidence?._tag).toBe("other");
            expect(evidence?._tag === "other" ? evidence.text : "").toContain(question);
            expect(evidence?._tag === "other" ? evidence.text : "").toContain("First note.");
          }),
        );
      },
    );
  });
});
