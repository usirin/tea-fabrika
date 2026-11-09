import {foldEvents} from "@demlik/tea/pbt";
import {Ledger, memoryStorage, openJobs} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {memoryTraces} from "@tea-fabrika/trace/memory";
import {Author, PullRequests} from "@tea-fabrika/tracker";
import {Effect, Logger, Stream} from "effect";
import {NetAddress} from "effect/net";
import {Socket, SocketServer} from "effect/socket";
import * as fc from "fast-check";
import {assert, describe, expect, it, vi} from "vitest";
import {deskMachine, savedOf} from "../desk/desk.ts";
import {defaults} from "../desk/keymap.ts";
import {type Does, wordOf} from "../desk/keys.ts";
import {memoryHistory, sharedHistory} from "../editor/history.ts";
import type {Down, Up} from "../link.ts";
import {readToPage} from "../messages.ts";
import type {startTiles} from "../tiles.ts";
import {serve} from "./serve.ts";

// Replace only the terminal and socket boundaries. serve's actual tsh callback, desk
// machine and outgoing page messages run together, without an OS socket or a real home.
const edge = vi.hoisted(() => ({
	said: null as Parameters<typeof startTiles>[0]["edge"]["said"] | null,
	receive: null as ((message: Up) => void) | null,
	down: [] as Down[],
}));
vi.mock("../tiles.ts", () => ({
	startTiles: (options: Parameters<typeof startTiles>[0]) =>
		Effect.sync(() => {
			edge.said = options.edge.said;
			return {
				open: () => Effect.void,
				close: () => Effect.void,
				stop: () => Effect.void,
				end: () => Effect.void,
				kill: () => Effect.void,
				stopJob: () => Effect.succeed(false),
				line: () => Effect.die("this law sends desk words, never agent lines"),
			};
		}),
}));
vi.mock("../wire.ts", () => ({
	hostWire: (_socket: Socket.Socket, receive: (message: Up) => void) =>
		Effect.sync(() => {
			edge.receive = receive;
			return {
				send: (message: Down) => edge.down.push(message),
				state: () => ({at: "up"}),
				ended: Effect.never,
			};
		}),
}));

const navigation: readonly Does[] = [
	{kind: "cycle", to: "next"},
	{kind: "cycle", to: "previous"},
	...(["left", "right", "up", "down"] as const).map((to) => ({kind: "focus", to}) as const),
	{kind: "go", tile: "t2"},
	{kind: "split", orientation: "horizontal"},
	{kind: "split", orientation: "vertical"},
	{kind: "new"},
	{kind: "step", to: "next"},
	{kind: "step", to: "previous"},
	{kind: "pick", at: 2},
	{kind: "fold"},
	{kind: "zoom"},
	{kind: "turn"},
];

const tshNavigation = (does: Does) =>
	Effect.gen(function* () {
		const vertical = does.kind === "focus" && (does.to === "up" || does.to === "down");
		const initial = foldEvents(deskMachine, undefined, null, [
			{
				type: "typed",
				tile: "t1",
				does: {kind: "split", orientation: vertical ? "vertical" : "horizontal"},
			},
			{type: "typed", tile: "t1", does: {kind: "new"}},
			{type: "typed", tile: "t1", does: {kind: "go", tile: "t1"}},
		]).finalState;
		assert(initial.at === "open");
		yield* Effect.sync(() => {
			edge.said = edge.receive = null;
			edge.down = [];
		});
		const snapshot = {version: "test", keys: defaults, changes: []};
		const server = SocketServer.SocketServer.of({
			address: NetAddress.unixPathAddress("memory"),
			run: (handler) =>
				handler(Socket.make({reader: Effect.never, writer: Effect.never})).pipe(
					Effect.orDie,
					Effect.andThen(Effect.never),
				),
		});
		yield* serve({
			history: yield* sharedHistory(memoryHistory()),
			jobs: yield* openJobs(memoryStorage()),
			desk: {kept: savedOf(initial), save: () => Effect.void, forget: Effect.void},
			asks: {kept: null, save: () => Effect.void},
			keybindings: {
				current: Effect.succeed(snapshot),
				changes: Stream.make(snapshot),
				edit: () => Effect.succeed(snapshot),
			},
			pid: 1,
			ledger: {kind: "own"},
		}).pipe(
			Effect.provideService(SocketServer.SocketServer, server),
			Effect.provideService(Ledger, memoryService()),
			Effect.provideService(Author, {kind: "user", id: "owner"}),
			Effect.provideService(PullRequests, {open: Effect.succeed([])}),
			Effect.provide(memoryTraces([])),
			Effect.forkScoped,
		);
		while (edge.receive === null) yield* Effect.sleep("1 millis");
		// The wire is installed before the client joins the host's set.
		yield* Effect.yieldNow;
		const receive: ((message: Up) => void) | null = edge.receive;
		const said = edge.said;
		assert(receive !== null && said !== null);
		receive({type: "page"});
		edge.down = [];
		const source = does.kind === "focus" && (does.to === "left" || does.to === "up") ? "t2" : "t1";
		expect(said(source, does), wordOf(does)).toBeNull();
		return edge.down.flatMap((message) => {
			if (message.type !== "to" || message.port !== "desk") return [];
			const read = readToPage(message.m);
			assert(read.kind === "read");
			return [read.msg];
		});
	}).pipe(Effect.scoped, Effect.provide(Logger.layer([])));

describe("today's host: tsh navigation under an overlay", () => {
	it("every successful navigation sends cleanup before workspace focus, as keys and the palette do", async () => {
		// Every generated order visits all review 3 commands. Each starts from the real init,
		// with a reachable target, two tiles and two workspaces. No refusal counts as navigation.
		await fc.assert(
			fc.asyncProperty(
				fc.shuffledSubarray([...navigation], {
					minLength: navigation.length,
					maxLength: navigation.length,
				}),
				async (commands) => {
					const missed: string[] = [];
					for (const does of commands) {
						const messages = await Effect.runPromise(tshNavigation(does));
						expect(
							messages.some((msg) =>
								does.kind === "cycle"
									? msg.type === "show" && msg.what === `focus-${does.to}`
									: msg.type === "desk",
							),
							wordOf(does),
						).toBe(true);
						const first = messages[0];
						// Focus cycles are renderer commands; its show handler has its own cleanup law.
						const cleanup =
							first?.type === "navigation" ||
							(first?.type === "show" &&
								(first.what === "focus-next" || first.what === "focus-previous"));
						if (!cleanup) missed.push(wordOf(does));
					}
					expect(missed).toEqual([]);
				},
			),
			{seed: 119120, numRuns: 10},
		);
	});
});

// On a home connected to a ledger server, each agent writes on its own session there (tracker
// 185a, host/agent-session.ts); the person's session is the person's alone. So the host's options
// can't hold a server ledger with no agents' sessions: with that pair, every agent would write on
// the person's session as the person. The ledger note's doubt: "a bug in the host could send an
// agent's text down the person's path". A type test, as window/frame.test.ts keeps its own: the
// pair does not compile. Today's version.
//
//   {ledger: {kind: "server", address, login}, agents: {server, sessionFor: null}}   no such options
//   {ledger: {kind: "own"}, ...}                                                       agents write on the host's

type Options = Parameters<typeof serve>[0];

const ADDRESS = "https://ledger.example/acme";

describe("the host's options on a connected home", () => {
	it("can't name a server ledger without each agent's own session there", () => {
		const pairs = (server: SocketServer.SocketServer["Service"]) => {
			const ledger = {kind: "server", address: ADDRESS, login: "alice"} as const;
			const agents = {server, sessionFor: null};
			// Each pair on one line: an expected error is looked for on the line below it only.
			// @ts-expect-error a server ledger and no agents' sessions: agents would write as the person
			const shared: Pick<Options, "ledger" | "agents"> = {ledger, agents};
			// @ts-expect-error the server case carries the agents' sessions, never null
			const none: Options["ledger"] = {...ledger, sessionFor: null};
			return [shared, none];
		};
		expect(pairs).toBeTypeOf("function");
	});
});
