/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * Several ledger reads and appends as one atomic turn. This file is the contract only (0095).
 *
 * @stability unstable
 */
import { Context } from "effect";
import type { Effect } from "effect";
import type { Rev } from "../Rev.ts";
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
