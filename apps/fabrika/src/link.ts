import {defineMachine, noop} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";
import {isPortName} from "./bridge.ts";
import {type Read, reader} from "./messages.ts";

// The link between the host and the app, as tmux's socket is between its server and a client:
// what goes over it, and the handshake that starts it. No platform here: the host's server
// (host/serve.ts) and the app's side (attach.ts) both run on it, and a test folds it by hand.
//
// The wire is NDJSON (JSON Lines): one JSON value a line, on a Unix socket file. Each side reads
// every line strictly with the other side's schema, and a line that does not read ends the link,
// as tmux drops a client that sends it a bad message.
//
//   app   {"type":"hello","version":1}
//   host  {"type":"hello","version":1}                      the same version: the link is up
//   app   {"type":"page"}                                    a page loaded: show it everything
//   host  {"type":"port","port":"tile:t1"}                   the page gets a fresh port of that name
//   host  {"type":"to","port":"tile:t1","m":{"type":"write","data":"tsh$ "}}
//   app   {"type":"on","port":"tile:t1","m":{"type":"keys","data":"l"}}
//   host  {"type":"gone","port":"tile:t1"}                   the tile closed
//
// The handshake is a tea machine, the same for both sides. The app greets first; the host greets
// back with its own version, always, so an app can say which version it met. Only an equal
// version is up. tmux does the same with its PROTOCOL_VERSION: a client of another version is
// told so and not attached.
//
//   [link] = init(null, {side: "app", ours: 1})        {at: "hello", side: "app", ours: 1}, greet {version: 1}
//   update(link, {type: "hello", version: 1})          {at: "up", ...}
//   update(link, {type: "line", m: {...}})             deliver {m}
//   update(link, {type: "hello", version: 0})          ... in hello: {at: "refused", theirs: 0}, refuse, drop
//   update(link, {type: "ended", why: "..."})          {at: "closed", why}
//
// The host's side answers a hello with its own (greet), right or wrong: an app of another version
// learns which one it met. A line before the hello, a second hello, or a line that does not read
// closes the link. Once refused or closed, nothing changes it.

/** The link's version. Raise it when what goes over the link changes. */
export const PROTOCOL = 1;

/** A port's name, as the page's bridge takes it (bridge.ts). */
const Port = Schema.String.check(
	Schema.makeFilter((name) => isPortName(name) || "not a port's name"),
);

const Hello = Schema.Struct({type: Schema.Literal("hello"), version: Schema.Int});

/** What the app tells the host. */
export const Up = Schema.Union([
	Hello,
	/** A page loaded, or loaded again: every port it had is dead, and it is to be shown everything. */
	Schema.Struct({type: Schema.Literal("page")}),
	/** The page went: the window closed. Nothing more is shown until the next `page`. */
	Schema.Struct({type: Schema.Literal("away")}),
	/** The page sent `m` on the port named `port`: for that tile, that run, or the desk alone. */
	Schema.Struct({type: Schema.Literal("on"), port: Port, m: Schema.Unknown}),
]);
export type Up = typeof Up.Type;

/** What the host tells the app. */
export const Down = Schema.Union([
	Hello,
	/** Give the page a fresh port of this name; one there already closes. */
	Schema.Struct({type: Schema.Literal("port"), port: Port}),
	/** Send `m` to the page on the port of this name. */
	Schema.Struct({type: Schema.Literal("to"), port: Port, m: Schema.Unknown}),
	/** The port of this name goes: its tile closed, or its run ended. */
	Schema.Struct({type: Schema.Literal("gone"), port: Port}),
	/** The last tile closed: the window closes, as closing the last tab does in Terminal. */
	Schema.Struct({type: Schema.Literal("close")}),
]);
export type Down = typeof Down.Type;

/** What the host reads off a line. */
export const readUp = reader(Up);
/** What the app reads off a line. */
export const readDown = reader(Down);

/** Who runs the link: the host, which answers, or the app, which greets first. */
export type Side = "host" | "app";

/** What the link is started with: its side, and the version it speaks. */
export interface LinkCtx {
	readonly side: Side;
	readonly ours: number;
}

/**
 * The link: waiting for the other side's hello, up, refused for another version, or closed. Each
 * keeps its side and the version it speaks, from `init`'s `LinkCtx`.
 */
export type Link = LinkCtx &
	(
		| {readonly at: "hello"}
		| {readonly at: "up"}
		| {readonly at: "refused"; readonly theirs: number}
		| {readonly at: "closed"; readonly why: string}
	);

export type LinkMsg =
	/** The other side's hello, with the version it speaks. */
	| {readonly type: "hello"; readonly version: number}
	/** Any other line of the other side, read by its schema already. */
	| {readonly type: "line"; readonly m: unknown}
	/** A line that did not read. */
	| {readonly type: "bad"; readonly why: string}
	/** The socket ended, from either side. */
	| {readonly type: "ended"; readonly why: string};

const Done = Schema.Null;

/** Say our hello, with the version we speak. */
export const greet = Cmd.define("greet", {
	input: Schema.Struct({version: Schema.Int}),
	ok: Done,
	err: [],
});
/** Hand the line on: to the host's clients, or to the app's relay. */
export const deliver = Cmd.define("deliver", {
	input: Schema.Struct({m: Schema.Unknown}),
	ok: Done,
	err: [],
});
/** The other side speaks another version: say so plainly. */
export const refuse = Cmd.define("refuse", {
	input: Schema.Struct({theirs: Schema.Int, ours: Schema.Int}),
	ok: Done,
	err: [],
});
/** Close the socket. */
export const drop = Cmd.define("drop", {
	input: Schema.Struct({why: Schema.String}),
	ok: Done,
	err: [],
});

export type LinkCmd =
	| ReturnType<typeof greet>
	| ReturnType<typeof deliver>
	| ReturnType<typeof refuse>
	| ReturnType<typeof drop>;

type Step = readonly [Link, readonly LinkCmd[]];

const ctxOf = (s: Link): LinkCtx => ({side: s.side, ours: s.ours});

const closed = (s: Link, why: string): Step => [{...ctxOf(s), at: "closed", why}, [drop({why})]];

/** Whatever comes once the link is refused or closed changes nothing, and says nothing. */
const over = (s: Link): boolean => s.at === "refused" || s.at === "closed";

export const linkMachine = defineMachine({
	types: {model: {} as Link, msg: {} as LinkMsg, ctx: {} as LinkCtx},
	cmds: [greet, deliver, refuse, drop],
	init: (_loaded, ctx) => [
		{...ctx, at: "hello"},
		ctx.side === "app" ? [greet({version: ctx.ours})] : [],
	],
	update: {
		hello: (s, m) => {
			if (over(s)) return [s, []];
			if (s.at === "up") return closed(s, "a second hello");
			const back = s.side === "host" ? [greet({version: s.ours})] : [];
			if (m.version === s.ours) return [{...ctxOf(s), at: "up"}, back];
			const why = `the other side speaks version ${m.version}, this one ${s.ours}`;
			return [
				{...ctxOf(s), at: "refused", theirs: m.version},
				[...back, refuse({theirs: m.version, ours: s.ours}), drop({why})],
			];
		},
		line: (s, m) => {
			if (over(s)) return [s, []];
			if (s.at === "hello") return closed(s, "a line before the hello");
			return [s, [deliver({m: m.m})]];
		},
		bad: (s, m) => (over(s) ? [s, []] : closed(s, `a line that does not read: ${m.why}`)),
		ended: (s, m) => (over(s) ? [s, []] : [{...ctxOf(s), at: "closed", why: m.why}, []]),
		greet_ok: noop,
		greet_err: noop,
		deliver_ok: noop,
		deliver_err: noop,
		refuse_ok: noop,
		refuse_err: noop,
		drop_ok: noop,
		drop_err: noop,
	},
});

/** A line off the wire, read already, as the link machine hears it: a hello, another line, or one that does not read. */
export const linkMsgOf = (got: Read<Up | Down>): LinkMsg => {
	if (got.kind === "refused") return {type: "bad", why: got.why};
	const msg = got.msg;
	if (msg.type === "hello") return {type: "hello", version: msg.version};
	return {type: "line", m: msg};
};
