import {Schema} from "effect";
import type {Entry} from "../data/log.ts";
import type {Letter} from "./mailbox.ts";
import type {ProcessTable} from "./process.ts";

const Sent = Schema.Struct({m: Schema.Json});
const decodeSent = Schema.decodeUnknownSync(Sent);

/** Fresh delivery uses today's cancellations. Historical mailbox replay stays unchanged. */
export const processMail = (table: ProcessTable, process: string, entries: Iterable<Entry>) => {
	const letters: Array<{letter: Letter; arrivedAt: number}> = [];
	for (const entry of entries) {
		if (entry._tag !== "send") continue;
		const {m} = decodeSent(entry.body);
		if (table.deliver(entry, m, process) === "drop") continue;
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
