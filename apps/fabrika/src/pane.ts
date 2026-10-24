import {defineMachine} from "@demlik/tea";
import type {Front, How, Line, PaneView} from "./messages.ts";

// One pane, as a tea machine: what it shows, folded from what it heard. The host steps it, the
// way an Elm parent steps a child; its model is its view, sent whole to the page on each change.
// It opens on tsh; a program tsh started that has a window goes over tsh until it ends.
//
//   typed    the person sent tsh a line: it is shown, and tsh is busy until that line is done
//   printed  tsh printed a line, on out or err
//   ready    tsh is done with a line, with how it ended (0 ended, 130 stopped, ...)
//   ended    tsh is gone; nothing typed after it is shown
//   drew     a run with a window has new view data: it goes over tsh, or stays where it is
//   left     that run ended: its window goes, and what was under it is back
//
//   replay(paneMachine, {ctx: {run: "tsh:p1"}, msgs: [
//     {type: "typed", text: "counter"},
//     {type: "drew", program: "counter", run: "counter:1", data: {n: 0}},
//     {type: "drew", program: "counter", run: "counter:1", data: {n: 1}},
//     {type: "left", run: "counter:1"},
//     {type: "printed", to: "out", text: "1"},
//     {type: "ready", status: 0},
//   ]}).state
//   // {tsh: {run: "tsh:p1", lines: [typed "counter", printed "1"], state: {kind: "ready", status: 0}}, front: []}

export type PaneMsg =
	| {readonly type: "typed"; readonly text: string}
	| {readonly type: "printed"; readonly to: "out" | "err"; readonly text: string}
	| {readonly type: "ready"; readonly status: number}
	| {readonly type: "ended"; readonly how: How}
	| ({readonly type: "drew"} & Front)
	| {readonly type: "left"; readonly run: string};

/** Lines a pane keeps, like a terminal's scrollback: past it, the oldest go. */
export const KEPT = 1000;

/** A fresh pane, on the tsh run `run`. */
export const fresh = (run: string): PaneView => ({
	tsh: {run, lines: [], state: {kind: "ready", status: null}},
	front: [],
});

const withLine = (lines: readonly Line[], line: Line): readonly Line[] =>
	lines.length < KEPT ? [...lines, line] : [...lines.slice(lines.length - KEPT + 1), line];

/** The fronts with this one's data: in its place when its run is there, else on top. */
const withFront = (front: readonly Front[], next: Front): readonly Front[] =>
	front.some((f) => f.run === next.run)
		? front.map((f) => (f.run === next.run ? next : f))
		: [...front, next];

const step = (s: PaneView): [PaneView, []] => [s, []];

export const paneMachine = defineMachine({
	types: {model: {} as PaneView, msg: {} as PaneMsg, ctx: {} as {readonly run: string}},
	cmds: [],
	init: (loaded, ctx) => [loaded ?? fresh(ctx.run), []],
	update: {
		typed: (s, m) => {
			const {tsh} = s;
			if (tsh.state.kind === "ended") return step(s);
			const waiting = tsh.state.kind === "busy" ? tsh.state.waiting + 1 : 1;
			const lines = withLine(tsh.lines, {kind: "typed", text: m.text});
			return step({...s, tsh: {...tsh, lines, state: {kind: "busy", waiting}}});
		},
		printed: (s, m) => {
			const lines = withLine(s.tsh.lines, {kind: "printed", to: m.to, text: m.text});
			return step({...s, tsh: {...s.tsh, lines}});
		},
		ready: (s, m) => {
			const {tsh} = s;
			if (tsh.state.kind === "ended") return step(s);
			if (tsh.state.kind === "busy" && tsh.state.waiting > 1)
				return step({...s, tsh: {...tsh, state: {kind: "busy", waiting: tsh.state.waiting - 1}}});
			return step({...s, tsh: {...tsh, state: {kind: "ready", status: m.status}}});
		},
		ended: (s, m) => step({...s, tsh: {...s.tsh, state: {kind: "ended", how: m.how}}}),
		drew: (s, m) =>
			step({...s, front: withFront(s.front, {program: m.program, run: m.run, data: m.data})}),
		left: (s, m) => step({...s, front: s.front.filter((f) => f.run !== m.run)}),
	},
});
