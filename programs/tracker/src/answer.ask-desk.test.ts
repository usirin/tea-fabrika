import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, type Row, streams } from "@kampus/fabrika-old";
import { memoryService } from "@kampus/fabrika-old/memory";
import { layerSqliteSync } from "@kampus/fabrika-old/sqlite";
import { blindDraw, sealAsk, Answer, Asked, Via } from "@kampus/pipeline/tickets/ask";
import { nameOf, readRow, readAnswer, fold } from "@kampus/pipeline/tickets/ticket";
import { Clock, Effect, Layer, Schema } from "effect";
import { afterEach, describe, expect } from "vitest";
import {
  AGENT,
  DRAFT,
  FILED,
  HEAD,
  NOW,
  NONE,
  OTHER_HEAD,
  OWNER,
  TOOK,
  policyFor,
  type Sealed,
} from "../../../fixtures/ask-desk/cases.ts";
import { property } from "../../../fixtures/ask-desk/property.ts";
import { Author, saveCell } from "./ledger.ts";
import { save } from "./machine.ts";
import { Write } from "./ticket.ts";

const seal: (draft: unknown, policy?: { seed: number }) => Effect.Effect<Sealed, unknown> = sealAsk;
const INBOX = streams(nameOf(117)).inbox;

const send = (
  id: string,
  fact: { readonly type: string; readonly [key: string]: unknown },
  writer = "agent:lane for:owner",
) =>
  Effect.gen(function* () {
    return yield* (yield* Ledger).send(INBOX, id, { kind: fact.type, writer, data: fact });
  });

const seed = (draft: unknown = DRAFT, hidden = false, id = DRAFT.ask) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    yield* ledger.register(nameOf(117), "user:owner");
    yield* send("filed", FILED, "user:owner");
    yield* send("plan/2", { type: "planned", version: 2, tasks: [] });
    const ask = yield* seal(Object.assign({}, draft, { ask: id }), policyFor(id, hidden, blindDraw));
    yield* send(ask.ask, ask);
    return ask;
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

const rows = Effect.gen(function* () {
  return yield* (yield* Ledger).readStream(INBOX);
});

const answers = (all: readonly Row[]) => all.filter((row) => row.kind === "answered");
const scratch: string[] = [];

// Today's editor uses Date.now: its focused time and writer clock are whole milliseconds.
const timing = Schema.Struct({
  ...Via.cases.window.fields.took.fields,
  ms: Via.cases.window.fields.took.fields.ms.check(Schema.isInt()),
  said: Via.cases.window.fields.took.fields.said.check(Schema.isInt()),
});

afterEach(() => {
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

const run = <A, E>(effect: Effect.Effect<A, E, Ledger | Author>, disk = false) => {
  const dir = disk ? mkdtempSync(join(tmpdir(), "ad-")) : null;

  if (dir !== null) {
    scratch.push(dir);
  }

  const layer =
    dir === null ? Layer.succeed(Ledger, memoryService()) : layerSqliteSync({ path: join(dir, "ledger.db") });
  return Effect.runPromise(effect.pipe(Effect.provideService(Author, OWNER), Effect.provide(layer), Effect.scoped));
};

describe.each([false, true])("ask desk P7/P22: chose notes in the ledger, SQLite=%s", (disk) => {
  describe.each([false, true])("hidden=%s", (hidden) => {
    property(
      "saves and replays exactly the optional note the person supplied",
      { value: Answer.cases.chose },
      async ({ value }) => {
        for (const note of [undefined, "Keep the empty input test.", value.note]) {
          await run(
            Effect.gen(function* () {
              // A blind ask is a step's: an approve ask is never drawn blind (review 2, medium 2).
              const ask = yield* seed(
                hidden ? { ...DRAFT, for: "step", rec: DRAFT.rec } : { ...DRAFT, rec: NONE },
                hidden,
              );
              const chose = { _tag: "chose", pick: "no", ...(note === undefined ? {} : { note }) };
              yield* answer(ask, "person", {
                answer: chose,
                via: { _tag: "window", took: { ...TOOK, rec: hidden ? "hidden" : "none" } },
              });
              const all = yield* rows;
              const recorded = answers(all);
              expect(recorded).toHaveLength(1);
              const fact: { answer: Record<string, unknown> } = JSON.parse(recorded[0]!.data);
              expect(fact.answer).toStrictEqual(chose);
              expect(Object.hasOwn(fact.answer, "note")).toBe(note !== undefined);
              const entries = all.flatMap((row) => {
                const read = readRow(row);
                return read.kind === "entry" ? [read.entry] : [];
              });
              const replayed = fold([], entries);
              expect(replayed.problems).toEqual([]);
              const timeline = replayed.tickets[0]!.timeline;
              const saved = timeline.find((entry) => entry.fact.type === "answered");

              if (saved?.fact.type !== "answered") {
                return yield* Effect.die(new Error("the replay lost the answer"));
              }

              expect(saved.fact).toHaveProperty("answer", chose);
              expect(readAnswer(timeline, saved.fact)).toMatchObject({
                ask: ask.ask,
                pick: "no",
                note: note ?? "",
              });
            }),
            disk,
          );
        }
      },
    );
  });
});

describe("ask desk P4: fresh answers, not title-and-body approvals", () => {
  describe.each(["hash", "withdrawn", "plan", "pick", "expired"])("replay, %s", (fault) => {
    property("rejects an invalid answer at every ask identity", { id: Asked.fields.ask }, async ({ id }) => {
      await run(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const ask = yield* seed(fault === "expired" ? { ...DRAFT, until: now - 1 } : DRAFT, false, id);

          if (fault === "withdrawn") {
            yield* send("withdraw/replay", { type: "withdrawn", ask: ask.ask, why: "changed" });
          }

          if (fault === "plan") {
            yield* send("plan/replay", { type: "planned", version: 3, tasks: [] });
          }

          yield* send(
            "raw-answer",
            {
              type: "answered",
              format: 1,
              ask: ask.ask,
              answer: fault === "pick" ? { _tag: "against", pick: "merge", note: "Wrong pick" } : { _tag: "rec" },
              saw: fault === "hash" ? `sha256:${"0".repeat(64)}` : ask.saw,
              via: { _tag: "window", took: TOOK },
            },
            "user:owner",
          );
          const entries = (yield* rows).flatMap((row) => {
            const read = readRow(row);
            return read.kind === "entry" ? [read.entry] : [];
          });
          const folded = fold([], entries);
          expect(folded.problems).not.toEqual([]);
          expect(folded.tickets[0]?.timeline.filter((e) => e.fact.type === "answered")).toEqual([]);
        }),
      );
    });
  });
  describe.each([
    ["wrong display hash", "hash"],
    ["withdrawn ask", "withdrawn"],
    ["changed plan with unchanged ticket text", "plan"],
    ["expired ask", "expired"],
    ["unknown ask", "unknown"],
    ["unoffered pick", "pick"],
  ])("%s", (_label, fault) => {
    property(
      "refuses the save and records no answer at every ask identity",
      { id: Asked.fields.ask },
      async ({ id }) => {
        await run(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const ask = yield* seed(fault === "expired" ? { ...DRAFT, until: now - 1 } : DRAFT, false, id);

            if (fault === "withdrawn") {
              yield* send("withdraw/1", { type: "withdrawn", ask: ask.ask, why: "changed" });
            }

            if (fault === "plan") {
              yield* send("plan/3", { type: "planned", version: 3, tasks: [] });
            }

            const changes =
              fault === "hash"
                ? { saw: `sha256:${"0".repeat(64)}` }
                : fault === "unknown"
                  ? { ask: "missing-ask" }
                  : fault === "pick"
                    ? { answer: { _tag: "against", pick: "merge", note: "Wrong pick" } }
                    : {};
            const result = yield* Effect.exit(answer(ask, "click", changes));
            expect(result).toMatchObject({ _tag: "Failure" });
            expect(answers(yield* rows)).toEqual([]);
          }),
        );
      },
    );
  });
  property(
    "refuses a new head even when the ticket text and offered picks have not changed",
    { id: Asked.fields.ask },
    async ({ id }) => {
      await run(
        Effect.gen(function* () {
          const evidence = {
            _tag: "change",
            head: HEAD,
            diff: "diff --git a/file b/file\n+one",
            checks: [],
            review: { head: HEAD, met: 1, of: 1, findings: [] },
            rules: [{ path: "AGENTS.md", text: "Keep the tests" }],
          };
          const ask = yield* seed({ ...DRAFT, for: "merge", step: "merge", evidence }, false, id);
          yield* send("push/new", {
            type: "pushed",
            head: OTHER_HEAD,
            commits: [{ sha: OTHER_HEAD, title: "Changed after display" }],
          });
          expect(yield* Effect.exit(answer(ask, "key"))).toMatchObject({ _tag: "Failure" });
          expect(answers(yield* rows)).toEqual([]);
        }),
      );
    },
  );
  property(
    "rechecks after a stale append, including a withdrawal that wins that race",
    { id: Asked.fields.ask },
    async ({ id }) => {
      await run(
        Effect.gen(function* () {
          const ask = yield* seed(DRAFT, false, id);
          const ledger = yield* Ledger;
          let raced = false;
          // Only the outside race is injected. The real ledger creates the Stale failure.
          const competing: typeof ledger = {
            ...ledger,
            append: (...args) =>
              Effect.gen(function* () {
                if (args[0] === INBOX && !raced) {
                  raced = true;
                  yield* ledger.send(INBOX, "withdraw/race", {
                    kind: "withdrawn",
                    writer: "agent:lane for:owner",
                    data: { type: "withdrawn", ask: ask.ask, why: "changed" },
                  });
                }

                return yield* ledger.append(...args);
              }),
          };
          expect(yield* Effect.exit(answer(ask, "raced").pipe(Effect.provideService(Ledger, competing)))).toMatchObject(
            { _tag: "Failure" },
          );
          expect(raced).toBe(true);
          expect(answers(yield* rows)).toEqual([]);
        }),
      );
    },
  );
  property(
    "silence, even after expiry and a far-future writer clock, writes no answer",
    { id: Asked.fields.ask },
    async ({ id }) => {
      await run(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const ask = yield* seed({ ...DRAFT, until: now - 1 }, false, id);
          expect(
            yield* Effect.exit(
              answer(ask, "late", { via: { _tag: "window", took: { ...TOOK, said: NOW - 99_000_000 } } }),
            ),
          ).toMatchObject({ _tag: "Failure" });
          expect(answers(yield* rows)).toEqual([]);
        }),
      );
    },
  );
});

describe.each([false, true])("ask desk P5: concurrent answers, SQLite=%s", (disk) => {
  describe.each([false, true])("different=%s", (different) => {
    // Round 8 found a real failure here: this schema accepts NUL in an id, but SQLite's reader
    // cuts the row id there. Seed 119120 keeps that counterexample; do not filter it away.
    property("records one answer; only a different answer is refused", { id: Asked.fields.ask }, async ({ id }) => {
      await run(
        Effect.gen(function* () {
          const ask = yield* seed(DRAFT, false, id);
          const against = { answer: { _tag: "against", pick: "no", note: "Need a new plan" } };
          const results = yield* Effect.all(
            [answer(ask, "ticket-click"), answer(ask, "tracker-key", different ? against : {})].map((write) =>
              write.pipe(Effect.match({ onSuccess: (value) => ({ value }), onFailure: (error) => ({ error }) })),
            ),
            { concurrency: 2 },
          );
          const recorded = answers(yield* rows);
          expect(recorded).toHaveLength(1);
          expect(recorded[0]?.id).toBe(`answer/${ask.ask}`);
          const fact = JSON.parse(recorded[0]?.data ?? "null");
          const pick = fact.answer._tag === "rec" ? DRAFT.rec.pick : fact.answer.pick;
          expect(results.filter((result) => "value" in result)).toEqual(
            Array.from({ length: different ? 1 : 2 }, () => ({ value: { ticket: 117 } })),
          );
          expect(results.filter((result) => "error" in result)).toEqual(
            different ? [{ error: { _tag: "refused", why: `Already answered: ${pick}` } }] : [],
          );
          expect(yield* answer(ask, "retry", pick === "no" ? against : {})).toEqual({
            ticket: 117,
          });
          expect(answers(yield* rows)).toHaveLength(1);
        }),
        disk,
      );
    });
  });
});

describe("ask desk P6: a person alone answers", () => {
  describe.each([undefined, true, false])("needed=%s", (needed) => {
    property("refuses an agent through the shared save", { id: Asked.fields.ask }, async ({ id }) => {
      await run(
        Effect.gen(function* () {
          const ask = yield* seed(DRAFT, false, id);
          const tried = answer(ask, "agent", needed === undefined ? {} : { needed }).pipe(
            Effect.provideService(Author, AGENT),
          );
          expect(yield* Effect.exit(tried)).toMatchObject({ _tag: "Failure" });
          expect(answers(yield* rows)).toEqual([]);
        }),
      );
    });
  });
  property("also rejects a forged agent answer during replay", { id: Asked.fields.ask }, async ({ id }) => {
    await run(
      Effect.gen(function* () {
        const ask = yield* seed(DRAFT, false, id);
        yield* send("forged", {
          type: "answered",
          format: 1,
          ask: ask.ask,
          answer: { _tag: "rec" },
          saw: ask.saw,
          needed: false,
          via: { _tag: "window", took: TOOK },
        });
        const entries = (yield* rows).flatMap((row) => {
          const read = readRow(row);
          return read.kind === "entry" ? [read.entry] : [];
        });
        const folded = fold([], entries);
        expect(folded.problems).toHaveLength(1);
        expect(folded.tickets[0]?.timeline.some((e) => e.fact.type === "answered")).toBe(false);
      }),
    );
  });
});

describe("ask desk P17: the real save keeps needed", () => {
  describe.each([undefined, true, false])("needed=%s", (needed) => {
    property("stores the mark and timing exactly as chosen", { took: timing }, async ({ took: sample }) => {
      // Counts have one zero; the clock is sampled relative to the fixture's epoch.
      const took = { ...sample, ms: Math.abs(sample.ms), said: NOW + sample.said };
      await run(
        Effect.gen(function* () {
          const ask = yield* seed();
          yield* answer(ask, "person", {
            via: { _tag: "window", took },
            ...(needed === undefined ? {} : { needed }),
          });
          const recorded = answers(yield* rows)[0];
          expect(recorded).toBeDefined();
          const fact: Record<string, unknown> = JSON.parse(recorded?.data ?? "null");
          expect(fact.needed).toBe(needed);
          expect(Object.hasOwn(fact, "needed")).toBe(needed !== undefined);
          expect(fact.via).toEqual({ _tag: "window", took });
        }),
      );
    });
  });
});
