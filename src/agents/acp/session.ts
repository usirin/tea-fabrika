import {defineMachine} from "@demlik/tea";

// What one `acp` run keeps across a restart: which harness, the ACP session
// id it opened, and the prompts told and not answered yet. The first prompt
// waiting is the one whose turn is running. A start after a kill finds it,
// opens the same session again (`session/resume` or `session/load`) and
// sends it again: nobody types it twice.
//
//   told "read a.txt"        waiting: [{n: 1, prompt: "read a.txt"}]
//   opened s-1 claude        id: "s-1"
//   ended 1                  waiting: [], turns: 1
//
// Kept as small as it can be: the transcript is not here. It comes back from
// the harness's replay, or not at all (./transcript.ts).

export interface Waiting {
	readonly n: number;
	readonly prompt: string;
}

export interface Session {
	/** The harness it was opened on: a session cannot move to another harness. */
	readonly agent: string | null;
	/** The ACP session id. `null`: none opened yet. */
	readonly id: string | null;
	/** Turns ended. */
	readonly turns: number;
	/** Prompts told so far: the next one is `told + 1`. */
	readonly told: number;
	readonly waiting: readonly Waiting[];
}

export type SessionMsg =
	| {readonly type: "opened"; readonly agent: string; readonly id: string}
	| {readonly type: "told"; readonly prompt: string}
	| {readonly type: "ended"; readonly n: number};

export const NONE: Session = {agent: null, id: null, turns: 0, told: 0, waiting: []};

export const session = defineMachine({
	types: {model: {} as Session, msg: {} as SessionMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? NONE, []],
	update: {
		opened: (s, m) => [{...s, agent: m.agent, id: m.id}, []],
		told: (s, m) => [
			{...s, told: s.told + 1, waiting: [...s.waiting, {n: s.told + 1, prompt: m.prompt}]},
			[],
		],
		ended: (s, m) =>
			s.waiting[0]?.n === m.n
				? [{...s, turns: s.turns + 1, waiting: s.waiting.slice(1)}, []]
				: [s, []],
	},
});
