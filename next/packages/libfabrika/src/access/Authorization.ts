/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
/**
 * Checks that a key belongs, then writes, in one synchronous ledger transaction.
 *
 * @stability unstable
 */
import { Effect, Result, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import { Appended, type Line, valueFor } from "../ledger/Log.ts";
import { short } from "../telemetry/Trace.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { admitted, MemberEvent } from "./Access.ts";
import { foldAccess } from "./AccessFold.ts";
import { NotGranted } from "./SessionManager.ts";

const known: ReadonlySet<string> = new Set(Object.keys(MemberEvent.cases));
const decodeEvent = Schema.decodeUnknownResult(MemberEvent);

/**
 * Appends a line to a stream only if the key is admitted by the membership as it stands now.
 *
 * **Details**
 *
 * Inside one transaction it reads every row of `gateway/access` from the start, skips rows whose
 * tag is not a membership event, folds the rest, and asks `admitted` about the key. If the key may
 * dial, it appends the line and returns it as `placed`. The check and the write share the
 * transaction, so membership cannot change between them. It needs `LedgerTransaction`, and adds
 * span fields for the id, the stream and the outcome (`placed`, `not_granted` or the ledger
 * error's reason).
 *
 * **Gotchas**
 *
 * A membership row that does not decode fails the write with a `LedgerError` of reason `bad_row`.
 * A key that is not admitted fails with `NotGranted` and nothing is written.
 *
 * @stability unstable
 * @category combinators
 */
export const appendAdmitted = Effect.fn("authorization.appendAdmitted")(
  function* (key: string, write: { readonly stream: string; readonly id: string; readonly line: Line }) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
    yield* Effect.annotateCurrentSpan(
      short({ "fab.authorization.id": write.id, "fab.authorization.stream": write.stream }),
    );
    const transaction = yield* LedgerTransaction;
    const result = yield* transaction.transact((turn): Result.Result<Appended, LedgerError | NotGranted> => {
      const events: MemberEvent[] = [];

      for (const row of turn.read("gateway/access", 0)) {
        if (!known.has(row._tag)) {
          continue;
        }

        const event = decodeEvent(valueFor(row));

        if (Result.isFailure(event)) {
          return Result.fail(new LedgerError({ reason: "bad_row", cause: event.failure }));
        }

        events.push(event.success);
      }

      if ("reason" in admitted(foldAccess(events), key)) {
        return Result.fail(new NotGranted({}));
      }

      return Result.succeed(Appended.cases.placed.make(turn.append(write.stream, write.id, write.line)));
    });
    const appended = yield* Effect.fromResult(result);
    yield* Effect.annotateCurrentSpan("fab.authorization.outcome", "placed");
    return appended;
  },
  Effect.tapError((error) =>
    Effect.annotateCurrentSpan("fab.authorization.outcome", error._tag === "NotGranted" ? "not_granted" : error.reason),
  ),
);
