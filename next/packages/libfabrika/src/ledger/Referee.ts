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
 * The referee's logic as a service: the one place that numbers the log. This file is the contract
 * only (0095).
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
import type { Appended, Entry, Waited } from "./Log.ts";

/**
 * Service for the referee: the one place that orders writes, giving each entry its `rev`, its
 * `pos` and its `arrivedAt`.
 *
 * **Details**
 *
 * Most code asks for `Ledger`. `Referee` is the same three calls one step lower, the way the
 * project object answers them to other objects: `append` takes an unchecked line and checks it,
 * `read` answers one page, and `read` and `wait` name the reader, so one referee serves many
 * readers.
 *
 * @stability unstable
 * @category services
 */
export class Referee extends Context.Service<
  Referee,
  {
    /**
     * Checks the line, then decides and writes it in one atomic step. A line that fails a check is
     * answered `refused`, never written.
     */
    readonly append: (stream: string, id: string, line: unknown) => Effect.Effect<Appended, LedgerError>;
    /** One page: at most `PAGE` of the stream's entries past `after`, oldest first. */
    readonly read: (stream: string, after: Rev, reader: string) => Effect.Effect<ReadonlyArray<Entry>, LedgerError>;
    /**
     * Answers at once. `parked` leaves a ring for `reader`, which the next append to the stream
     * takes out and rings once.
     */
    readonly wait: (stream: string, after: Rev, reader: string) => Effect.Effect<Waited, LedgerError>;
  }
>()("@kampus/libfabrika/ledger/Referee") {}
