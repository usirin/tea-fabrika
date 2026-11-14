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
