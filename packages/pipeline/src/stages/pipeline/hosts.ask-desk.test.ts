import { readFileSync } from "node:fs";
import { it } from "@effect/vitest";
import { Ledger, streams } from "@kampus/fabrika-old";
import { memoryService } from "@kampus/fabrika-old/memory";
import { Effect, Option, Stream, Schema, Deferred, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vitest";
import { Answer, sealAsk } from "../../tickets/ask.ts";
import { nameOf } from "../../tickets/ticket.ts";
import { ticketsOnLedger } from "../../tickets/tickets.ts";
import { answerHeard } from "./hosts.ts";

// Today's version. The lane's wait hears an approve only while it still covers what was shown
// (P4, P22). Any other pick comes back as it was written.
const { DRAFT, FILED, TOOK } = JSON.parse(
  readFileSync(new URL("../../../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"),
);

const INBOX = streams(nameOf(117)).inbox;
type Said = { readonly type: string; readonly [key: string]: unknown };

const send = (id: string, fact: Said, writer = "agent:lane for:owner") =>
  Effect.gen(function* () {
    yield* (yield* Ledger).send(INBOX, id, { kind: fact.type, writer, data: fact });
  });

/** Ticket 117 asked to approve plan 2, answered `answer` by a person, then planned again. */
const heard = (answer: unknown, version = 3, ready?: Deferred.Deferred<void>) =>
  Effect.gen(function* () {
    yield* (yield* Ledger).register(nameOf(117), "user:owner");
    yield* send("filed", FILED, "user:owner");
    yield* send("plan/2", { type: "planned", version: 2, tasks: [] });
    const ask = yield* sealAsk(DRAFT);
    yield* send(ask.ask, ask);
    yield* send(
      `answer/${ask.ask}`,
      {
        type: "answered",
        format: 1,
        ask: ask.ask,
        answer,
        saw: ask.saw,
        via: { _tag: "window", took: TOOK },
      },
      "user:owner",
    );
    yield* send("plan/3", { type: "planned", version, tasks: [] });

    if (ready !== undefined) {
      yield* Deferred.succeed(ready, undefined);
    }

    return yield* answerHeard(117, ask.ask, ["approve", "no"]).pipe(
      Stream.runHead,
      Effect.timeoutOption("1500 millis"),
      Effect.map(Option.flatten),
      Effect.map(Option.getOrNull),
    );
  }).pipe(
    Effect.provide(ticketsOnLedger({ kind: "agent", id: "lane", for: "owner" })),
    Effect.provideService(Ledger, memoryService()),
  );

describe("ask desk P4: the wait hears a stale approve as nothing", () => {
  it.effect.prop(
    "skips an approve answer whose plan changed after it",
    { version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(3), Schema.isLessThanOrEqualTo(1000)) },
    ({ version }) =>
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const pending = yield* Effect.forkChild(heard({ _tag: "rec" }, version, ready));
        yield* Deferred.await(ready);
        yield* TestClock.adjust("1500 millis");
        expect(yield* Fiber.join(pending)).toBeNull();
      }),
    { arbitrary: { seed: 119120 } },
  );
  it.effect.prop(
    "hears a no answer as no, with no cover check",
    { note: Answer.cases.against.fields.note },
    ({ note }) =>
      Effect.gen(function* () {
        expect(yield* heard({ _tag: "against", pick: "no", note })).toMatchObject({
          pick: "no",
          note,
          by: "owner",
        });
      }),
    { arbitrary: { seed: 119120 } },
  );
});
