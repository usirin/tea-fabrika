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
 * The proof that one instance start is on record. This file is the contract only. The layer that
 * records the start is `cloudflare/SettingsRecorded.ts`.
 *
 * @stability unstable
 */
import { type Config, Context } from "effect";
import type * as Declarations from "./Declarations.ts";
import type * as Snapshot from "./Snapshot.ts";
import type * as Start from "./Start.ts";

/**
 * Service that holds one instance start, once that start is on record.
 *
 * **Details**
 *
 * Its layer checks the start's input, records it through `Starts`, and checks that the receipt it
 * gets back is for this input: the same start, settings, build and repo. If any step fails, the
 * layer does not build. So code that holds `RecordedStart` runs only after the settings passed
 * their checks and `Starts` answered with a receipt for this start. With the layers in
 * `cloudflare/`, that receipt is the start's entry in the Project object's ledger.
 *
 * It is a plain value. Nothing in it changes after the layer has built.
 *
 * @stability unstable
 * @category services
 */
export class RecordedStart extends Context.Service<
  RecordedStart,
  {
    /** The start's input as the host handed it in, decoded. */
    readonly input: Start.Input;
    /** What `Starts` answered for this start: the saved body and the ledger entry that holds it. */
    readonly receipt: Start.Receipt;
    /** The settings in their canonical encoding, with the hash that was checked against them. */
    readonly snapshot: Snapshot.Snapshot;
    /** Each declared setting's decoded value, by its name in `Declarations.all`, as `values.port`. */
    readonly values: Config.Success<typeof Declarations.all>;
  }
>()("@kampus/libfabrika/settings/RecordedStart") {}
