import {readFileSync} from "node:fs";
import {User, Writer} from "@kampus/fabrika-old";
import {sealAsk} from "@kampus/pipeline/tickets/ask";
import {Effect, Schema} from "effect";
import {DRAFT} from "../ask-desk/cases.ts";

// Today's version. All actors, messages, clocks and room ids below are synthetic.
// The question uses the ask-desk fixture and its real sealer, never a second ask format.
const Actors = Schema.Struct({OWNER: User, PERSON: User, AGENT: Writer, OTHER: Writer, NOW: Schema.Finite});
export const {OWNER, PERSON, AGENT, OTHER, NOW} = Schema.decodeUnknownSync(Actors)(JSON.parse(readFileSync(new URL("./actors.json", import.meta.url), "utf8")));
export const MESSAGE = {
	id: "m17", thread: "dm/owner/scout", by: AGENT, at: NOW, said: NOW - 17,
	text: "The footer check fails. Should I fix it?", replyTo: null, ticket: null,
};
export const PERSON_MESSAGE = {
	...MESSAGE, id: "m18", thread: "dm/owner/peer", by: PERSON, at: NOW + 1,
	text: "Can you read the plan?", ticket: 268,
};
export const MessageRow = Schema.TaggedStruct("message", {key: Schema.String, message: Schema.Unknown});
export const StopRow = Schema.TaggedStruct("stop", {key: Schema.String, stop: Schema.Unknown});
export const AskRow = Schema.TaggedStruct("ask", {key: Schema.String, ask: Schema.Unknown});
export const messageRow = MessageRow.make({key: MESSAGE.id, message: MESSAGE});
export const personRow = MessageRow.make({key: PERSON_MESSAGE.id, message: PERSON_MESSAGE});
export const stopRow = StopRow.make({
	key: "269/stuck/build", stop: {ticket: 269, why: "read_failed", resume: "build", at: NOW - 1},
});
const Reading = Schema.TaggedStruct("reading", {});
export const askRow = async (ticket = 268) => {
	const sealed = await Effect.runPromise(sealAsk({...DRAFT, ask: `a-approve-${ticket}`}));
	const ask = {key: `${ticket}/${sealed.ask}`, ticket, shows: sealed.shows,
		saw: sealed.saw, editor: Reading.make({}), failure: null, busy: false,
		needed: false, at: NOW - 2 + ticket - 268};
	return {...AskRow.make({key: ask.key, ask}), ask};
};
