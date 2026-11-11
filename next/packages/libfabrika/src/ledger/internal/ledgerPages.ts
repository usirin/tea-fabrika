// A ledger read as a Stream of pages, shared by both Ledger layers (0095).
import { Effect, Option, Stream } from "effect";
import type { Rev } from "../../Rev.ts";
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
