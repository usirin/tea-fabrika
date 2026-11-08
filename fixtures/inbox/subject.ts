import {applyCell, type Machine} from "@demlik/tea";
import type {AnyProgram, AnyView} from "@kampus/fabrika-old";
import * as core from "@kampus/fabrika-old";
import {Schema} from "effect";
import {expect} from "vitest";
import {member, product} from "./load.ts";
export {member, product} from "./load.ts";

// These names bind the plan's sketches to production entry points. No stand-in reducer or
// delivery path lives here. Missing product files fail inside the law, not during collection.
const Row = Schema.TaggedUnion({
	ask: {key: Schema.String, ask: Schema.Unknown},
	stop: {key: Schema.String, stop: Schema.Unknown},
	message: {key: Schema.String, message: Schema.Unknown},
});
export type Row = typeof Row.Type;
export type State = {
	readonly rows: readonly Row[];
	readonly selected: string | null;
	readonly look: boolean;
	readonly reply: {readonly _tag: string; readonly message?: string; readonly id?: string;
		readonly text?: string; readonly why?: string; readonly to?: unknown};
	readonly marks: {readonly later: readonly string[]; readonly seen: readonly string[]};
};
export type Msg =
	| {type: "arrive"; row: Row}
	| {type: "move"; value: number}
	| {type: "select"; value: string}
	| {type: "answered"; key: string}
	| {type: "later"; value: null}
	| {type: "seen"; value: null}
	| {type: "reply"; value: null}
	| {type: "change"; value: string}
	| {type: "send"; value: {id: string; said: number}}
	| {type: "retry"; value: null}
	| {type: "escape"; value: null}
	| {type: "look"; value: null}
	| {type: "open"; value: null}
	| {type: "reply_send_ok"; cmd: Command; value: typeof Receipt.Type; at: number}
	| {type: "reply_send_err"; cmd: Command; error: typeof SendRefused.Type; at: number};
export type Command = {readonly type: string; readonly [key: string]: unknown};
const Receipt = Schema.TaggedUnion({queued: {id: Schema.String}, delivered: {id: Schema.String}});
const SendRefused = Schema.TaggedStruct("refused", {why: Schema.String});
// tea 0.25 mints these envelopes at its Cmd edge. Tests send those same envelopes.
export const replyResult = (cmd: Command, result: "queued" | "delivered", at = 0): Msg => ({
	type: "reply_send_ok", cmd, value: Receipt.cases[result].make({id: Schema.decodeUnknownSync(Schema.String)(cmd.id)}), at,
});
export const replyFailure = (cmd: Command, why: string, at = 0): Msg => ({type: "reply_send_err", cmd, error: SendRefused.make({why}), at});
export type InboxMachine = Machine<State, Msg, Command, never, undefined>;
export type Projection = {readonly rows: readonly Row[]; readonly selected: string | null;
	readonly reply: State["reply"]; readonly look: boolean};
export const inboxSubject = async (law: string) => {
	const module = await product("programs/inbox/src/index.ts", law, "no recipient inbox program exists");
	const program = member<AnyProgram>(module, "inbox", `${law}: no inbox program declaration`);
	const kind = member<{machine: InboxMachine}>(program.machines, "inbox", `${law}: no shared inbox machine`);
	const tile = core.viewOf(program);
	expect(tile, `${law}: no tile projection`).toBeDefined();
	const glanceOf = member<(p: AnyProgram) => AnyView | undefined>(core, "glanceOf", `${law}: programs cannot offer a glance`);
	const glance = glanceOf(program);
	expect(glance, `${law}: no inbox glance projection`).toBeDefined();
	if (tile === undefined || glance === undefined) throw new Error(`${law}: a declared view is missing`);
	return {program, machine: kind.machine, tile, glance};
};
export const step = (machine: InboxMachine, state: State, msg: Msg) => applyCell<State, Msg, Command>(machine, state, msg);
export const fold = (machine: InboxMachine, msgs: readonly Msg[], saved: State | null = null) => {
	let [state, initial] = saved === null ? machine.init(null, undefined) : [saved, []] as const;
	const cmds: Command[] = [...initial];
	for (const msg of msgs) {
		const [next, out] = step(machine, state, msg);
		state = next;
		cmds.push(...out);
	}
	return {state, cmds};
};
const Projection = Schema.Struct({
	rows: Schema.Array(Row), selected: Schema.NullOr(Schema.String), look: Schema.Boolean,
	reply: Schema.Struct({_tag: Schema.String, message: Schema.optionalKey(Schema.String),
		id: Schema.optionalKey(Schema.String), text: Schema.optionalKey(Schema.String),
		why: Schema.optionalKey(Schema.String), to: Schema.optionalKey(Schema.Unknown)}),
});
export const project = (view: AnyView, state: State): Projection =>
	Schema.decodeUnknownSync(Projection)(view.of(state));
export type ViewProps = {view: Projection; send: (message: unknown) => void};
export const renderer = async <A>(name: "window" | "glance", law: string): Promise<A> => {
	const module = await product(`programs/inbox/src/${name}.tsx`, law, `no ${name} renderer exists`);
	return member<A>(module, name === "window" ? "InboxWindow" : "InboxGlance", `${law}: missing inbox renderer`);
};

export type CommandRow = {readonly id: string; readonly name: string;
	readonly keys: readonly string[]; readonly send: {readonly type: string; readonly value: unknown}};
export type Press = {readonly key: string; readonly shift: boolean; readonly ctrl: boolean;
	readonly alt: boolean; readonly meta: boolean};
export type CommandApi = {
	commandsOf: (program: AnyProgram, keys?: Readonly<Record<string, readonly string[]>>) => readonly CommandRow[];
	commandFor: (rows: readonly CommandRow[], press: Press, typing: boolean) => CommandRow | undefined;
};
export const commandSubject = async (law: string): Promise<CommandApi> => {
	const module = await product("packages/fabrika/src/program/commands.ts", law, "no shared program command registry exists");
	return {commandsOf: member(module, "commandsOf", `${law}: no prepared command rows`),
		commandFor: member(module, "commandFor", `${law}: no scoped key dispatch`)};
};
