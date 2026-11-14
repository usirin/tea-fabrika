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
import { Option, Schema } from "effect";
import type { Entry } from "../../ledger/Log.ts";
import type { Letter } from "../Mailbox.ts";
import type { ProcessTable } from "../Process.ts";

const Sent = Schema.Struct({ m: Schema.Json });
const decodeSent = Schema.decodeUnknownOption(Sent);

/**
 * Fresh delivery uses today's cancellations. Historical mailbox replay stays unchanged. It never
 * fails on what another writer put in the inbox: a `send` with no `m` is skipped, and any `m` is
 * mail unless the table calls it a signal.
 */
/** @internal */
export const processMail = (table: ProcessTable, process: string, entries: Iterable<Entry>) => {
  const letters: Array<{ letter: Letter; arrivedAt: number }> = [];

  for (const entry of entries) {
    if (entry._tag !== "send") {
      continue;
    }

    const sent = decodeSent(entry.body);

    if (Option.isNone(sent)) {
      continue;
    }

    const { m } = sent.value;

    if (table.deliver(entry, m, process) === "drop") {
      continue;
    }

    letters.push({
      letter: {
        id: entry.id,
        m,
        by: entry.by,
        for: entry.for,
        sentAt: entry.sentAt,
        parent: entry.parent,
        traceId: entry.traceId,
        rev: entry.rev,
        pos: entry.pos,
      },
      arrivedAt: entry.arrivedAt,
    });
  }

  return letters;
};
