import {NONE, type Session, session} from "../agents/acp/session.ts";
import {type Law, law, type MsgOf, stepOf, type Update, type World} from "./explore.ts";

// What one `acp` run keeps across a restart, under every order of messages:
// its world and its laws.
//
// It has no Cmds. Its world is the host (`acp/program.ts`): a session opened
// on a harness, a prompt told, a turn ended. Any of them may come at any
// time, a stray one too: the machine keeps its own rules, whatever its host
// sends.

export type AnySessionMsg = MsgOf<typeof session>;
type Msg = AnySessionMsg;
type Cmd = never;
const sessionUpdate = stepOf<Session, Msg, Cmd>(session);

export function sessionWorld(): World<Session, Msg, Cmd> {
	return {
		outside: (s) => [
			{type: "opened", agent: "claude", id: "s-1"},
			{type: "opened", agent: "codex", id: "s-2"},
			{type: "told", prompt: "p"},
			// The prompt whose turn is running, one waiting behind it, and one never told.
			...[...s.waiting.slice(0, 2).map((w) => w.n), s.told + 1].map(
				(n): Msg => ({type: "ended", n}),
			),
		],
		answers: () => [],
	};
}

export function sessionLaws<S extends Session>(): readonly Law<S, Msg, Cmd>[] {
	return [
		law<S, Msg, Cmd>("once opened, a session keeps its harness and its id", ({prev, next}) =>
			prev.id !== null && (next.id !== prev.id || next.agent !== prev.agent)
				? `opened ${prev.id} on ${prev.agent}, and now it is ${next.id} on ${next.agent}`
				: null,
		),
		law<S, Msg, Cmd>("every prompt told is waiting or ended", ({next}) =>
			next.turns + next.waiting.length === next.told
				? null
				: `${next.told} told, ${next.turns} ended and ${next.waiting.length} waiting`,
		),
		law<S, Msg, Cmd>("prompts are numbered in the order told, from 1, once each", ({next}) => {
			const ns = next.waiting.map((w) => w.n);
			const first = next.turns + 1;
			return ns.every((n, i) => n === first + i)
				? null
				: `waiting ${ns.join(", ")} after ${next.turns} turns`;
		}),
		law<S, Msg, Cmd>(
			"a turn ends only for the prompt whose turn is running",
			({prev, msg, next}) =>
				next.turns > prev.turns && !(msg.type === "ended" && msg.n === prev.waiting[0]?.n)
					? `${msg.type} ended a turn while ${prev.waiting[0]?.n ?? "no prompt"} was running`
					: null,
		),
	];
}

export const sessionInit: Session = NONE;
export const sessionStep: Update<Session, Msg, Cmd> = sessionUpdate;

export function showSessionMsg(m: Msg): string {
	switch (m.type) {
		case "opened":
			return `opened ${m.id} on ${m.agent}`;
		case "told":
			return "told a prompt";
		case "ended":
			return `ended ${m.n}`;
	}
}

// ---------------------------------------------------------------- planted mistakes

/** A turn that ends takes the last prompt off, not the one running. */
export const endsTheLast: Update<Session, Msg, Cmd> = (s, m) =>
	m.type === "ended" && s.waiting.at(-1)?.n === m.n && s.waiting.length > 1
		? [{...s, turns: s.turns + 1, waiting: s.waiting.slice(0, -1)}, []]
		: sessionUpdate(s, m);
