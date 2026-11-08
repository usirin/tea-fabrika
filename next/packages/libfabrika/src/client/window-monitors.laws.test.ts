import {applyCell} from "@demlik/tea";
import {Machine} from "@demlik/tea/effect";
import {arbMsgSequence, propertyTrace} from "@demlik/tea/pbt";
import {Program} from "@kampus/libfabrika";
import {Equal, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {Down, Recipient, signalId} from "../coordination/process.ts";
import {syncTest} from "../testing.ts";
import {p18Ids, p18Reason} from "./tile.test-support.ts";
import type {WindowCmd, WindowContext, WindowModel, WindowMsg, WindowSub} from "./window.ts";

const options = {seed: 119120, numRuns: 40};
const Model = Schema.Struct({count: Schema.Int});
const Msg = Schema.Struct({type: Schema.Literal("inc")});
const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [],
	init: (loaded) => [loaded ?? {count: 0}, []],
	update: {inc: (s) => [{count: s.count + 1}, []]},
});
const program = Program.make({
	name: "counter",
	machine,
	state: {v: 1, upgrades: []},
	view: (s) => s,
	refuse: () => null,
	inputs: {inc: "Add one"},
	outputs: {},
	writes: {},
	wake: () => null,
});

const setup = async (
	raw: typeof p18Ids extends fc.Arbitrary<infer V> ? V : never,
	keep: "never" | "failed" | "always",
	shared: boolean,
	percent = 50,
	otherKeep = keep,
) => {
	// These same generated monitor, retry and exit decisions must work with libfabrika alone.
	const W = await import("@kampus/libfabrika");
	const {Layout, ViewContract, ClientSession, TileId, MonitorId} = W;
	const tileA = Schema.decodeUnknownSync(TileId)(raw.tileA);
	const tileB = Schema.decodeUnknownSync(TileId)(raw.tileB);
	const refs = [raw.refA, raw.refB].map((ref) => Schema.decodeUnknownSync(MonitorId)(ref));
	const contract = ViewContract.make(program, {
		data: Model,
		commands: {inc: {send: {type: "inc"}, keys: "+"}},
	});
	const layout = Layout.cases.split.make({
		dir: "row",
		parts: [
			{percent, inner: Layout.cases.tile.make({id: tileA, name: "counter:1", keep})},
			{
				percent: 100 - percent,
				inner: Layout.cases.tile.make({
					id: tileB,
					name: shared ? "counter:1" : "counter:2",
					keep: otherKeep,
				}),
			},
		],
	});
	const context: WindowContext = {
		url: "http://127.0.0.1:19118",
		layout,
		views: {counter: contract},
	};
	const session = ClientSession.make({client: raw.client, session: raw.sessionA});
	const msgs: Array<WindowMsg> = [];
	const [initial, initCmds] = W.windowMachine.init(null, context);
	let state: typeof WindowModel.Type = initial;
	const pending: Array<WindowCmd> = [...initCmds];
	const outputs: Array<WindowCmd> = [];
	const send = (msg: WindowMsg) => {
		msgs.push(msg);
		const [next, cmds] = applyCell<typeof WindowModel.Type, WindowMsg, WindowCmd>(
			W.windowMachine,
			state,
			msg,
		);
		state = next;
		pending.push(...cmds);
		outputs.push(...cmds);
	};
	// Drive the actual startup Cmds; no prepared live model bypasses init.
	const boot = () => {
		for (let turns = 0; turns < 40 && pending.length > 0; turns++) {
			const cmd = pending.shift()!;
			if (cmd.type === "client_identify")
				send(
					W.identify.ok(
						cmd,
						{
							key: "public-key",
							fingerprint: "SHA256:test",
							tab: raw.tileA.replace("tile_", "tab_"),
						},
						1,
					),
				);
			else if (cmd.type === "client_sign") send(W.sign.ok(cmd, "test-signature", 1));
			else if (cmd.type === "client_call" && cmd.method === "window.open")
				send(
					W.call.ok(
						cmd,
						{
							client: session,
							tiles: [
								{
									tile: tileA,
									name: "counter:1",
									pid: raw.processA,
									program: "counter",
									hash: "build-a",
								},
								{
									tile: tileB,
									name: shared ? "counter:1" : "counter:2",
									pid: shared ? raw.processA : raw.processB,
									program: "counter",
									hash: "build-a",
								},
							],
							keys: {prefix: "Ctrl+B", ignore: [], tiles: {counter: {inc: ["+"]}}, error: null},
						},
						1,
					),
				);
		}
	};
	boot();
	send({type: "link", event: {type: "connected", dial: 0}});
	send({type: "link", event: {type: "challenge", dial: 0, nonce: "nonce"}});
	boot();
	send({type: "link", event: {type: "online", dial: 0, version: 1, ping: 30_000}});
	boot();
	send({type: "client_session", dial: 0, value: session});
	boot();
	let allocated = 0;
	for (const cmd of [...outputs])
		if (cmd.type === "client_monitor_id") send(W.newMonitor.ok(cmd, {ref: refs[allocated++]}, 2));
	const monitorCalls = () =>
		outputs.filter(
			(cmd: WindowCmd) => cmd.type === "client_call" && cmd.method === "process.monitor",
		);
	const page = (why: string, tile = tileA, after = 10) => {
		const watch = state.tiles[tile].watch;
		const to = Recipient.cases.client.make(watch.to);
		return {
			after,
			more: false,
			letters: [
				{
					id: signalId(to, watch.ref, 1),
					rev: after,
					pos: 1,
					arrivedAt: 10,
					m: Down.make({ref: watch.ref, process: watch.pid, why, to}),
				},
			],
		};
	};
	return {
		W,
		context,
		layout,
		session,
		tileA,
		tileB,
		refs,
		raw,
		msgs,
		outputs,
		send,
		page,
		monitorCalls,
		state: () => state,
	};
};

describe("P18 window monitor laws, real init and tea pbt", () => {
	// Plants: allocate one watch per process, or mint another ref when a monitor call is retried.
	it("one independent watch per tile, shared targets included; retries retain the allocated ref", async () => {
		await fc.assert(
			fc.asyncProperty(p18Ids, fc.boolean(), fc.nat({max: 3}), async (ids, shared, retries) => {
				const f = await setup(ids, "failed", shared);
				expect(f.monitorCalls()).toHaveLength(2);
				expect(new Set(f.monitorCalls().map((cmd: WindowCmd) => cmd.params.ref)).size).toBe(2);
				for (const cmd of f.monitorCalls()) {
					for (let n = 0; n < retries; n++) f.send(f.W.call.err(cmd, "closed", 3));
				}
				propertyTrace<typeof WindowModel.Type, WindowMsg, WindowCmd, WindowSub, WindowContext>(
					f.W.windowMachine,
					f.context,
					fc.constant(f.msgs),
					(steps) => {
						const allocations = steps
							.flatMap((s) => s.cmds)
							.filter((c) => c.type === "client_monitor_id");
						return allocations.length === 2 || "request retries allocated new monitor refs";
					},
					options,
				);
				expect(f.state().tiles[f.tileA].watch.pid).toBe(ids.processA);
				expect(f.state().tiles[f.tileB].watch.pid).toBe(shared ? ids.processA : ids.processB);
			}),
			options,
		);
	});

	// Plants: drop early DOWN, let the acknowledgement reopen the tile, or apply a late patch.
	it("early DOWN beats acknowledgement; duplicates and late patches cannot revive a finished tile", async () => {
		await fc.assert(
			fc.asyncProperty(
				p18Ids,
				p18Reason,
				fc.constantFrom("never", "failed", "always"),
				fc.constantFrom("never", "failed", "always"),
				fc.boolean(),
				fc.nat({max: 4}),
				async (ids, why, keep, otherKeep, downFirst, duplicates) => {
					const f = await setup(ids, keep, true, 50, otherKeep);
					const page = f.page(why);
					const ack = () => {
						for (const cmd of f.monitorCalls()) f.send(f.W.call.ok(cmd, {ref: cmd.params.ref}, 4));
					};
					if (!downFirst) ack();
					f.send({type: "client_inbox", dial: 0, value: page});
					const finished = f.state().tiles[f.tileA];
					expect(finished._tag).toBe(
						keep === "always" || (keep === "failed" && !["normal", "shutdown"].includes(why))
							? "kept"
							: "closed",
					);
					expect(finished.why).toBe(why);
					if (downFirst) ack();
					f.send({type: "client_inbox", dial: 0, value: f.page(why, f.tileB, 11)});
					expect(f.state().tiles[f.tileB]._tag).toBe(
						otherKeep === "always" ||
							(otherKeep === "failed" && !["normal", "shutdown"].includes(why))
							? "kept"
							: "closed",
					);
					for (let n = 0; n <= duplicates; n++) {
						f.send({type: "client_inbox", dial: 0, value: page});
						f.send({
							type: "view",
							dial: 0,
							pid: ids.processA,
							hash: "build-a",
							update: {type: "whole", rev: 99, ledger: 99, view: {count: 999}},
						});
					}
					expect(f.state().tiles[f.tileA]).toBe(finished);
					propertyTrace<typeof WindowModel.Type, WindowMsg, WindowCmd, WindowSub, WindowContext>(
						f.W.windowMachine,
						f.context,
						fc.constant(f.msgs),
						(_steps, state) => state.tiles[f.tileA]._tag === finished._tag,
						options,
					);
				},
			),
			options,
		);
	});

	// Plants: resolve a successor by name, clear pending letters, or accept an old dial/session.
	it("reconnect keeps original processes and pending letters; old-session and old-dial work changes nothing", async () => {
		await fc.assert(
			fc.asyncProperty(p18Ids, fc.nat({max: 4}), async (ids, duplicates) => {
				const f = await setup(ids, "failed", false);
				f.send({
					type: "view",
					dial: 0,
					pid: ids.processA,
					hash: "build-a",
					update: {type: "whole", rev: 1, ledger: 20, view: {count: 7}},
				});
				f.send({type: "press", tile: f.tileA, m: {type: "inc"}, via: {_tag: "click"}});
				const before = f.state().pending;
				expect(before.length).toBeGreaterThan(0);
				const stalePage = f.page("crashed");
				f.send({type: "link", event: {type: "closed", dial: 0, code: 1006, at: 100}});
				expect(f.state().session).toBeNull();
				f.send({type: "link", event: {type: "connected", dial: 1}});
				f.send({type: "link", event: {type: "online", dial: 1, version: 1, ping: 30_000}});
				f.send({type: "client_session", dial: 1, value: {...f.session, session: ids.sessionB}});
				const start = f.state();
				const stale: WindowMsg[] = [
					{type: "client_inbox", dial: 0, value: stalePage},
					{type: "client_session", dial: 0, value: f.session},
					{
						type: "view",
						dial: 0,
						pid: ids.processB,
						hash: "successor",
						update: {type: "whole", rev: 99, ledger: 99, view: {count: 99}},
					},
				];
				const lists = arbMsgSequence(fc.constantFrom(...stale), {
					minLength: 1,
					maxLength: duplicates + 3,
					prefix: f.msgs,
				});
				propertyTrace<typeof WindowModel.Type, WindowMsg, WindowCmd, WindowSub, WindowContext>(
					f.W.windowMachine,
					f.context,
					lists,
					(_steps, end) => Equal.equals(end, start),
					options,
				);
				expect(f.state().pending).toEqual(before);
				for (const tile of [f.tileA, f.tileB])
					expect(f.state().tiles[tile].pid ?? f.state().tiles[tile].watch.pid).toBe(
						tile === f.tileA ? ids.processA : ids.processB,
					);
			}),
			options,
		);
	});

	// Plants: send process.exit, retain removed focus, or rewrite the supplied percentage tree.
	it("closed tiles release layout and move focus without sending exit or changing the percentage tree", async () => {
		await fc.assert(
			fc.asyncProperty(
				p18Ids,
				fc.boolean(),
				fc.integer({min: 1, max: 99}),
				async (ids, reverse, percent) => {
					const f = await setup(ids, "never", false, percent);
					const tree = JSON.stringify(f.layout);
					const order = reverse ? [f.tileB, f.tileA] : [f.tileA, f.tileB];
					f.send({type: "focus", tile: order[0]});
					f.send({type: "client_inbox", dial: 0, value: f.page("normal", order[0], 10)});
					expect(f.state().focus).toBe(order[1]);
					f.send({type: "client_inbox", dial: 0, value: f.page("normal", order[1], 11)});
					expect(f.state().focus).toBeNull();
					expect(JSON.stringify(f.layout)).toBe(tree);
					expect(
						f.outputs.filter(
							(cmd: WindowCmd) => cmd.type === "client_call" && /exit|start/.test(cmd.method),
						),
					).toEqual([]);
					propertyTrace<typeof WindowModel.Type, WindowMsg, WindowCmd, WindowSub, WindowContext>(
						f.W.windowMachine,
						f.context,
						fc.constant(f.msgs),
						(_steps, end) =>
							end.focus === null &&
							Object.values(end.tiles).every(
								(tile) =>
									typeof tile === "object" &&
									tile !== null &&
									"_tag" in tile &&
									tile._tag === "closed",
							),
						options,
					);
				},
			),
			options,
		);
	});

	it("S2/p88 every JSON cut preserves monitor, session, cursor, pending letters and later Cmds", async () => {
		await fc.assert(
			fc.asyncProperty(p18Ids, p18Reason, fc.boolean(), async (ids, why, shared) => {
				const f = await setup(ids, "always", shared);
				for (const cmd of f.monitorCalls()) f.send(f.W.call.ok(cmd, {ref: cmd.params.ref}, 4));
				f.send({
					type: "view",
					dial: 0,
					pid: ids.processA,
					hash: "build-a",
					update: {type: "whole", rev: 1, ledger: 5, view: {count: 7}},
				});
				f.send({type: "press", tile: f.tileA, m: {type: "inc"}, via: {_tag: "click"}});
				expect(f.state().pending.length).toBeGreaterThan(0);
				f.send({type: "client_inbox", dial: 0, value: f.page(why)});
				propertyTrace<typeof WindowModel.Type, WindowMsg, WindowCmd, WindowSub, WindowContext>(
					f.W.windowMachine,
					f.context,
					fc.constant(f.msgs),
					() => {
						syncTest(f.W.windowMachine, f.context, {
							msgs: f.msgs,
							encode: Schema.encodeSync(f.W.WindowModel),
							decode: Schema.decodeUnknownSync(f.W.WindowModel),
							equals: Equal.equals,
							seed: 119120,
						});
						return true;
					},
					options,
				);
				// Plant uses the actual trace, removing an irreversible fact at every save.
				expect(() =>
					syncTest(f.W.windowMachine, f.context, {
						msgs: f.msgs,
						encode: (model: typeof WindowModel.Type) => ({...model, inbox: 0, session: null}),
						decode: Schema.decodeUnknownSync(f.W.WindowModel),
						equals: Equal.equals,
						seed: 119120,
					}),
				).toThrow();
			}),
			options,
		);
	});
});
