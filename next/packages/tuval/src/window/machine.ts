// The window's parent machine, next/ (Tier 1, P14; laws p1, p2, p4 and `now`). Elm first: it holds
// the link (libfabrika's link machine) and the program client (libfabrika's client rules) and steps
// both by hand. It owns what is this window's own: which pids it opened on this dial, which letters
// are out, the focused tile and the key prefix. It reads no clock: a press reserves its slot here,
// and its time and letter id come back from the `now` Cmd.
//
// Going online opens every distinct pid of the fixed layout once and sends every ready letter ahead
// of the first one still waiting for its time, in slot order. Leaving online forgets both, so the
// next dial starts over and a letter keeps its id across dials.
import {applyCell, type Sub} from "@demlik/tea";
import {Cmd, Machine} from "@demlik/tea/effect";
import {Keys, ProgramClient, type Rows, Sent} from "@kampus/libfabrika";
import {
	knock,
	Link,
	linkMachine,
	LinkMsg,
	ping,
	socketDial,
	timerDeps,
} from "@kampus/libfabrika/transport";
import {Schema} from "effect";
import {routeKey} from "../desktop/keys.ts";
import {type Layout, tilesIn} from "../desktop/layout.ts";

const C = ProgramClient;
/** How long a letter the brain did not take, or a time that failed, waits to be tried again. */
const RETRY = 2_000;

/** What the window is told from outside the model: the fixed layout and its programs' keys. */
export type WindowCtx = {
	readonly layout: Layout;
	/** The default key rows of the layout's programs, and the commands a tile's pid takes. */
	readonly keys?: {
		readonly defaults: Rows;
		readonly commands: (pid: string) => ReadonlyArray<string>;
	};
};

/** How the window checks what it installs: a tile's view decoder, the registration's own schema
 *  for the program behind `pid`. A step reads no ctx, so the machine closes over it. */
export type WindowChecks = {readonly decode?: (pid: string) => (view: unknown) => unknown};

const Table = Schema.Struct({
	rows: Schema.Record(Schema.String, Schema.Array(Schema.String)),
	file: Schema.Array(Schema.String),
});

const Rows = Schema.Record(Schema.String, Schema.Array(Schema.String));

export const WindowModel = Schema.Struct({
	/** The fixed layout's tiles, `{id, pid}` in reading order, read from the ctx at init. */
	tiles: Schema.Array(Schema.Struct({id: Schema.String, pid: Schema.String})),
	/** The programs' default key rows, and the commands each pid's program takes. */
	defaults: Rows,
	commands: Schema.Record(Schema.String, Schema.Array(Schema.String)),
	link: Link,
	/** The highest dial this window has made, so Ask again dials past every old socket. */
	dials: Schema.Int,
	/** This tab's own measured tile area, which only its fold reads. */
	size: Schema.NullOr(Schema.Struct({w: Schema.Number, h: Schema.Number})),
	client: C.Client,
	/** The pids opened on this dial. */
	opened: Schema.Array(Schema.String),
	/** The letters out on this dial with no answer yet. */
	sent: Schema.Array(Schema.String),
	/** A grant was just given: persistence is asked once, when the link next goes online. */
	fresh: Schema.Boolean,
	/** Slots whose time could not be read, asked again by the retry timer. */
	redate: Schema.Array(Schema.Int),
	/** The key fingerprint the door removed, which the next dial replaces. */
	rejected: Schema.NullOr(Schema.String),
	focus: Schema.NullOr(Schema.String),
	keys: Table,
	armed: Schema.NullOr(Schema.Struct({chords: Schema.Array(Schema.String)})),
	keyError: Schema.NullOr(Keys.KeyProblem),
	/** A plain word for the last answer the window could not use, shown once in the frame. */
	trouble: Schema.NullOr(Schema.String),
});
export type WindowModel = typeof WindowModel.Type;

const KeyInput = Schema.Struct({
	key: Schema.String,
	shift: Schema.Boolean,
	ctrl: Schema.Boolean,
	alt: Schema.Boolean,
	meta: Schema.Boolean,
	composing: Schema.Boolean,
	editable: Schema.Boolean,
});

const Own = Schema.Union([
	/** A person pressed an action on a tile: `m` is one of its program's Msgs. */
	Schema.Struct({
		type: Schema.Literal("press"),
		pid: Schema.String,
		m: Schema.Json,
		via: Schema.optionalKey(Schema.Literals(["button", "key"])),
	}),
	/** A view notification for `pid`, as the socket received it. */
	Schema.Struct({type: Schema.Literal("view"), pid: Schema.String, note: Schema.Unknown}),
	/** The retry timer: ask failed times again, and send what the brain did not take. */
	Schema.Struct({type: Schema.Literal("resend"), dial: Schema.Int}),
	Schema.Struct({type: Schema.Literal("focus"), tile: Schema.NullOr(Schema.String)}),
	/** The tab's tile area was measured again. */
	Schema.Struct({type: Schema.Literal("resized"), w: Schema.Number, h: Schema.Number}),
	Schema.Struct({type: Schema.Literal("key"), event: KeyInput}),
	/** A good key table from the person's settings, or the reason the last edit was not used. */
	Schema.Struct({
		type: Schema.Literal("keys"),
		rows: Schema.Record(Schema.String, Schema.Array(Schema.String)),
	}),
	Schema.Struct({type: Schema.Literal("keys_failed"), error: Keys.KeyProblem}),
	/** The highest ledger revision the client has read. */
	Schema.Struct({type: Schema.Literal("seen"), rev: Schema.Int}),
]);

/** A press's time and letter id, from Effect's Clock and the library's id generator. */
export const now = Cmd.make("now", {
	input: Schema.Struct({n: Schema.Int}),
	ok: Schema.Struct({
		letter: Schema.String,
		sentAt: Schema.String,
		traceId: Schema.optionalKey(Schema.String),
	}),
	err: ["clock", "entropy"],
});

/** `process.send` for one ready letter, with the same id and body every time. */
export const send = Cmd.make("send", {
	input: Schema.Struct({
		pid: Schema.String,
		letter: Schema.String,
		n: Schema.Int,
		m: Schema.Json,
		sentAt: Schema.String,
		seen: Schema.Int,
		traceId: Schema.optionalKey(Schema.String),
		dial: Schema.Int,
	}),
	ok: Sent,
	err: ["unreachable", "unknown"],
});

/** `view.open` for one pid on one dial. */
export const open = Cmd.make("open", {
	input: Schema.Struct({pid: Schema.String, dial: Schema.Int}),
	ok: Schema.Struct({rev: Schema.Int, view: Schema.Json}),
	err: ["unreachable", "unknown"],
});

/** Ask the browser to keep this origin's storage, once per new grant. */
export const persist = Cmd.make("persist", {
	input: Schema.Struct({}),
	ok: Schema.Boolean,
	err: ["unsupported", "failed"],
});

type Out = ReadonlyArray<
	| ReturnType<typeof now>
	| ReturnType<typeof send>
	| ReturnType<typeof open>
	| ReturnType<typeof persist>
	| ReturnType<typeof ping>
	| ReturnType<typeof knock>
>;

type Step = readonly [WindowModel, Out];

const anyView = (view: unknown): unknown => view;

/** The letters that may go now and are not out yet, as `send` Cmds for this dial. */
const sends = (s: WindowModel, dial: number): ReadonlyArray<ReturnType<typeof send>> =>
	C.sendable(s.client)
		.filter((p) => !s.sent.includes(p.letter))
		.map((p) =>
			send({
				pid: p.pid,
				letter: p.letter,
				n: p.n,
				m: p.m,
				sentAt: p.sentAt,
				seen: p.seen,
				dial,
				...(p.traceId === undefined ? {} : {traceId: p.traceId}),
			}),
		);

/** Sends what may go now when online, marking it out. */
const flush = (s: WindowModel): Step => {
	if (s.link._tag !== "online") {return [s, []];}

	const out = sends(s, s.link.dial);
	return out.length === 0 ? [s, []] : [{...s, sent: [...s.sent, ...out.map((c) => c.letter)]}, out];
};

/** A press: reserve its slot with what was shown, and ask its time. */
const pressed = (s: WindowModel, pid: string, m: unknown): Step => {
	const client = C.press(s.client, {pid, m});
	return [{...s, client}, [now({n: s.client.written})]];
};

/** Steps the link by hand, then does what its move means for this window. */
const linked = (s: WindowModel, m: LinkMsg): Step => {
	const [link, linkCmds] = applyCell<
		Link,
		LinkMsg,
		ReturnType<typeof ping> | ReturnType<typeof knock>
	>(linkMachine, s.link, m);
	const granted = m.type === "granted" && s.link._tag === "waiting_grant" && s.link.dial === m.dial;
	const next: WindowModel = {
		...s,
		link,
		dials: Math.max(s.dials, socketDial(link) ?? 0),
		fresh: s.fresh || granted,
		rejected: link._tag === "removed" ? link.fingerprint : s.rejected,
	};

	if (link._tag !== "online") {return [{...next, opened: [], sent: []}, linkCmds];}

	if (s.link._tag === "online") {return [next, linkCmds];}

	// Going online: open each distinct pid once, send what waited in order, ask persistence once.
	const pids = [...new Set(s.tiles.map((t) => t.pid))];
	const opens = pids.map((pid) => open({pid, dial: link.dial}));
	const out = sends({...next, sent: []}, link.dial);
	const asked = next.fresh ? [persist({})] : [];
	return [
		{...next, opened: pids, sent: out.map((c) => c.letter), fresh: false, trouble: null},
		[...linkCmds, ...opens, ...out, ...asked],
	];
};

const findTile = (s: WindowModel, id: string | null) =>
	id === null ? null : (s.tiles.find((t) => t.id === id) ?? null);

const linkUpdate = Object.fromEntries(
	[
		"admitted",
		"not_granted",
		"granted",
		"closed",
		"retry",
		"beat",
		"pong",
		"stalled",
		"renew",
		"blocked",
		"ask_again",
	].map((type) => [type, (s: WindowModel, m: LinkMsg) => linked(s, m)]),
) as {
	readonly [K in LinkMsg["type"]]: (
		s: WindowModel,
		m: Extract<LinkMsg, {readonly type: K}>,
	) => Step;
};

const fresh = (ctx: WindowCtx | undefined): WindowModel => {
	const tiles = ctx === undefined ? [] : tilesIn(ctx.layout);
	const defaults = ctx?.keys?.defaults ?? {};
	return WindowModel.make({
		tiles: tiles.map((t) => ({id: t.id, pid: t.pid})),
		defaults,
		commands: Object.fromEntries(
			tiles.map((t) => [t.pid, [...(ctx?.keys?.commands(t.pid) ?? [])]]),
		),
		link: linkMachine.init(null, {})[0],
		dials: 1,
		size: null,
		client: C.emptyClient,
		opened: [],
		sent: [],
		fresh: false,
		redate: [],
		rejected: null,
		focus: null,
		keys: Keys.buildTable(defaults, {}),
		armed: null,
		keyError: null,
		trouble: null,
	});
};

/** The socket for one dial; a replaced key is named so the next dial makes its successor. */
type SocketSub = Sub<"socket", {readonly dial: number; readonly rejected: string | null}>;

/** The window machine, checking each view with `checks`. */
export const windowMachineFor = (checks: WindowChecks) => {
	const decoderFor = (pid: string) => checks.decode?.(pid) ?? anyView;
	return Machine.make({
		model: WindowModel,
		msg: Schema.Union([LinkMsg, Own]),
		cmds: [now, send, open, persist, ping, knock],
		types: {sub: {} as SocketSub, ctx: {} as WindowCtx},
		init: (loaded, ctx) => [loaded ?? fresh(ctx), []],
		update: {
			...linkUpdate,
			press: (s, m) => pressed(s, m.pid, m.m),
			now_ok: (s, m) => {
				const client = C.dated(s.client, m.cmd.n, m.value);
				return flush({...s, client, redate: s.redate.filter((n) => n !== m.cmd.n)});
			},
			now_err: (s, m) =>
				s.client.pending.some((p) => p.n === m.cmd.n && p._tag === "dating") &&
				!s.redate.includes(m.cmd.n)
					? [{...s, redate: [...s.redate, m.cmd.n]}, []]
					: [s, []],
			send_ok: (s, m) => {
				const client = C.reply(s.client, m.cmd.letter, m.value);
				return [
					{
						...s,
						client,
						sent: s.sent.filter((l) => l !== m.cmd.letter),
						trouble: m.value._tag === "refused" ? m.value.why : s.trouble,
					},
					[],
				];
			},
			// A transport failure frees the letter for the retry timer. An answer the client cannot read
			// keeps it out on this dial, so it is not sent again until the next one, and says so.
			send_err: (s, m) =>
				m.error._tag === "unreachable"
					? [{...s, sent: s.sent.filter((l) => l !== m.cmd.letter)}, []]
					: [{...s, trouble: "unknown_reply"}, []],
			open_ok: (s, m) => {
				if (s.link._tag !== "online" || s.link.dial !== m.cmd.dial) {return [s, []];}

				const shown = C.notice(
					s.client,
					m.cmd.pid,
					{type: "whole", rev: m.value.rev, view: m.value.view},
					decoderFor(m.cmd.pid),
				);
				return [{...s, client: shown.client, trouble: shown.ask ? "bad_view" : s.trouble}, []];
			},
			open_err: (s) => [{...s, trouble: "no_view"}, []],
			persist_ok: (s) => [s, []],
			// A ping or knock that could not go is the link's to notice: its timers move it on.
			ping_ok: (s) => [s, []],
			ping_err: (s) => [s, []],
			knock_ok: (s) => [s, []],
			knock_err: (s) => [s, []],
			persist_err: (s) => [s, []],
			view: (s, m) => {
				const shown = C.notice(s.client, m.pid, m.note, decoderFor(m.pid));
				const next = {...s, client: shown.client};
				return shown.ask && s.link._tag === "online" && s.opened.includes(m.pid)
					? [next, [open({pid: m.pid, dial: s.link.dial})]]
					: [next, []];
			},
			resend: (s, m) => {
				const redated = s.redate.flatMap((n) =>
					s.client.pending.some((p) => p.n === n && p._tag === "dating") ? [now({n})] : [],
				);
				const cleared = {...s, redate: []};

				if (s.link._tag !== "online" || s.link.dial !== m.dial) {return [cleared, redated];}

				const [after, out] = flush(cleared);
				return [after, [...redated, ...out]];
			},
			resized: (s, m) =>
				s.size?.w === m.w && s.size.h === m.h ? [s, []] : [{...s, size: {w: m.w, h: m.h}}, []],
			focus: (s, m) => [
				{...s, focus: findTile(s, m.tile) === null ? null : m.tile, armed: null},
				[],
			],
			key: (s, m) => {
				const tile = findTile(s, s.focus);
				const routed = routeKey({
					table: s.keys,
					armed: s.armed,
					event: m.event,
					tile,
					commands: tile === null ? [] : (s.commands[tile.pid] ?? []),
				});
				const next = {...s, armed: routed.armed};
				return routed.press === null ? [next, []] : pressed(next, routed.press.pid, routed.press.m);
			},
			keys: (s, m) => [
				{
					...s,
					keys: Keys.buildTable(s.defaults, m.rows),
					armed: null,
					keyError: null,
				},
				[],
			],
			keys_failed: (s, m) => [{...s, keyError: m.error, armed: null}, []],
			seen: (s, m) => [{...s, client: C.read(s.client, m.rev)}, []],
		},
		subs: [
			{type: "timer", deps: (s) => timerDeps(s.link)},
			{
				type: "timer",
				deps: (s) => {
					const dial = socketDial(s.link) ?? 0;
					const waiting =
						s.redate.length > 0 || (s.link._tag === "online" && sends(s, s.link.dial).length > 0);
					return waiting ? {ms: RETRY, msg: {type: "resend" as const, dial}} : null;
				},
			},
			{
				type: "socket",
				deps: (s) => {
					const dial = socketDial(s.link);
					return dial === null ? null : {dial, rejected: s.rejected};
				},
			},
		],
	});
};

/** The window machine with no view check of its own: any JSON view a tile is sent. */
export const windowMachine = windowMachineFor({});

/** Every Msg the window folds: its own and the link's, and the answers tea mints for its Cmds. */
export type WindowMsg =
	typeof windowMachine extends Machine<WindowModel, infer M, infer _C, infer _U, infer _X>
		? M
		: never;
