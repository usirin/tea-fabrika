// Ticket 884, next/: the app supplies real runner wiring so this program imports only the library's front (0062).
import { describe, expect, it } from "@effect/vitest";
import type { ProgramRunner } from "@kampus/libfabrika";
import { Arbitrary, Effect, Schema, type Scope } from "effect";
import { inbox, Row } from "./program.ts";

type Runner = ProgramRunner["Service"];
type Writer = unknown;

export type Open = Effect.Effect<
  {
    readonly start: (
      program: typeof inbox,
      initial: typeof inbox.msg.Type,
    ) => Effect.Effect<Runner, never, Scope.Scope>;
    readonly person: Writer;
    readonly agent: Writer;
    readonly recovered: Writer;
    readonly letters: Effect.Effect<ReadonlyArray<unknown>>;
  },
  never,
  Scope.Scope
>;

const TRACE = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };

export const suite = (open: Open) =>
  describe("ticket 884 the inbox program at the runner", () => {
    it.live.prop(
      "I2: a person, an agent and a recovered device cannot send added or change the brain's rows",
      [Schema.Literals(["person", "agent", "recovered"]), Arbitrary.schema(inbox.msg)],
      ([sender, initial]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const session = yield* open;
            const runner = yield* session.start(inbox, initial);
            const { type: _type, ...fields } = initial;
            const before = (yield* runner.open("before")).view;
            const letters = yield* session.letters;

            for (const id of ["inbox-client-attempt", JSON.stringify(["notice", "inbox-client-attempt"])]) {
              const answer = yield* runner.msg({
                id,
                envelope: {
                  id: "input_0000000000e008000000000001",
                  by: session[sender],
                  arrivedAt: 1,
                  input: { ...initial, id: `attempt:${initial.id}` },
                },
                sentAt: "2026-11-12T00:00:00Z",
                seen: 0,
                span: TRACE,
              });
              expect(answer).toEqual({ _tag: "refused", reason: "bad_msg" });
            }

            expect((yield* runner.open("after")).view).toEqual(before);
            expect(yield* session.letters, "a refused input saves no letter").toEqual(letters);
            // The ledger saves JSON, where both arrivedAt and fact.rev lose negative zero's sign.
            const savedRow = Schema.decodeUnknownSync(Schema.fromJsonString(Row))(
              JSON.stringify(Row.cases.added.make(fields)),
            );
            expect(before, "the brain's saved letter reaches the real program").toEqual({
              rows: [savedRow],
            });
          }),
        ),
      { arbitrary: { seed: 119120 } },
    );
  });
