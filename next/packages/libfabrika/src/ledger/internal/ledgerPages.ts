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
// A ledger read as a Stream of pages, shared by both Ledger layers (0095).
import { Effect, Option, Stream } from "effect";
import type { Rev } from "../../Rev.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import type { LedgerError } from "../Ledger.ts";
import { type Entry, PAGE } from "../Log.ts";

/** A read as a Stream of pages, fetched only as it is pulled; a short page is the last. */
/** @internal */
export const pages = (
  after: Rev,
  page: (after: Rev) => Effect.Effect<ReadonlyArray<Entry>, LedgerError>,
): Stream.Stream<Entry, LedgerError> =>
  Stream.paginate(after, (from): Effect.Effect<readonly [ReadonlyArray<Entry>, Option.Option<Rev>], LedgerError> =>
    Effect.map(page(from), (entries) => [
      entries,
      entries.length < PAGE ? Option.none() : Option.fromUndefinedOr(entries.at(-1)?.rev),
    ]),
  );
