import {quiet} from "../hosted/agent.ts";
import {type Law, law, type MsgOf, stepOf, type Update, type World} from "./explore.ts";

// The agent child's machine (../hosted/agent.ts): it keeps nothing, so its one law is that nothing
// it is told changes its state or asks for work. What the child does is in its answers stream,
// written by the program, not by this machine.

type Msg = MsgOf<typeof quiet>;
type State = {readonly n: number};
type Cmd = never;

export const agentInit: State = {n: 0};
export const agentStep: Update<State, Msg, Cmd> = stepOf<State, Msg, Cmd>(quiet);

export function agentWorld(): World<State, Msg, Cmd> {
	return {outside: () => [{type: "noop"}], answers: () => []};
}

export function agentLaws<S extends State>(): readonly Law<S, Msg, Cmd>[] {
	return [
		law<S, Msg, Cmd>("the child's machine keeps nothing", ({prev, next, cmds}) =>
			prev.n === next.n && cmds.length === 0
				? null
				: `after ${prev.n} it holds ${next.n} and asks for ${cmds.length} commands`,
		),
	];
}

export const showAgentMsg = (m: Msg): string => m.type;
