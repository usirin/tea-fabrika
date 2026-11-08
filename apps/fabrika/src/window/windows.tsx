import {applyCell} from "@demlik/tea";
import {type AnyProgram, readInput, type View, type WindowProps} from "@kampus/fabrika-old";
import {counter} from "@tea-fabrika/counter";
import {CounterWindow} from "@tea-fabrika/counter/window";
import {map} from "@tea-fabrika/map";
import {MapWindow} from "@tea-fabrika/map/window";
import {markdown} from "@tea-fabrika/markdown";
import {MarkdownWindow} from "@tea-fabrika/markdown/window";
import {ticket} from "@tea-fabrika/ticket";
import {TicketWindow} from "@tea-fabrika/ticket/window";
import {trace} from "@tea-fabrika/trace";
import {TraceWindow} from "@tea-fabrika/trace/window";
import {tracker} from "@tea-fabrika/tracker";
import {TrackerWindow} from "@tea-fabrika/tracker/window";
import {Schema} from "effect";
import {type ReactNode, useLayoutEffect, useSyncExternalStore} from "react";
import {type Keys, sameTarget, spell, type Target} from "../desk/keymap.ts";
import {reader} from "../messages.ts";

// The windows the app knows, by program name: built into its bundle, for now
// (docs/direction/the-gui-is-electron-first.md). Each is drawn from its front's data only once
// that data reads by the program's own view schema; data that does not read is shown as refused,
// never handed to the window.

/** A program's window as the app holds it: its data read, then drawn, with the way to send. */
export interface Known {
	readonly draw: (data: unknown, send: (msg: unknown) => void, context: WindowContext) => ReactNode;
	readonly command: (tile: string, word: string, send: (msg: unknown) => void) => string | null;
	readonly forget: (tile: string) => void;
}
interface WindowContext {
	readonly tile: string;
	readonly keys: Keys;
	readonly mapping: boolean;
	readonly run: (target: Target) => void;
}
type LocalCmd = {readonly type: string; readonly [key: string]: unknown};

/** A program with a view, as `defineProgram` types one. */
type Windowed = AnyProgram & {readonly view: View<any, any>};

const known = <P extends Windowed>(
	program: P,
	Window: (props: WindowProps<P>) => ReactNode,
): readonly [string, Known] => {
	const read = reader(program.view.data);
	const locals = new Map<string, ReturnType<typeof makeLocal>>();
	const makeLocal = () => {
		const behavior = program.view.window;
		let state = behavior?.machine.init(null, undefined)[0];
		const listeners = new Set<() => void>();
		const effects = new Set<(cmd: LocalCmd) => void>();
		return {
			get: () => state,
			subscribe: (listener: () => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			listen: (listener: (cmd: LocalCmd) => void) => {
				effects.add(listener);
				return () => {
					effects.delete(listener);
				};
			},
			send: (msg: unknown, send: (msg: unknown) => void): string | null => {
				if (behavior === undefined) {
					const read = readInput(program, msg);
					if (read.kind === "refused") return read.why;
					send(read.msg);
					return null;
				}
				if (!Schema.is(behavior.msg)(msg)) return "The window message does not fit.";
				const why = behavior.refuse(state, msg);
				if (why !== null) return why;
				const [next, cmds] = applyCell(behavior.machine, state, msg as {type: string});
				state = next;
				for (const command of cmds as readonly LocalCmd[]) {
					if (command.type === "input") {
						const read = readInput(program, command.msg);
						if (read.kind === "read") send(read.msg);
					} else for (const effect of effects) effect(command);
				}
				for (const listener of listeners) listener();
				return null;
			},
		};
	};
	const localFor = (tile: string) => {
		let local = locals.get(tile);
		if (local === undefined) {
			local = makeLocal();
			locals.set(tile, local);
		}
		return local;
	};
	function Controlled({
		data,
		send,
		context,
	}: {
		data: WindowProps<P>["view"];
		send: (msg: unknown) => void;
		context: WindowContext;
	}) {
		const local = localFor(context.tile);
		const state = useSyncExternalStore(local.subscribe, local.get, local.get);
		useLayoutEffect(() => {
			if (
				program.view.window !== undefined &&
				Schema.is(program.view.window.msg)({type: "view", view: data})
			)
				local.send({type: "view", view: data}, send);
		}, [data, local, send]);
		const mode = program.mode(state);
		// Each declared word gets one helper; Object.fromEntries loses those exact keys.
		const commands = Object.fromEntries(
			Object.keys(program.commands).map((word) => {
				const target = {program: program.name, word, mode};
				const row =
					context.keys.rows.find((row) => sameTarget(row.target, target)) ??
					context.keys.rows.find((row) => sameTarget(row.target, {...target, mode: null}));
				const keys =
					row?.keys.map(
						(key) =>
							`${key._tag === "after_prefix" ? `${spell(context.keys.prefix)} ` : ""}${spell(key.key)}`,
					) ?? [];
				const run = () => context.run(row?.target ?? target);
				return [
					word,
					Object.assign(run, {
						keys,
						control: {
							onClick: run,
							"data-command": word,
							"data-command-program": program.name,
							"data-command-mode": row?.target.mode ?? "",
							...(context.mapping
								? {"aria-label": `${word} · ${keys.join(", ") || "Unbound"}`}
								: {}),
						},
					}),
				];
			}),
		) as WindowProps<P>["commands"];
		return (
			<Window
				view={data}
				send={send}
				commands={commands}
				local={{state, send: (msg: unknown) => local.send(msg, send), listen: local.listen}}
			/>
		);
	}
	return [
		program.name,
		{
			forget: (tile) => {
				locals.delete(tile);
			},
			command: (tile, word, send) => {
				const command = program.commands[word];
				return command === undefined
					? "Unknown window command."
					: localFor(tile).send(command.send, send);
			},
			draw: (data, send, context) => {
				const got = read(data);
				return got.kind === "read" ? (
					<Controlled data={got.msg} send={send} context={context} />
				) : (
					<p role="alert">
						refused what {program.name} sent its window: {got.why}
					</p>
				);
			},
		},
	];
};

export const WINDOWS: ReadonlyMap<string, Known> = new Map([
	known(counter, CounterWindow),
	known(tracker, TrackerWindow),
	known(ticket, TicketWindow),
	known(map, MapWindow),
	known(trace, TraceWindow),
	known(markdown, MarkdownWindow),
]);
