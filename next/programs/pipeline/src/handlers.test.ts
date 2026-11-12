import { describe, expect, it } from "@effect/vitest";
import * as Ci from "@kampus/libfabrika/ci/Ci";
import * as CodeHost from "@kampus/libfabrika/codehost/CodeHost";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import * as fc from "fast-check";
import { handlers } from "./handlers.ts";

describe("L12: handlers map faults", () => {
  it("keeps only the declared reason; defects and invalid inputs have one fixed failure; interrupts pass through", () => {
    fc.assert(
      fc.property(
        fc.record({
          method: fc.constantFrom("change", "update", "checks", "merge"),
          reason: fc.constantFrom("unavailable", "rate_limited", "refused"),
          cause: fc.option(fc.string({ unit: "binary", maxLength: 80 }), { nil: undefined }),
          kind: fc.constantFrom("fault", "defect", "interrupt", "bad_head", "no_attempt"),
          start: fc.boolean(),
        }),
        (cell) => {
          expect.hasAssertions();
          const head = Schema.decodeUnknownSync(CodeHost.Commit)("a".repeat(40));
          const reason = cell.method === "checks" && cell.reason === "refused" ? "unavailable" : cell.reason;
          const cause = cell.cause === undefined ? undefined : new Error(cell.cause);
          const hostFault = new CodeHost.CodeHostError({
            reason:
              reason === "refused"
                ? new CodeHost.Refused({ cause })
                : reason === "rate_limited"
                  ? new CodeHost.RateLimited({ cause })
                  : new CodeHost.Unavailable({ cause }),
          });
          const ciFault = new Ci.CiError({
            reason: reason === "rate_limited" ? new Ci.RateLimited({ cause }) : new Ci.Unavailable({ cause }),
          });
          const fail = <E>(fault: E): Effect.Effect<never, E> =>
            cell.kind === "interrupt"
              ? Effect.interrupt
              : cell.kind === "defect"
                ? Effect.die(new Error(cell.cause ?? "defect"))
                : Effect.fail(fault);
          const host = Layer.succeed(CodeHost.CodeHost, {
            change: () => fail(hostFault),
            update: () => fail(hostFault),
            merge: () => fail(hostFault),
          });
          const ci = Layer.succeed(Ci.Ci, { start: () => fail(ciFault), at: () => fail(ciFault) });
          const cmd: Record<string, unknown> = { type: cell.method, attempt: 1, change: 1, head, start: cell.start };

          if (cell.kind === "bad_head") {
            if (cell.method === "change") {
              cmd.change = 0;
            } else {
              cmd.head = "short";
            }
          }

          if (cell.kind === "no_attempt") {
            delete cmd.attempt;
          }

          const exit = Effect.runSyncExit(handlers[cell.method]!(cmd).pipe(Effect.provide(Layer.merge(host, ci))));

          if (cell.kind === "fault") {
            expect(Exit.isSuccess(exit)).toBe(true);

            if (Exit.isSuccess(exit)) {
              expect(exit.value).toEqual({ _tag: "Err", error: { _tag: reason } });
              expect(exit.value._tag === "Err" && Object.keys(exit.value.error as object)).toEqual(["_tag"]);
            }
          } else {
            expect(Exit.isFailure(exit)).toBe(true);

            if (Exit.isFailure(exit)) {
              if (cell.kind === "interrupt") {
                expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
              } else {
                const failures = exit.cause.reasons;
                expect(failures).toHaveLength(1);
                const reason = failures[0]!;
                expect(reason._tag).toBe("Fail");

                if (reason._tag === "Fail") {
                  expect(reason.error).toMatchObject({ _tag: "HandlerDefect", cmd: cell.method });
                  expect(Object.hasOwn(Object(reason.error), "cause")).toBe(false);
                }
              }
            }
          }
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
  });
});
