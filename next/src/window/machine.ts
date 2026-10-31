import {Cmd, defineMachine, type Sub} from "@demlik/tea";
import {Option, Schema} from "effect";
import {applyPatch, PatchOp} from "../app/patch.ts";
import {DESK, type Desktop, DesktopSchema, tilesIn} from "../desktop/desk.ts";
import type {Size} from "../desktop/fold.ts";
import {type Link, type LinkMsg, linkTimer, startLink, stepLink} from "../transport/link.ts";
import {ask, type Message, readMessage} from "../transport/wire.ts";

// One window, one model (Elm): the pipe, the views it has been sent, what still waits to go out,
// and its own size. The window keeps no copy of the truth beyond a view at a revision (A3), and
// state changes wait in an outbox with ids until the brain answers (T7).
//
//   {type: "press", pid: "counter:1", m: {type: "plus"}}   into the outbox, out if online
//   the brain: view.patch {pid, rev: 42, patch, ledger}    the view moves, in every window
//   the brain: {id: "w-1-7", result}                       out of the outbox

/** A process's view as this window last heard it. */
export type Shown = {
	readonly rev: number;
	readonly data: unknown;
	/** The ledger's rev of the letter behind it. */
	readonly ledger: number;
};

/** A window's Msg on its way to a process. Saved once in the ledger, by its id. */
export type Letter = {
	readonly id: string;
	readonly pid: string;
	readonly m: Readonly<Record<string, unknown>> & {readonly type: string};
	readonly said: string;
};

export type Model = {
	readonly peer: string;
	readonly link: Link;
	readonly views: Readonly<Record<string, Shown>>;
	/** The pids this dial has asked to watch. */
	readonly opened: readonly string[];
	readonly outbox: readonly Letter[];
	/** How many letters this window has written: the id's number. */
	readonly written: number;
	/** The last reason the brain refused a letter. */
	readonly refused: string | null;
	readonly size: Size;
};

export type Msg =
	| LinkMsg
	| {readonly type: "frame"; readonly text: string}
	| {
			readonly type: "press";
			readonly pid: string;
			readonly m: {readonly type: string} & Readonly<Record<string, unknown>>;
			readonly said: string;
	  }
	| {readonly type: "resized"; readonly size: Size};

type SendText = Cmd<"send_text"> & {readonly text: string};
const sendText = (text: string): SendText => ({type: "send_text", text});

type SocketSub = Sub<"socket", {readonly dial: number}>;
type SizeSub = Sub<"size", {readonly on: true}>;
export type WindowSub = SocketSub | SizeSub;

const Whole = Schema.Struct({
	pid: Schema.String,
	rev: Schema.Int,
	whole: Schema.Unknown,
	ledger: Schema.Int,
});
const Patched = Schema.Struct({
	pid: Schema.String,
	rev: Schema.Int,
	patch: Schema.Array(PatchOp),
	ledger: Schema.Int,
});

const openText = (pid: string): string => ask(`open:${pid}`, "view.open", {pid});

const letterText = (letter: Letter): string =>
	ask(letter.id, "window.msg", {
		pid: letter.pid,
		id: letter.id,
		m: letter.m,
		said: letter.said,
	});

const online = (model: Model): boolean => model.link.is === "online";

/** The desk as this window has it, if it has it yet. */
export const deskIn = (model: Model): Option.Option<Desktop> => {
	const shown = model.views[DESK];
	return shown === undefined
		? Option.none()
		: Schema.decodeUnknownOption(DesktopSchema)(shown.data);
};

/** A view moved; if it is the desk, watch whatever its tiles show that this dial has not asked for. */
const openShown = (model: Model): readonly [Model, readonly SendText[]] => {
	const desk = deskIn(model);
	if (Option.isNone(desk)) return [model, []];
	const shown = desk.value.workspaces.flatMap((w) => tilesIn(w.layout).map((t) => t.shows));
	const fresh = [...new Set(shown)].filter((pid) => !model.opened.includes(pid));
	return [
		{...model, opened: [...model.opened, ...fresh]},
		fresh.map((pid) => sendText(openText(pid))),
	];
};

const readWhole = (model: Model, params: unknown): readonly [Model, readonly SendText[]] => {
	const whole = Schema.decodeUnknownOption(Whole)(params);
	if (Option.isNone(whole)) return [model, []];
	const {pid, rev, ledger} = whole.value;
	return openShown({
		...model,
		views: {...model.views, [pid]: {rev, data: whole.value.whole, ledger}},
	});
};

const readPatch = (model: Model, params: unknown): readonly [Model, readonly SendText[]] => {
	const patched = Schema.decodeUnknownOption(Patched)(params);
	if (Option.isNone(patched)) return [model, []];
	const {pid, rev, patch, ledger} = patched.value;
	const shown = model.views[pid];
	// A patch it already has, from before its whole copy, does nothing.
	if (shown !== undefined && rev <= shown.rev) return [model, []];
	// A gap: something was missed, so ask for a whole copy again.
	if (shown === undefined || rev !== shown.rev + 1) return [model, [sendText(openText(pid))]];
	return openShown({
		...model,
		views: {...model.views, [pid]: {rev, data: applyPatch(shown.data, patch), ledger}},
	});
};

const readMsg = (model: Model, message: Message): readonly [Model, readonly SendText[]] => {
	switch (message.is) {
		case "news":
			if (message.method === "view.whole") return readWhole(model, message.params);
			if (message.method === "view.patch") return readPatch(model, message.params);
			return [model, []];
		case "ok":
			return [{...model, outbox: model.outbox.filter((l) => l.id !== message.id)}, []];
		case "err":
			return [
				{
					...model,
					outbox: model.outbox.filter((l) => l.id !== message.id),
					refused: message.why,
				},
				[],
			];
		case "ask":
			return [model, []];
	}
};

/** Step the link child by hand. Coming online: watch the desk again and send what waited (T7). */
const stepWithLink = (model: Model, msg: LinkMsg): readonly [Model, readonly SendText[]] => {
	const stepped = stepLink(model.link, msg);
	const sends = stepped.send.map(sendText);
	if (!stepped.online) return [{...model, link: stepped.link}, sends];
	return [
		{...model, link: stepped.link, opened: [DESK]},
		[...sends, sendText(openText(DESK)), ...model.outbox.map((l) => sendText(letterText(l)))],
	];
};

/** A window's first model. `seed` feeds the backoff's jitter. */
export const startWindow = (input: {
	readonly peer: string;
	readonly ping: string;
	readonly seed: number;
	readonly size: Size;
}): Model => ({
	peer: input.peer,
	link: startLink(input.ping, input.seed),
	views: {},
	opened: [],
	outbox: [],
	written: 0,
	refused: null,
	size: input.size,
});

/** Every Msg a window sends a process carries the revision it saw (A3). */
const withSaw = (model: Model, pid: string, m: Letter["m"]): Letter["m"] => ({
	...m,
	saw: model.views[pid]?.rev ?? 0,
});

export const windowMachine = (start: Model) =>
	defineMachine({
		types: {
			model: {} as Model,
			msg: {} as Msg,
			cmd: {} as SendText,
			sub: {} as WindowSub,
			ctx: undefined,
		},
		init: (loaded) => [loaded ?? start, Cmd.none],
		subs: [
			{type: "socket", deps: (model: Model) => ({dial: model.link.dial})},
			{type: "size", deps: () => ({on: true as const})},
			{type: "timer", deps: (model: Model) => linkTimer(model.link)},
		],
		update: {
			opened: (model, msg) => stepWithLink(model, msg),
			closed: (model, msg) => stepWithLink(model, msg),
			welcome: (model, msg) => stepWithLink(model, msg),
			pong: (model, msg) => stepWithLink(model, msg),
			ping_due: (model, msg) => stepWithLink(model, msg),
			pong_late: (model, msg) => stepWithLink(model, msg),
			dial_late: (model, msg) => stepWithLink(model, msg),
			retry: (model, msg) => stepWithLink(model, msg),
			frame: (model, msg) => {
				if (msg.text === "pong") return stepWithLink(model, {type: "pong"});
				const message = readMessage(msg.text);
				if (Option.isNone(message)) return [model, Cmd.none];
				if (message.value.is === "ok" && message.value.id === "hello") {
					return stepWithLink(model, {type: "welcome", result: message.value.result});
				}
				return readMsg(model, message.value);
			},
			press: (model, msg) => {
				const letter: Letter = {
					id: `${model.peer}-${model.written + 1}`,
					pid: msg.pid,
					m: withSaw(model, msg.pid, msg.m),
					said: msg.said,
				};
				return [
					{...model, written: model.written + 1, outbox: [...model.outbox, letter]},
					online(model) ? [sendText(letterText(letter))] : Cmd.none,
				];
			},
			resized: (model, msg) => [{...model, size: msg.size}, Cmd.none],
		},
	});
