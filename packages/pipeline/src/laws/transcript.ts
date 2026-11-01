import {
	EMPTY,
	type Seen,
	type ToolStatus,
	type Transcript,
	transcript,
} from "@kampus/fabrika/agents/acp";
import {
	broke,
	type Law,
	law,
	type MsgOf,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// What one ACP session shows a person, under every order of messages: its
// world and its laws.
//
// It has no Cmds. Its world is the harness, through the host: the session
// opened (or loaded), what the agent says, a tool call and its updates, a
// turn started and ended, a permission asked and answered, a cancel. Any
// update may come at any time, a stray one too. A turn starts with the next
// number, and ends only while it runs: the host does that much.

export type AnyTranscriptMsg = MsgOf<typeof transcript>;
type Msg = AnyTranscriptMsg;
type Cmd = never;
const transcriptUpdate = stepOf<Transcript, Msg, Cmd>(transcript);

const seen = (event: Seen): Msg => ({type: "seen", events: [event]});
const update = (status: ToolStatus): Msg =>
	seen({kind: "tool_update", id: "t1", name: null, title: null, status});
const ASKS = ["q1", "q2"] as const;

export function transcriptWorld(): World<Transcript, Msg, Cmd> {
	return {
		outside: (s) => [
			{type: "opening", how: "load", earlier: 0},
			{type: "opened", mode: null},
			seen({kind: "said", who: "agent", text: "x", id: null}),
			seen({kind: "tool", id: "t1", name: "Read", title: "a", status: "pending"}),
			update("in_progress"),
			update("completed"),
			{type: "turn", n: s.earlier + s.turns.length + 1, prompt: "p"},
			...(s.turn === null
				? []
				: [
						{type: "ended", ended: {n: s.turn, stop: "end_turn", usage: null}} as const,
						{type: "ended", ended: {n: s.turn, stop: "cancelled", usage: null}} as const,
					]),
			// The host numbers its asks: one open is never asked again.
			...ASKS.filter((id) => !s.asks.some((a) => a.id === id)).map((id): Msg => ({
				type: "asked",
				ask: {id, tool: "Edit", title: "a", kind: "edit", options: ["allow_once"]},
			})),
			...ASKS.map((ask): Msg => ({type: "answered", ask, answer: "allowed"})),
			{type: "cancelling"},
		],
		answers: () => [],
	};
}

const running = (status: ToolStatus) => status === "pending" || status === "in_progress";
const answeredIn = (s: Transcript) =>
	s.answered.allowed + s.answered.refused + s.answered.cancelled;

export function transcriptLaws<S extends Transcript>(): readonly Law<S, Msg, Cmd>[] {
	return [
		law<S, Msg, Cmd>("a finished tool call never runs again", ({prev, next}) => {
			for (const tool of prev.tools) {
				if (running(tool.status)) continue;
				const now = next.tools.find((t) => t.id === tool.id);
				if (now !== undefined && running(now.status))
					return `${tool.id} was ${tool.status}, and is ${now.status} again`;
			}
			return null;
		}),
		watched<S, Msg, Cmd, number>(
			"every ask is answered once: open, or counted once by how it was answered",
			0,
			(raised, {prev, msg, next}) => {
				const now =
					msg.type === "asked" && !prev.asks.some((a) => a.id === msg.ask.id) ? raised + 1 : raised;
				return now === next.asks.length + answeredIn(next)
					? now
					: broke(
							`${now} asked, ${next.asks.length} open and ${answeredIn(next)} counted as answered`,
						);
			},
		),
		law<S, Msg, Cmd>("what a person was shown is never taken back", ({prev, next}) => {
			const gone = prev.messages.findIndex((m, i) => !next.messages[i]?.text.startsWith(m.text));
			return gone === -1 ? null : `message ${gone + 1} was "${prev.messages[gone]?.text}"`;
		}),
	];
}

export const transcriptInit: Transcript = EMPTY;
export const transcriptStep: Update<Transcript, Msg, Cmd> = transcriptUpdate;

export function showTranscriptMsg(m: Msg): string {
	switch (m.type) {
		case "opening":
			return `opening by ${m.how}`;
		case "seen":
			return m.events
				.map((e) =>
					e.kind === "said"
						? `${e.who} says "${e.text}"`
						: e.kind === "tool" || e.kind === "tool_update"
							? `${e.kind} ${e.id} ${e.status}`
							: e.kind,
				)
				.join(", ");
		case "turn":
			return `turn ${m.n}`;
		case "ended":
			return `turn ${m.ended.n} ended: ${m.ended.stop}`;
		case "asked":
			return `asked ${m.ask.id}`;
		case "answered":
			return `answered ${m.ask}`;
		default:
			return m.type;
	}
}

// ---------------------------------------------------------------- planted mistakes

/** An answer to an ask no longer open is counted all the same. */
export const countsAStrayAnswer: Update<Transcript, Msg, Cmd> = (s, m) =>
	m.type === "answered" && !s.asks.some((a) => a.id === m.ask)
		? [{...s, answered: {...s.answered, [m.answer]: s.answered[m.answer] + 1}}, []]
		: transcriptUpdate(s, m);

/** A new message from the agent takes the place of the last one. */
export const overwritesTheLast: Update<Transcript, Msg, Cmd> = (s, m) => {
	const [next, cmds] = transcriptUpdate(s, m);
	return next.messages.length > s.messages.length && s.messages.length > 0
		? [{...next, messages: [...s.messages.slice(0, -1), ...next.messages.slice(-1)]}, cmds]
		: [next, cmds];
};
