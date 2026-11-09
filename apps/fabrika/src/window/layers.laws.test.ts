import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {titleOf} from "@kampus/pipeline/tickets/ticket";
// Today's app, T204 PR 1. The new step returns data; clocks, IDs and writes stay in adapters.
import * as fc from "fast-check";
import {afterAll, assert, describe, expect, it, vi} from "vitest";
import type {Down} from "../link.ts";
import {readFromPage, type ToPage} from "../messages.ts";
import * as frameModule from "./frame.ts";
import {FRAME, type Frame, type FrameMsg, frameUpdate} from "./frame.ts";

// Only Electron, the socket and the OS theme are replaced. The notification's real click
// callback in main.ts must produce the message that stepFrame records.
const notifications = vi.hoisted(() => ({
	home: "",
	deliver: null as ((message: Down) => void) | null,
	hello: () => {},
	quit: () => {},
	clicks: [] as (() => void)[],
	posted: [] as ToPage[],
}));
vi.mock("electron", async () => {
	const {EventEmitter} = await import("node:events");
	const app = Object.assign(new EventEmitter(), {
		getPath: () => notifications.home,
		setPath: () => {},
		setBadgeCount: () => {},
		whenReady: async () => {},
		requestSingleInstanceLock: () => true,
		quit: () => {},
		exit: () => {},
	});
	const ipcMain = new EventEmitter();
	class BrowserWindow extends EventEmitter {
		webContents = {getURL: () => "fabrika://app/desk.html", postMessage: () => {}};
		loadURL = async () => {};
		isFocused = () => false;
		isDestroyed = () => false;
		isMinimized = () => false;
		focus = () => {};
		constructor() {
			super();
			notifications.hello = () =>
				ipcMain.emit("fabrika:port", {
					sender: this.webContents,
					senderFrame: {parent: null, url: "fabrika://app/desk.html"},
				});
		}
	}
	class Notification extends EventEmitter {
		static isSupported = () => true;
		show = () => notifications.clicks.push(() => this.emit("click"));
	}
	class Port extends EventEmitter {
		start = () => {};
		close = () => {};
		postMessage = (message: ToPage) => notifications.posted.push(message);
	}
	notifications.quit = () => app.emit("before-quit", {preventDefault: () => {}});
	return {
		app,
		ipcMain,
		BrowserWindow,
		Notification,
		MessageChannelMain: class {
			port1 = new Port();
			port2 = new Port();
		},
		protocol: {registerSchemesAsPrivileged: () => {}, handle: () => {}},
		session: {
			defaultSession: {setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {}},
		},
		nativeTheme: {},
		shell: {},
	};
});
vi.mock("../launch.ts", () => ({launchOf: () => ({kind: "owner"}), QUIET_SWITCHES: []}));
vi.mock("@kampus/fabrika-design", () => ({frameColor: () => "#000000", followLook: () => {}}));
vi.mock("../attach.ts", async (original) => {
	const {Effect} = await import("effect");
	return {
		...(await original<typeof import("../attach.ts")>()),
		attach: ({deliver}: {deliver: (message: Down) => void}) =>
			Effect.sync(() => {
				notifications.deliver = deliver;
				return {found: {kind: "up"}, wire: {send: () => {}, ended: Effect.never}};
			}),
	};
});
afterAll(() => {
	notifications.quit();
	if (notifications.home) rmSync(notifications.home, {recursive: true, force: true});
});

type Layer = {_tag: "palette"} | {_tag: "popover"; item: string} | {_tag: "tooltip"; for: string};
type Via =
	| {_tag: "key"; keys: string}
	| {_tag: "click"}
	| {_tag: "pointer"}
	| {_tag: "focus"}
	| {_tag: "word"}
	| {_tag: "palette"};
type Reason =
	| "escape"
	| "outside"
	| "done"
	| "owner_gone"
	| "toggle"
	| "replacement"
	| "navigation";
type Change =
	| {_tag: "open"; layer: Layer; via: Via | null}
	| {_tag: "close"; layer: Layer; reason: Reason};
type Message = FrameMsg & {readonly via?: Via; readonly reason?: Reason};
type FrameStep = (frame: Frame, msg: Message) => readonly [Frame, readonly Change[]];
// Keep missing PR 1 behavior red at runtime without importing a nonexistent export.
const frameApi: typeof frameModule & {readonly stepFrame?: FrameStep} = frameModule;
const step: FrameStep = (frame, msg) => {
	const run = frameApi.stepFrame;
	assert(run !== undefined, "PR 1 must add the real stepFrame transition function");
	return run(frame, msg);
};
const options = {seed: 119120, numRuns: 100};
const via: fc.Arbitrary<Via> = fc.oneof(
	fc.constantFrom(
		{_tag: "click"} as const,
		{_tag: "pointer"} as const,
		{_tag: "focus"} as const,
		{_tag: "word"} as const,
		{_tag: "palette"} as const,
	),
	fc.constantFrom("ctrl+b a", "cmd+k", "ctrl+a J").map((keys) => ({_tag: "key" as const, keys})),
);
const reason = fc.constantFrom<Reason>(
	"escape",
	"outside",
	"done",
	"owner_gone",
	"toggle",
	"replacement",
	"navigation",
);
const message: fc.Arbitrary<Message> = fc.oneof(
	fc.record({type: fc.constant("palette" as const), via}),
	fc.record({
		type: fc.constant("show" as const),
		what: fc.constantFrom("asks" as const, "jobs" as const, "keys" as const, "palette" as const),
		via,
	}),
	fc.record({
		type: fc.constant("item" as const),
		what: fc.constantFrom("host" as const, "agents" as const, "sync" as const),
		via,
	}),
	fc.record({type: fc.constant("query" as const), query: fc.string()}),
	fc.record({
		type: fc.constant("move" as const),
		by: fc.integer({min: -1, max: 1}),
		of: fc.nat({max: 20}),
	}),
	fc.record({type: fc.constant("close" as const), reason}),
	fc.record({
		type: fc.constant("escape" as const),
		desk: fc.record({armed: fc.boolean(), asking: fc.boolean()}),
	}),
	fc.record({type: fc.constant("ran" as const), key: fc.constantFrom("C-b z", "C-b a")}),
);
const identity = (frame: Frame): string | null => {
	const over = frame.over;
	switch (over.kind) {
		case "none":
			return null;
		case "palette":
			return `palette/${over.title}`;
		case "item":
			return `popover/${over.what}`;
		default:
			return `popover/${over.kind}`;
	}
};
const layer = (frame: Frame): Layer | null => {
	const over = frame.over;
	return over.kind === "none"
		? null
		: over.kind === "palette"
			? {_tag: "palette"}
			: {_tag: "popover", item: over.kind === "item" ? over.what : over.kind};
};
const expected = (before: Frame, after: Frame, msg: Message): readonly Change[] => {
	if (identity(before) === identity(after)) return [];
	const old = layer(before);
	const next = layer(after);
	const why: Reason =
		next !== null
			? "replacement"
			: msg.type === "escape"
				? "escape"
				: msg.type === "ran" || msg.type === "say"
					? "done"
					: msg.type === "close"
						? (msg.reason ?? "outside")
						: "toggle";
	return [
		...(old === null ? [] : [{_tag: "close" as const, layer: old, reason: why}]),
		...(next === null ? [] : [{_tag: "open" as const, layer: next, via: msg.via ?? null}]),
	];
};
const checkTransitions = (run: typeof step, moves: readonly Message[]) => {
	expect(typeof run, "PR 1 must add the real stepFrame transition function").toBe("function");
	let frame = FRAME;
	for (const msg of moves) {
		const [next, changes] = run(frame, msg);
		expect(next).toEqual(frameUpdate(frame, msg));
		expect(changes).toEqual(expected(frame, next, msg));
		frame = next;
	}
};

describe("today's layer lifecycle", () => {
	// Plant: omit via in main.ts's actual Notification click callback, as review 2 found.
	it("a real system-notification click records its known opening source", async () => {
		notifications.home = mkdtempSync(join(tmpdir(), "fh."));
		await import("../main.ts");
		await vi.waitFor(() => expect(notifications.deliver).not.toBeNull());
		notifications.hello();
		fc.assert(
			fc.property(
				fc.integer({min: 1, max: 100000}),
				fc.string({maxLength: 50}).map(titleOf),
				(ticket, title) => {
					const deliver = notifications.deliver;
					assert(deliver !== null);
					const now = {asks: [], later: [], reach: "ok", why: null} as const;
					deliver({type: "to", port: "desk", m: {type: "asks", now}});
					notifications.clicks.length = notifications.posted.length = 0;
					deliver({
						type: "to",
						port: "desk",
						m: {
							type: "asks",
							now: {
								...now,
								asks: [
									{
										key: `${ticket}/fixture`,
										ticket,
										title,
										what: "approve plan",
										kind: "ask",
										at: 0,
										seen: false,
									},
								],
							},
						},
					});
					expect(notifications.clicks).toHaveLength(1);
					notifications.clicks[0]!();
					const shown = notifications.posted.findLast((message) => message.type === "show");
					assert(
						shown?.type === "show" && shown.what === "asks",
						"notification click must reach the page",
					);
					const [, changes] = step(FRAME, {
						type: "show",
						what: shown.what,
						...(shown.via === undefined ? {} : {via: shown.via}),
					});
					expect(changes).toContainEqual(
						expect.objectContaining({
							_tag: "open",
							layer: {_tag: "popover", item: "asks"},
							via: {_tag: "click"},
						}),
					);
				},
			),
			options,
		);
	});
	it("records replacement close before open, toggle once, and no record for unchanged state", () => {
		fc.assert(
			fc.property(fc.array(message, {minLength: 1, maxLength: 70}), (moves) => {
				checkTransitions(step, moves);
			}),
			options,
		);
	});
	it("query edits, row movement and repeated show do not open a second instance", () => {
		fc.assert(
			fc.property(fc.array(fc.string(), {minLength: 1, maxLength: 20}), via, (queries, source) => {
				checkTransitions(step, [
					{type: "show", what: "palette", via: source},
					...queries.flatMap((query): Message[] => [
						{type: "query", query},
						{type: "move", by: 1, of: 7},
						{type: "show", what: "palette", via: source},
					]),
					{type: "close", reason: "outside"},
					{type: "close", reason: "outside"},
				]);
			}),
			options,
		);
	});
	it("each supplied dismissal reason survives, and replacement never resurrects asks", () => {
		fc.assert(
			fc.property(reason, via, (why, source) => {
				checkTransitions(step, [
					{type: "show", what: "asks", via: source},
					{type: "palette", via: source},
					{type: "close", reason: why},
				]);
				const [asks] = step(FRAME, {type: "show", what: "asks"});
				const [palette] = step(asks, {type: "palette"});
				const [closed] = step(palette, {type: "escape", desk: {armed: false, asking: false}});
				expect(closed.over).toEqual({kind: "none"});
			}),
			options,
		);
	});
	it("the transition law rejects the plant that records a query edit as another opening", () => {
		fc.assert(
			fc.property(fc.string(), (query) => {
				const plant: typeof step = (frame, msg) => {
					const next = frameUpdate(frame, msg);
					const changes = expected(frame, next, msg);
					return [
						next,
						msg.type === "query"
							? [...changes, {_tag: "open", layer: {_tag: "palette"}, via: null}]
							: changes,
					];
				};
				expect(() =>
					checkTransitions(plant, [{type: "palette"}, {type: "query", query}]),
				).toThrow();
			}),
			options,
		);
	});
	it("[secrets] generated typed content never enters outgoing lifecycle reports", () => {
		fc.assert(
			fc.property(
				fc.record({
					query: fc.uuid(),
					note: fc.uuid(),
					terminal: fc.uuid(),
					moves: fc.array(message, {minLength: 1, maxLength: 30}),
				}),
				({query, note, terminal, moves}) => {
					let frame = FRAME;
					const outgoing: unknown[] = [];
					for (const [at, msg] of [
						...moves,
						{type: "palette"} as const,
						{type: "query", query: `made-up-query/${query}`} as const,
						{type: "say", note: `made-up-note/${note}`} as const,
						{type: "explain", text: `made-up-terminal/${terminal}`} as const,
					].entries()) {
						const [next, changes] = step(frame, msg);
						for (const [n, change] of changes.entries()) {
							const report = {
								type: "layer",
								id: `event-${at}-${n}`,
								instance: "instance-1",
								change,
								said: at,
							};
							expect(readFromPage(report)).toEqual({kind: "read", msg: report});
							outgoing.push(report);
						}
						frame = next;
					}
					const check = (value: unknown) => {
						const serialized = JSON.stringify(value);
						for (const secret of [query, note, terminal]) {
							expect(serialized).not.toContain(secret);
							expect(serialized).not.toContain(encodeURIComponent(secret));
						}
					};
					check(outgoing);
					expect(() => check([...outgoing, {frame: {query}}])).toThrow();
				},
			),
			options,
		);
	});
});
