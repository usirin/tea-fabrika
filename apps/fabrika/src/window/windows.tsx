import type {AnyProgram, View, WindowProps} from "@kampus/fabrika-old";
import {counter} from "@tea-fabrika/counter";
import {CounterWindow} from "@tea-fabrika/counter/window";
import {map} from "@tea-fabrika/map";
import {MapWindow} from "@tea-fabrika/map/window";
import {markdown} from "@tea-fabrika/markdown";
import {MarkdownWindow} from "@tea-fabrika/markdown/window";
import {runs} from "@tea-fabrika/runs";
import {RunsWindow} from "@tea-fabrika/runs/window";
import {ticket} from "@tea-fabrika/ticket";
import {TicketWindow} from "@tea-fabrika/ticket/window";
import {trace} from "@tea-fabrika/trace";
import {TraceWindow} from "@tea-fabrika/trace/window";
import {tracker} from "@tea-fabrika/tracker";
import {TrackerWindow} from "@tea-fabrika/tracker/window";
import type {ReactNode} from "react";
import {reader} from "../messages.ts";

// The windows the app knows, by program name: built into its bundle, for now
// (docs/direction/the-gui-is-electron-first.md). Each is drawn from its front's data only once
// that data reads by the program's own view schema; data that does not read is shown as refused,
// never handed to the window.

/** A program's window as the app holds it: its data read, then drawn, with the way to send. */
export interface Known {
	readonly draw: (data: unknown, send: (msg: unknown) => void) => ReactNode;
}

/** A program with a view, as `defineProgram` types one. */
type Windowed = AnyProgram & {readonly view: View<any, any>};

const known = <P extends Windowed>(
	program: P,
	Window: (props: WindowProps<P>) => ReactNode,
): readonly [string, Known] => {
	const read = reader(program.view.data);
	return [
		program.name,
		{
			draw: (data, send) => {
				const got = read(data);
				return got.kind === "read" ? (
					<Window view={got.msg} send={send} />
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
	known(runs, RunsWindow),
	known(trace, TraceWindow),
	known(markdown, MarkdownWindow),
]);
