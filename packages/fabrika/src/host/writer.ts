// Who wrote a ledger row, typed: a user, or an agent working for a user
// (docs/direction/the-ticket-is-the-lane-view.md: each fact says who wrote it).
//
//   user:owner                    {kind: "user", id: "owner"}
//   agent:triage for:github:42    {kind: "agent", id: "triage", for: "github:42"}
//   agent:review                  {kind: "agent", id: "review"}   a row from before the door
//
// A row keeps its writer as text, `<kind>:<id>`, split at the first colon, the
// id with no spaces. An agent the door let in names its person after a space,
// ` for:<user id>`. Rows written before the door say `agent:<id>` with no
// person. They still read, as an agent whose person the row does not say, so
// old tickets keep their writers. Any other text, such as the ledger's own
// "ledger" or a host's holder name, names neither, so it is never taken for a
// user.
//
// On a ledger behind the door (`door.ts`), the door writes this text from the
// credential the request came with, never from the request. On a ledger in this
// process (memory, node:sqlite), the caller still names it.
import {Option, Schema} from "effect";
import {type Stamp, stampText} from "./door.ts";

/** One user's or one agent's id: some text, no spaces. */
const Id = Schema.String.check(Schema.isPattern(/^\S+$/));

/** A person. */
export const User = Schema.Struct({kind: Schema.Literal("user"), id: Id});
/** An agent, and the person it works for: what the door says for an agent's credential. */
export const Agent = Schema.Struct({kind: Schema.Literal("agent"), id: Id, for: Id});
/** An agent in a row written before the door: its person is not in the row. Read only. */
export const AgentBefore = Schema.Struct({kind: Schema.Literal("agent"), id: Id});

/** Who wrote a row: a user, an agent for a user, or an agent from before the door. */
export const Writer = Schema.Union([User, Agent, AgentBefore]);
export type Writer = typeof Writer.Type;

const decode = Schema.decodeUnknownOption(Writer);
const decodeAgent = Schema.decodeUnknownOption(Agent);

/** The writer a row's `writer` text names, or `null` when it names neither a user nor an agent. */
export function writerOf(text: string): Writer | null {
	const [head, rest, ...more] = text.split(" ");
	if (head === undefined || more.length > 0) return null;
	const at = head.indexOf(":");
	if (at === -1) return null;
	const kind = head.slice(0, at);
	const id = head.slice(at + 1);
	if (rest === undefined) return Option.getOrNull(decode({kind, id}));
	if (kind !== "agent" || !rest.startsWith("for:")) return null;
	// Only `Agent`: an empty person must not fall through to the agent from before the door.
	return Option.getOrNull(decodeAgent({kind, id, for: rest.slice("for:".length)}));
}

/** The text a row keeps for `writer`: `writerOf` reads it back. */
export const writerText = (writer: Writer | Stamp): string =>
	"for" in writer ? stampText(writer) : `${writer.kind}:${writer.id}`;
