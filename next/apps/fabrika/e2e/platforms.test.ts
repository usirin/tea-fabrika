// Real Chromium and the public headless client run this same protocol scenario.
import {Effect, Fiber, Layer, Schema} from "effect";
import * as Socket from "effect/socket/Socket";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {browserStep, openP18Browser, withP18Stage, type P18Stage} from "./p18.test-support.ts";

const Opened = Schema.Struct({
	client: Schema.Struct({client: Schema.String, session: Schema.String}),
	tiles: Schema.Array(
		Schema.Struct({tile: Schema.String, pid: Schema.String, hash: Schema.String}),
	),
});
const Page = Schema.Struct({
	after: Schema.Int,
	more: Schema.Boolean,
	letters: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			m: Schema.Struct({
				_tag: Schema.Literal("DOWN"),
				ref: Schema.String,
				process: Schema.String,
				why: Schema.String,
				to: Schema.Struct({
					_tag: Schema.Literal("client"),
					client: Schema.String,
					session: Schema.String,
				}),
			}),
		}),
	),
});
type Client = {
	readonly request: (method: string, params: Schema.Json) => Effect.Effect<Schema.Json, unknown>;
	readonly reconnect: Effect.Effect<void, unknown>;
	readonly ping: Effect.Effect<void, unknown>;
};

const protocol = (client: Client, stage: P18Stage, suffix: string) =>
	// Plants: omit monitor/cancel on one platform, use the Project reader, or lose waits on sleep.
	// This crosses the actual stage; replacing it with a fake gateway loses the trusted exit call.
	Effect.gen(function* () {
		const opened = yield* Schema.decodeUnknownEffect(Opened)(
			yield* client.request("window.open", {}),
		);
		expect(opened.tiles.length).toBeGreaterThan(0);
		const process = opened.tiles[0]!.pid;
		const ref = `monitor_${suffix}`;
		yield* client.ping;
		const view = yield* client.request("view.open", {pid: process});
		expect(view).toHaveProperty("update");
		const answer = yield* client.request("process.send", {
			pid: process,
			letter: `letter_${suffix}`,
			m: {type: "inc"},
			seen: 0,
			sentAt: "2026-11-08T00:00:00Z",
			action: {does: "inc", via: {_tag: "click"}},
		});
		expect(answer).toMatchObject({_tag: "accepted"});
		expect(yield* client.request("process.monitor", {pid: process, ref})).toEqual({ref});
		const wait = yield* client.request("client.wait", {after: 0}).pipe(Effect.forkScoped);
		yield* Effect.yieldNow;
		yield* stage.sleep(opened.client); // Check the saved reader, sleep both objects, then wake them.
		yield* stage.exit(process, "p18-failed");
		yield* Fiber.join(wait);
		let after = 0,
			more = true;
		const signals: Array<(typeof Page.Type)["letters"][number]> = [];
		while (more) {
			const page = yield* Schema.decodeUnknownEffect(Page)(
				yield* client.request("client.inbox", {after}),
			);
			signals.push(...page.letters);
			after = page.after;
			more = page.more;
		}
		expect(signals.find((s) => s.m.ref === ref)?.m).toEqual({
			_tag: "DOWN",
			ref,
			process,
			why: "p18-failed",
			to: {_tag: "client", ...opened.client},
		});
		expect(yield* client.request("process.demonitor", {ref})).toEqual({ref});
		const flushed = yield* Schema.decodeUnknownEffect(Page)(
			yield* client.request("client.inbox", {after: 0}),
		);
		expect(flushed.letters.some((s) => s.m.ref === ref)).toBe(false);
		yield* client.reconnect;
		const later = yield* Schema.decodeUnknownEffect(Opened)(
			yield* client.request("window.open", {}),
		);
		expect(later.client.client).toBe(opened.client.client);
		expect(later.client.session).not.toBe(opened.client.session);
		expect(later.tiles.map((t) => t.pid)).toEqual(opened.tiles.map((t) => t.pid));
		// Public traffic must never reach the trusted fixture binding.
		expect(yield* Effect.result(client.request("p18.exit", {pid: process}))).toMatchObject({
			_tag: "Failure",
		});
	});

describe("P18 real protocol parity", () => {
	for (const platform of ["browser", "headless"] as const) {
		it(`${platform}: sign, initialize, text ping, open, send, answer, monitor, wait, cancel and reconnect`, async () => {
			expect.hasAssertions();
			await fc.assert(
				fc.asyncProperty(fc.integer({min: 1, max: 31}), async (n) => {
					const suffix = `0000000000e00800000000000${"0123456789abcdefghjkmnpqrstvwxyz"[n]}`;
					await Effect.runPromise(
						Effect.scoped(
							withP18Stage((stage) =>
								Effect.gen(function* () {
									expect.hasAssertions();
									if (platform === "browser") {
										const {page, errors} = yield* openP18Browser(stage);
										const request = (method: string, params: Schema.Json) =>
											browserStep(() =>
												page.evaluate(({method, params}) => window.p18.request(method, params), {
													method,
													params,
												}),
											);
										yield* protocol(
											{
												request,
												ping: browserStep(() => page.evaluate(() => window.p18.ping())),
												reconnect: browserStep(() => page.evaluate(() => window.p18.reconnect())),
											},
											stage,
											suffix,
										);
										expect(errors).toEqual([]);
									} else {
										const {
											ClientKey,
											ClientConnection,
											IdGenerator,
											TabId,
											TileId,
											Layout,
											startWindow,
											ViewContract,
										} = yield* Effect.promise(() => import("@kampus/libfabrika"));
										const {headlessLayer, memoryKey, memoryScreen} = yield* Effect.promise(
											() => import("@kampus/libfabrika/headless"),
										);
										const {browserConnection} = yield* Effect.promise(
											() => import("@kampus/libfabrika/browser"),
										);
										const {counter, counterMachine} = yield* Effect.promise(
											() => import("@kampus/counter"),
										);
										const screen = yield* memoryScreen({width: 1024, height: 700});
										const layer = headlessLayer({
											host: {platform: "headless", os: "unknown", has: [], cannot: []},
											screen: screen.layer,
											key: memoryKey({tab: Schema.decodeUnknownSync(TabId)(`tab_${suffix}`)}),
											socket: Socket.layerWebSocketConstructorGlobal,
										}).pipe(Layer.provideMerge(IdGenerator.layer));
										const services = yield* Layer.build(layer);
										const key = yield* ClientKey.pipe(Effect.provideContext(services));
										const identity = yield* key.identity;
										const connection = yield* ClientConnection.pipe(
											Effect.provide(browserConnection(stage.url.replace(/^http/, "ws"))),
											Effect.provideContext(services),
										);
										const run = yield* startWindow({
											url: stage.url,
											identity,
											layout: Layout.cases.tile.make({
												id: Schema.decodeUnknownSync(TileId)("tile_0000000000e008000000000000"),
												name: "p18counter:1",
												keep: "failed",
											}),
											views: {
												counter: ViewContract.make(counter, {
													data: counterMachine.model,
													commands: {inc: {send: {type: "inc"}, keys: "+"}},
												}),
											},
										}).pipe(
											Effect.provideService(ClientConnection, connection),
											Effect.provideContext(services),
										);
										yield* stage.grant(identity.fingerprint);
										yield* run.ready;
										while (run.getState().session === null) yield* Effect.yieldNow;
										yield* protocol(
											{
												request: connection.request,
												ping: connection.ping(run.getState().link.dial),
												reconnect: Effect.gen(function* () {
													const before = run.getState().session;
													yield* connection.close;
													while (
														run.getState().session?.session === before?.session ||
														run.getState().session === null
													)
														yield* Effect.yieldNow;
												}),
											},
											stage,
											suffix,
										);
									}
								}),
							),
						),
					);
				}),
				{seed: 119120, numRuns: 1},
			);
		});
	}

	// Plants: an extractable key, viewport measurements instead of content, or a surviving observer.
	it("browser p30: actual stored private key cannot export or wrap; DOM screen uses content area", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.record({
					width: fc.integer({min: 440, max: 1200}),
					height: fc.integer({min: 240, max: 700}),
				}),
				async (content) => {
					await Effect.runPromise(
						Effect.scoped(
							withP18Stage((stage) =>
								Effect.gen(function* () {
									const {page} = yield* openP18Browser(stage);
									expect(
										yield* browserStep(() => page.evaluate(() => window.p18.keySafety())),
									).toEqual({
										exported: false,
										wrapped: false,
										privateGetter: false,
									});
									for (const viewport of [
										{width: 1024, height: 700},
										{width: 1440, height: 900},
									]) {
										yield* browserStep(() => page.setViewportSize(viewport));
										const sized = yield* browserStep(() =>
											page.evaluate(({width, height}) => {
												const root = document.getElementById("p18-root");
												if (root === null) return false;
												root.style.cssText = `width:${width}px;height:${height}px;padding:7px;border:9px solid transparent;box-sizing:content-box`;
												return true;
											}, content),
										);
										expect(sized).toBe(true);
										yield* browserStep(() =>
											page.waitForFunction(({width, height}) => {
												const s = window.p18.state();
												return (
													typeof s === "object" &&
													s !== null &&
													"width" in s &&
													"height" in s &&
													s.width === width &&
													s.height === height
												);
											}, content),
										);
									}
									const watching = yield* browserStep(() =>
										page.evaluate(() => window.p18.screenObservers()),
									);
									expect(watching.active).toBeGreaterThan(0);
									yield* browserStep(() => page.evaluate(() => window.p18.close()));
									const released = yield* browserStep(() =>
										page.evaluate(() => window.p18.screenObservers()),
									);
									expect(released.active).toBe(0);
									expect(released.disconnects).toBeGreaterThan(watching.disconnects);
									const before = yield* browserStep(() => page.evaluate(() => window.p18.state()));
									yield* browserStep(() => page.setViewportSize({width: 800, height: 600}));
									expect(yield* browserStep(() => page.evaluate(() => window.p18.state()))).toEqual(
										before,
									);
								}),
							),
						),
					);
				},
			),
			{seed: 119120, numRuns: 1},
		);
	});
});
