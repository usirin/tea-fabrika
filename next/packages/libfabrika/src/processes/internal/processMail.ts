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
