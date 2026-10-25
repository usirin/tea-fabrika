// Who wrote a ledger row, typed: a user or an agent
// (docs/direction/the-ticket-is-the-lane-view.md: each fact says who wrote it).
//
// A row keeps its writer as text: `user:<id>` or `agent:<id>`, split at the
// first colon, the id with no spaces. `writerOf` reads that text back. Any
// other text, such as the ledger's own "ledger" or a host's holder name,
// names neither, so it is never taken for a user.
//
// Today the caller names its writer when it appends. The ledger stamping the
// writer from a signing key comes later (docs/direction/a-local-first-sync-engine.md).
import {Option, Schema} from "effect";

/** One user's or one agent's id: some text, no spaces. */
const Id = Schema.String.check(Schema.isPattern(/^\S+$/));

/** Who wrote a row: a user, or an agent. */
export const Writer = Schema.Union([
	Schema.Struct({kind: Schema.Literal("user"), id: Id}),
	Schema.Struct({kind: Schema.Literal("agent"), id: Id}),
]);
export type Writer = typeof Writer.Type;

const decode = Schema.decodeUnknownOption(Writer);

/** The writer a row's `writer` text names, or `null` when it names neither a user nor an agent. */
export function writerOf(text: string): Writer | null {
	const at = text.indexOf(":");
	if (at === -1) return null;
	return Option.getOrNull(decode({kind: text.slice(0, at), id: text.slice(at + 1)}));
}

/** The text a row keeps for `writer`: `writerOf` reads it back. */
export const writerText = (writer: Writer): string => `${writer.kind}:${writer.id}`;
