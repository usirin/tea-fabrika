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
import { Option, Schema } from "effect";
import type { Entry } from "../../ledger/Log.ts";
import type { Letter } from "../Mailbox.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import type { ProcessTable } from "../Process.ts";

const Sent = Schema.Struct({ m: Schema.Json });
const decodeSent = Schema.decodeUnknownOption(Sent);

/**
 * Fresh delivery uses today's cancellations. Historical mailbox replay stays unchanged. It never
 * fails on what another writer put in the inbox: a `send` with no `m` is skipped, and any `m` is
 * mail unless the table calls it a signal.
 */
/** @internal */
export const processMail = (table: ProcessTable, process: string, entries: Iterable<Entry>) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
