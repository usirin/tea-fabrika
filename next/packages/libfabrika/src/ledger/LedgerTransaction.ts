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
 * Several ledger reads and appends as one atomic turn. This file is the contract only (0095).
 *
 * @stability unstable
 */
import { Context } from "effect";
import type { Effect } from "effect";
import type { Rev } from "../Rev.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import type { LedgerError } from "./Ledger.ts";
import type { Entry, Line } from "./Log.ts";

/**
 * The reads and appends one ledger turn may make. It works only inside the synchronous step: a
 * call made after the step returned throws.
 *
 * **Details**
 *
 * `read` gives every entry of the stream past `after`, with no page limit. `append` returns the
 * entry's place, a resend's first place included. When the referee refuses the line, `append`
 * throws a `LedgerError` with `reason: "refused"`, which rolls the whole turn back.
 *
 * @stability unstable
 * @category models
 */
export interface LedgerTurn {
  readonly read: (stream: string, after: Rev) => Iterable<Entry>;
  readonly append: (stream: string, id: string, line: Line) => { readonly rev: Rev; readonly pos: Rev };
}

/**
 * Service that runs a synchronous step as one atomic ledger turn: nothing else is written between
 * its reads and its appends, and its appends land together or not at all.
 *
 * **Details**
 *
 * It exists for a write that depends on what the log holds at that moment, such as folding a
 * stream and appending only when the fold allows it. With plain `Ledger` calls, another writer
 * could append between the read and the write. Waiters are rung after the turn commits, and a
 * ring that fails does not fail the turn.
 *
 * **Gotchas**
 *
 * Whatever the step throws rolls the turn back. A `LedgerError` passes through as it is; any other
 * throw fails as `storage`, or as `bad_row` for a schema error. So a step that wants to say no
 * returns that as a value before it appends.
 *
 * @stability unstable
 * @category services
 */
export class LedgerTransaction extends Context.Service<
  LedgerTransaction,
  { readonly transact: <A>(step: (turn: LedgerTurn) => A) => Effect.Effect<A, LedgerError> }
>()("@kampus/libfabrika/ledger/LedgerTransaction") {}
