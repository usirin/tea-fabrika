import { Ledger, streams } from "@kampus/fabrika-old";
import { memoryService } from "@kampus/fabrika-old/memory";
import { blindDraw, sealAsk, Rec, Answer } from "@kampus/pipeline/tickets/ask";
import { type Entry, fold, nameOf, readRow } from "@kampus/pipeline/tickets/ticket";
import { Effect, Exit, Schema } from "effect";
import { describe, expect } from "vitest";
import { DRAFT, FILED, OWNER, TOOK, policyFor, type Sealed } from "../../../fixtures/ask-desk/cases.ts";
import { property, ticketNumber, unicode } from "../../../fixtures/ask-desk/property.ts";
import { openAsksOf } from "./head.ts";
import { Author, prepareAsk, preparePending, saveCell } from "./ledger.ts";
import { openedOf, save } from "./machine.ts";
import { Write } from "./ticket.ts";

// Today's version. Round 4 of the ask desk's tests, from the review's fix list (askdesk-review.md):
// 2, a parked ask is sealed before its old ask is withdrawn, and a "changed" withdrawal with no
// replacement leaves the old ask waiting; 5, a losing answer is told who won; 7, a window never
// receives the sealed rec; 8, a parked ask is sealed by code, never in the old ask's author's name.

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

const entries = (n: number) =>
  Effect.map(rows(n), (all) =>
    all.flatMap((row): Entry[] => {
      const read = readRow(row);
      return read.kind === "entry" ? [read.entry] : [];
    }),
  );

const timeline = (n: number) =>
  Effect.map(entries(n), (all) => fold([], all).tickets.find((t) => t.number === n)?.timeline ?? []);

const run = <A, E>(effect: Effect.Effect<A, E, Ledger | Author>) =>
  Effect.runPromise(effect.pipe(Effect.provideService(Author, OWNER), Effect.provideService(Ledger, memoryService())));

const prepare: (n: number, ask: string, draft: unknown) => Effect.Effect<Sealed, unknown, Ledger | Author> = prepareAsk;
const seal: (draft: unknown, policy?: { seed: number }) => Effect.Effect<Sealed, unknown> = sealAsk;

const LEGACY = {
  type: "asked",
  ask: "a-approve-3",
  what: "Do you approve plan version 1?",
  picks: ["approve", "no"],
};

const STEP = { type: "asked", ask: "a-step-4", what: "Run the build again?", picks: ["again", "no"] };
const restored = { ...DRAFT, rec: { _tag: "none", why: "No recommendation was recorded" } };

/** The ledger as it is, except that every write after the first one kills the process. */
const crashesAfterOneWrite = (ledger: Ledger["Service"]): Ledger["Service"] => {
  let writes = 0;
  const once = <A, E, R>(write: () => Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      writes++;
      return writes === 1 ? write() : Effect.die(new Error("the host stopped here"));
    });
  return {
    ...ledger,
    send: (...args) => once(() => ledger.send(...args)),
    append: (...args) => once(() => ledger.append(...args)),
  };
};

describe("ask desk review 2: the sealed ask lands before the old one is withdrawn", () => {
  property(
    "a crash after one write leaves the replacement shown, never a withdrawn ask with nothing in its place",
    { n: ticketNumber },
    async ({ n }) => {
      await run(
        Effect.gen(function* () {
          yield* ticket(n, LEGACY);
          const before = (yield* rows(n)).length;
          const ledger = yield* Ledger;
          const crashed = yield* Effect.exit(
            prepare(n, "a-approve-3", restored).pipe(Effect.provideService(Ledger, crashesAfterOneWrite(ledger))),
          );
          expect(Exit.isFailure(crashed)).toBe(true);
          const written = (yield* rows(n)).slice(before);
          expect(written.map((r) => r.kind)).toEqual(["asked"]);
          expect(JSON.parse(written[0]?.data ?? "null")).toMatchObject({
            format: 1,
            replaces: "a-approve-3",
          });
          // The next start finishes the job: one replacement, then one withdrawal of the old ask.
          const sealed = yield* prepare(n, "a-approve-3", restored);
          const after = (yield* rows(n)).slice(before);
          expect(after.map((r) => r.kind)).toEqual(["asked", "withdrawn"]);
          expect(sealed.replaces).toBe("a-approve-3");
        }),
      );
    },
  );
  property(
    "a changed withdrawal with no replacement leaves the old ask waiting",
    { n: ticketNumber },
    async ({ n }) => {
      await run(
        Effect.gen(function* () {
          yield* ticket(n, LEGACY, { type: "withdrawn", ask: "a-approve-3", why: "changed" });
          expect(openAsksOf(yield* timeline(n)).map((a) => a.ask)).toEqual(["a-approve-3"]);
        }),
      );
    },
  );
  property("once its replacement lands, only the replacement waits", { n: ticketNumber }, async ({ n }) => {
    await run(
      Effect.gen(function* () {
        yield* ticket(n, LEGACY);
        const sealed = yield* prepare(n, "a-approve-3", restored);
        expect(openAsksOf(yield* timeline(n)).map((a) => a.ask)).toEqual([sealed.ask]);
      }),
    );
  });
  property(
    "preparePending seals an old ask whose changed withdrawal has no replacement",
    { n: ticketNumber },
    async ({ n }) => {
      await run(
        Effect.gen(function* () {
          yield* ticket(n, STEP, { type: "withdrawn", ask: "a-step-4", why: "changed" });
          yield* preparePending(n);
          const sealed = (yield* rows(n))
            .filter((r) => r.kind === "asked")
            .map((r) => JSON.parse(r.data ?? "null"))
            .filter((a) => "format" in a);
          expect(sealed).toHaveLength(1);
          expect(sealed[0]).toMatchObject({ replaces: "a-step-4" });
        }),
      );
    },
  );
  property("an old ask withdrawn for another reason stays closed", { n: ticketNumber }, async ({ n }) => {
    await run(
      Effect.gen(function* () {
        yield* ticket(n, STEP, { type: "withdrawn", ask: "a-step-4", why: "expired" });
        const before = yield* rows(n);
        yield* preparePending(n);
        expect(yield* rows(n)).toEqual(before);
        expect(openAsksOf(yield* timeline(n))).toEqual([]);
      }),
    );
  });
});

describe("ask desk review 8: a parked ask is sealed by code, in code's own name", () => {
  property(
    "the replacement and the withdrawal are written by a code writer for the person, not the old ask's author",
    { n: ticketNumber },
    async ({ n }) => {
      await run(
        Effect.gen(function* () {
          yield* ticket(n, STEP);
          yield* preparePending(n);
          const wrote = (yield* rows(n)).filter((r) => r.kind === "withdrawn" || r.kind === "asked");
          const fresh = wrote.filter((r) => r.kind === "withdrawn" || r.id !== "fact/0");
          expect(fresh.map((r) => r.kind).sort()).toEqual(["asked", "withdrawn"]);

          for (const row of fresh) {
            expect(row.writer).toMatch(/^agent:\S+ for:owner$/);
            expect(row.writer).not.toBe(LANE);
          }
        }),
      );
    },
  );
});

const answer = (ask: Sealed, id: string, changes: Record<string, unknown> = {}) =>
  saveCell(
    save({
      id,
      next: 118,
      write: Schema.decodeUnknownSync(Write)({
        kind: "answer",
        ticket: 117,
        ask: ask.ask,
        answer: { _tag: "rec" },
        saw: ask.saw,
        via: { _tag: "window", took: TOOK },
        ...changes,
      }),
    }),
  );

const OTHER = DRAFT.picks.find((p) => p.pick !== DRAFT.rec.pick)?.pick ?? "no";
const AGAINST = { answer: { _tag: "against", pick: OTHER, note: "The plan misses the empty input" } };

const shownAsk = Effect.gen(function* () {
  const ask = yield* seal(DRAFT, policyFor(DRAFT.ask, false, blindDraw));
  yield* ticket(117, { type: "planned", version: 2, tasks: [] }, ask);
  return ask;
});

const answers = Effect.map(rows(117), (all) => all.filter((r) => r.kind === "answered"));

describe("ask desk review 5: the losing answer is told what was recorded", () => {
  property(
    "a different answer after the first is refused with the recorded pick",
    { note: Answer.cases.against.fields.note },
    async ({ note }) => {
      await run(
        Effect.gen(function* () {
          const ask = yield* shownAsk;
          yield* answer(ask, "first-window");
          const lost = yield* Effect.flip(answer(ask, "second-window", { answer: { ...AGAINST.answer, note } }));
          expect(lost).toEqual({ _tag: "refused", why: `Already answered: ${DRAFT.rec.pick}` });
          expect(yield* answers).toHaveLength(1);
        }),
      );
    },
  );
  property(
    "names the pick a note-against answer recorded",
    { note: Answer.cases.against.fields.note },
    async ({ note }) => {
      await run(
        Effect.gen(function* () {
          const ask = yield* shownAsk;
          yield* answer(ask, "first-window", { answer: { ...AGAINST.answer, note } });
          const lost = yield* Effect.flip(answer(ask, "second-window"));
          expect(lost).toEqual({ _tag: "refused", why: `Already answered: ${OTHER}` });
        }),
      );
    },
  );
  property(
    "the same answer twice is one answer, and both saves succeed",
    { key: Schema.NonEmptyString },
    async ({ key }) => {
      await run(
        Effect.gen(function* () {
          const ask = yield* shownAsk;
          yield* answer(ask, `click/${key}`);
          yield* answer(ask, `retry/${key}`);
          expect(yield* answers).toHaveLength(1);
        }),
      );
    },
  );
  property(
    "two windows answering at once: one wins, and the other hears what won",
    { note: Answer.cases.against.fields.note },
    async ({ note }) => {
      await run(
        Effect.gen(function* () {
          const ask = yield* shownAsk;
          const [a, b] = yield* Effect.all(
            [
              Effect.exit(answer(ask, "window-a")),
              Effect.exit(answer(ask, "window-b", { answer: { ...AGAINST.answer, note } })),
            ],
            { concurrency: "unbounded" },
          );
          const won = [a, b].filter(Exit.isSuccess);
          expect(won).toHaveLength(1);
          expect(yield* answers).toHaveLength(1);
          const recorded = JSON.parse((yield* answers)[0]?.data ?? "null");
          const pick = recorded.answer._tag === "rec" ? DRAFT.rec.pick : recorded.answer.pick;
          const lost = Exit.isFailure(a) ? a : b;
          expect(JSON.stringify(lost)).toContain(`Already answered: ${pick}`);
        }),
      );
    },
  );
});

/** Every key path in a value, as `a.b.c`. */
const pathsIn = (value: unknown, at = ""): readonly string[] =>
  typeof value !== "object" || value === null
    ? []
    : Object.entries(value).flatMap(([key, v]) => {
        const here = Array.isArray(value) ? at : at === "" ? key : `${at}.${key}`;
        return [...(Array.isArray(value) ? [] : [here]), ...pathsIn(v, here)];
      });

describe("ask desk review 7: a window never receives the sealed rec", () => {
  property(
    "an opened ticket holds each ask's shows and saw, and no rec or blind draw outside shows",
    {
      why: Rec.cases.pick.fields.why.check(unicode, Schema.isMaxLength(80)),
      cost: Rec.cases.pick.fields.cost.check(unicode, Schema.isMaxLength(80)),
    },
    async ({ why, cost }) => {
      for (const rec of [DRAFT.rec, { ...DRAFT.rec, why: `Sealed reason ${why}`, cost: `Sealed cost ${cost}` }]) {
        await run(
          Effect.gen(function* () {
            // A step's ask: an approve ask is never drawn blind (review 2, medium 2).
            const hidden = yield* seal({ ...DRAFT, for: "step", rec }, policyFor(DRAFT.ask, true, blindDraw));
            expect(hidden.shows.rec).toEqual({ _tag: "hidden" });
            yield* ticket(117, { type: "planned", version: 2, tasks: [] }, hidden);
            const [opened] = fold([], yield* entries(117)).tickets;

            if (opened === undefined) {
              return yield* Effect.die("no ticket");
            }

            const page = openedOf(opened, 0, [opened]);
            const text = JSON.stringify(page);
            expect(text).not.toContain(JSON.stringify(rec.why).slice(1, -1));
            expect(text).not.toContain(JSON.stringify(rec.cost).slice(1, -1));
            expect(text).not.toContain(DRAFT.rec.why);
            expect(text).not.toContain(DRAFT.rec.cost);
            const keys = pathsIn(page);
            expect(keys.filter((k) => /(^|\.)rec$/.test(k) && !/(^|\.)shows\.rec$/.test(k))).toEqual([]);
            expect(keys.filter((k) => /(^|\.)blind$/.test(k))).toEqual([]);
            expect(text).toContain(hidden.saw);
            expect(text).toContain(DRAFT.what);
          }),
        );
      }
    },
  );
});
