// P18's Node scenario uses real tea handles, startWindow and the real counter registration.
import {run as runTea} from "@demlik/tea/effect";
import {counterWindow} from "@kampus/counter/window";
import {Effect, Layer, Schema, Stream} from "effect";
import * as Socket from "effect/socket/Socket";
import * as fc from "fast-check";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect, it} from "vitest";

// Plants: a module-level document read, or a store hook that needs the DOM during render.
it("P18 p50: prepared real window state renders in Node without document or IndexedDB", async () => {
	const {Window} = await import("./main.tsx");
	const {
		startWindow,
		windowMachine,
		WindowModel,
		ViewState,
		CachedView,
		TileState,
		Watch,
		ClientSession,
		ClientKey,
		ClientConnection,
		IdGenerator,
		Layout,
		TileId,
		TabId,
		ClientId,
		MonitorId,
		Link,
	} = await import("@kampus/libfabrika");
	const {memoryKey, memoryScreen, headlessLayer} = await import("@kampus/libfabrika/headless");
	await fc.assert(
		fc.asyncProperty(fc.integer({min: -100, max: 100}), async (count) => {
			expect(typeof document).toBe("undefined");
			expect(typeof indexedDB).toBe("undefined");
			const tile = Schema.decodeUnknownSync(TileId)("tile_0000000000e008000000000001");
			const tab = Schema.decodeUnknownSync(TabId)("tab_0000000000e008000000000002");
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const screen = yield* memoryScreen({width: 1024, height: 700});
						const platform = headlessLayer({
							host: {platform: "headless", os: "unknown", has: [], cannot: []},
							screen: screen.layer,
							key: memoryKey({tab}),
							socket: Socket.layerWebSocketConstructorGlobal,
						});
						yield* Effect.gen(function* () {
							const identity = yield* (yield* ClientKey).identity;
							const context = {
								url: "http://localhost:19118",
								layout: Layout.cases.tile.make({id: tile, name: "counter:1", keep: "failed"}),
								views: {counter: counterWindow.contract},
							};
							// Verify that the real starter itself imports and boots with no DOM.
							const source = yield* startWindow({...context, identity});
							yield* source.ready;
							const before = source.getState();
							yield* source.stop();
							const session = ClientSession.make({
								client: Schema.decodeUnknownSync(ClientId)("client_0000000000e008000000000003"),
								session: "process_0000000000e008000000000004",
							});
							const pid = "process_0000000000e008000000000005";
							const watch = Watch.make({
								pid,
								ref: Schema.decodeUnknownSync(MonitorId)("monitor_0000000000e008000000000006"),
								to: session,
								dial: 0,
							});
							const prepared = WindowModel.make({
								...before,
								identity,
								session,
								focus: tile,
								link: Link.cases.online.make({dial: 0, version: 1, ping: 30_000, beat: 0}),
								tiles: {[tile]: TileState.cases.live.make({watch})},
								views: {
									[tile]: ViewState.cases.ready.make({
										value: CachedView.make({
											rev: 1,
											ledger: 1,
											hash: "counter-window",
											data: {count},
										}),
									}),
								},
							});
							const failures: Array<unknown> = [];
							const unexpected = () =>
								Effect.die(new Error("SSR of saved state must not issue a Cmd"));
							const booting = yield* runTea(windowMachine, {
								ctx: context,
								// A saved-state source only, never a replacement runtime or store hook.
								store: {
									load: () => Promise.resolve(prepared),
									save: () => Promise.resolve(),
									migrate: Schema.decodeUnknownSync(WindowModel),
								},
								onError: (error: unknown) => {
									failures.push(error);
								},
								interpret: {
									now: unexpected,
									client_call: unexpected,
									client_identify: unexpected,
									client_sign: unexpected,
									client_persist: unexpected,
									client_monitor_id: unexpected,
								},
								subscribe: {client: () => Stream.empty, link_timer: () => Stream.empty},
							});
							const run = yield* booting.ready;
							const html = renderToStaticMarkup(
								createElement(Window, {run, views: {counter: {"counter-window": counterWindow}}}),
							);
							expect(html.replace(/<[^>]*>/g, "")).toContain(String(count));
							expect(run.getState().views[tile]).toEqual(prepared.views[tile]);
							expect(failures).toEqual([]);
						}).pipe(
							Effect.provide(
								Layer.mergeAll(
									platform,
									IdGenerator.layer,
									Layer.succeed(ClientConnection, {
										request: () => Effect.never,
										news: Stream.empty,
										events: Stream.empty,
										open: () => Effect.void,
										ping: () => Effect.void,
										close: Effect.void,
									}),
								),
							),
						);
					}),
				),
			);
		}),
		{seed: 119120, numRuns: 10},
	);
});
