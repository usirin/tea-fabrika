import { Ledger, streams } from "@kampus/fabrika-old";
import { memoryService } from "@kampus/fabrika-old/memory";
import { answerHeard } from "@kampus/pipeline/stages/pipeline/hosts";
import { fold as restart } from "@kampus/pipeline/stages/pipeline/restart";
import { HeldDraft } from "@kampus/pipeline/stages/plan/plan";
import { covers, hashOf } from "@kampus/pipeline/tickets/approval";
import { Entry, Fact, kindOf, nameOf } from "@kampus/pipeline/tickets/ticket";
import { Tickets, ticketsOnLedger } from "@kampus/pipeline/tickets/tickets";
import { Effect, Option, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  AGENT,
  FILED,
  DRAFT,
  NONE,
  HEAD,
  LEGACY_ANSWER,
  LEGACY_FACTS,
  NOW,
  OWNER,
  PLAN,
  TOOK,
  type Sealed,
} from "../../../fixtures/ask-desk/cases.ts";
import { property } from "../../../fixtures/ask-desk/property.ts";
import { headOf } from "./head.ts";
import { Author, loadCell, prepareAsk, saveCell } from "./ledger.ts";
import { load, save } from "./machine.ts";
import { rowsOf } from "./rows.ts";
import { Write } from "./ticket.ts";

const prepare: (ticket: number, ask: string, draft: unknown) => Effect.Effect<Sealed, unknown, Ledger | Author> =
  prepareAsk;

// The legacy facts do not contain the full plan. Supply the saved plan/display input,
// as the real caller must before sealing it. Never manufacture an old recommendation.
const restored = { ...DRAFT, rec: NONE };
const INBOX = streams(nameOf(117)).inbox;

const seed = Effect.gen(function* () {
  const ledger = yield* Ledger;
  yield* ledger.register(nameOf(117), "user:owner");

  for (const [i, fact] of LEGACY_FACTS.entries()) {
    yield* ledger.send(INBOX, `legacy/${i}`, {
      kind: kindOf(Schema.decodeUnknownSync(Fact)(fact).type),
      writer: fact.type === "filed" || fact.type === "answered" ? "user:owner" : "agent:lane for:owner",
      data: fact,
    });
  }
});

const on = <A, E>(program: Effect.Effect<A, E, Ledger | Author | Tickets>) =>
  Effect.runPromise(
    program.pipe(
      Effect.provideService(Author, OWNER),
      Effect.provide(ticketsOnLedger(AGENT)),
      Effect.provideService(Ledger, memoryService()),
    ),
  );

describe("ask desk P21: ticket 117 parked on plan v2", () => {
  // pinned: the parked-plan-v2 bug on ticket 117, with its saved old facts from experiment 196.
  it("pinned: replaces the old ask once, follows it from the old wait, and resumes after the completed plan", async () => {
    expect(prepareAsk, "missing planned prepareAsk operation").toBeTypeOf("function");
    await on(
      Effect.gen(function* () {
        yield* seed;
        const ledger = yield* Ledger;
        const before = yield* ledger.readStream(INBOX);
        const replacement = yield* prepare(117, "a-approve-8", restored);
        expect(replacement).toMatchObject({
          format: 1,
          replaces: "a-approve-8",
          rec: { _tag: "none" },
        });
        expect(replacement.ask).not.toBe("a-approve-8");
        expect(yield* prepare(117, "a-approve-8", restored)).toEqual(replacement);
        const sealedRows = yield* ledger.readStream(INBOX);
        expect(sealedRows.slice(0, before.length)).toEqual(before);
        expect(sealedRows.filter((r) => r.kind === "withdrawn")).toHaveLength(1);
        const input = Schema.decodeUnknownSync(Write)({
          kind: "answer",
          ticket: 117,
          ask: replacement.ask,
          answer: { _tag: "chose", pick: "approve" },
          saw: replacement.saw,
          via: { _tag: "window", took: { ...TOOK, rec: "none" } },
        });
        yield* saveCell(save({ id: "replacement-click", next: 118, write: input }));
        yield* saveCell(save({ id: "replacement-retry", next: 118, write: input }));
        const heard = yield* answerHeard(117, "a-approve-8", ["approve", "no"]).pipe(
          Stream.runHead,
          Effect.timeoutOption("1500 millis"),
          Effect.map(Option.flatten),
          Effect.map(Option.getOrNull),
        );
        expect(heard).toMatchObject({ ask: "a-approve-8", pick: "approve" });
        const ticket = yield* (yield* Tickets).read(117);
        const folded = restart({
          timeline: ticket.timeline,
          plan: Schema.decodeUnknownSync(HeldDraft)(PLAN),
          base: HEAD,
          commits: [],
        });
        expect(folded.held.carry).toMatchObject({ version: 2, decided: { questions: PLAN.questions } });
        expect(folded.at).toEqual({ _tag: "run", step: "exam" });
        expect(ticket.timeline.filter((e) => e.fact.type === "started" && e.fact.stage === "plan")).toHaveLength(2);
        expect((yield* ledger.readStream(INBOX)).filter((r) => r.kind === "answered")).toHaveLength(2);
      }),
    );
  });
  // format: the pre-format-1 answered row is read exactly, with no timing fields invented.
  it("format: reads old facts unchanged, with unknown timing, and never reuses their text hash as plan approval", async () => {
    await on(
      Effect.gen(function* () {
        yield* seed;
        const matching = { ...LEGACY_ANSWER, text: yield* hashOf(FILED) };
        const old = Schema.decodeUnknownSync(Fact)(matching);
        expect(old).toStrictEqual(matching);
        expect(old).not.toHaveProperty("via");
        const ticket = yield* (yield* Tickets).read(117);

        if (old.type !== "answered") {
          return yield* Effect.die("the old answer is missing");
        }

        expect(yield* covers(old, ticket)).toBe(false);
      }),
    );
  });
});

describe("ask desk P22: every reader understands current answers", () => {
  property(
    "the load, head, activity, approval, listener and restart agree on a new rec answer",
    { key: Schema.NonEmptyString },
    async ({ key }) => {
      expect(prepareAsk, "missing planned prepareAsk operation").toBeTypeOf("function");
      await on(
        Effect.gen(function* () {
          yield* seed;
          const ask = yield* prepare(117, "a-approve-8", restored);
          const write = Schema.decodeUnknownSync(Write)({
            kind: "answer",
            ticket: 117,
            ask: ask.ask,
            answer: { _tag: "chose", pick: "approve" },
            saw: ask.saw,
            via: { _tag: "window", took: { ...TOOK, rec: "none", key } },
            needed: false,
          });
          yield* saveCell(save({ id: "readers", next: 118, write }));
          const loaded = yield* loadCell(load({ after: 0 }));
          expect(loaded.broken).toEqual([]);
          const ticket = yield* (yield* Tickets).read(117);
          expect(headOf(ticket.timeline, NOW)._tag).not.toBe("asks");
          const activity = rowsOf(ticket.timeline).filter((r) => r.type === "answered");
          expect(JSON.stringify(activity.at(-1))).toContain("approve");
          expect(JSON.stringify(activity.at(-1))).not.toContain("undefined");
          const last = ticket.timeline.at(-1)?.fact;

          if (last?.type !== "answered") {
            return yield* Effect.die("the answer is missing");
          }

          expect(yield* covers(last, ticket)).toBe(true);
          const newer = {
            ...ticket,
            timeline: [
              ...ticket.timeline,
              Schema.decodeUnknownSync(Entry)({
                pos: ticket.timeline.length + 1,
                ticket: 117,
                by: AGENT,
                at: NOW,
                fact: { type: "planned", version: 3, tasks: [] },
              }),
            ],
          };
          expect(yield* covers(last, newer)).toBe(false);
        }),
      );
    },
  );
});
