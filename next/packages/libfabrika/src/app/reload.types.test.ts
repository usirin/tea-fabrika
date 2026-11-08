import {Machine} from "@demlik/tea/effect";
// P15a, next/. tsc owns negative cases; Vitest requires actual exports through deferred imports.
import type {Layer} from "effect";
import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {expect, expectTypeOf, it} from "vitest";
import type {CodeError, CodeHash, CodeBundle} from "../data/code.ts";
import type {LedgerError} from "../data/ledger.ts";
import {ProgramLoader} from "./entry.ts";
import type {ProgramDown, State} from "./program.ts";
import {Step, Program} from "./program.ts";
import {checks, executionFixture, failure, restartFixture, typeId} from "./reload.test-support.ts";
import type {Saved as SavedValue} from "./state.ts";

it("p78/types: policy, hashes and IDs retain separate brands and typed Effect failures", async () => {
	const {ReloadPolicy} = await import("./reload.ts");
	const {CodeHash, EntryId} = await import("../data/code.ts");
	const {RequestId, LetterId, TileId, TabId, ObservationId} = await import("../data/id.ts");
	const {CodeRegistry} = await import("../coordination/code-registry.ts");
	const {Saved} = await import("./state.ts");
	const hash = Schema.decodeUnknownSync(CodeHash)("a".repeat(64));
	const req = Schema.decodeUnknownSync(RequestId)("request_01j0000000e0080000000000001");
	const policy = ReloadPolicy.cases.pinned.make({hash});
	expect(policy.hash).toBe(hash);
	expectTypeOf(policy.hash).toEqualTypeOf<CodeHash>();
	const invalid = () => {
		// @ts-expect-error a code pin must carry a decoded hash
		ReloadPolicy.cases.pinned.make({hash: "arbitrary text"});
		// @ts-expect-error RequestId cannot name executable bytes
		ReloadPolicy.cases.pinned.make({hash: req});
		// @ts-expect-error a pin cannot omit its hash
		ReloadPolicy.cases.pinned.make({});
		// @ts-expect-error follow cannot smuggle in a pinned hash
		ReloadPolicy.cases.follow.make({hash});
	};
	expect(typeof invalid).toBe("function");
	const brands = (
		_hash: CodeHash,
		_request: typeof RequestId.Type,
		_letter: typeof LetterId.Type,
		_tile: typeof TileId.Type,
		_tab: typeof TabId.Type,
		_observation: typeof ObservationId.Type,
		_entry: typeof EntryId.Type,
	) => {};
	const entry = Schema.decodeUnknownSync(EntryId)("entry_01j0000000e0080000000000001");
	const letter = Schema.decodeUnknownSync(LetterId)(typeId("letter", 1));
	const tile = Schema.decodeUnknownSync(TileId)(typeId("tile", 1));
	const tab = Schema.decodeUnknownSync(TabId)(typeId("tab", 1));
	const observation = Schema.decodeUnknownSync(ObservationId)(typeId("observation", 1));
	brands(hash, req, letter, tile, tab, observation, entry);
	const compileOnly = (registry: typeof CodeRegistry.Service, state: State, bundle: CodeBundle) => {
		// @ts-expect-error request IDs cannot select code
		brands(req, req, letter, tile, tab, observation, entry);
		// @ts-expect-error entry IDs cannot correlate requests
		brands(hash, entry, letter, tile, tab, observation, entry);
		// @ts-expect-error request IDs cannot identify letters
		brands(hash, req, req, tile, tab, observation, entry);
		// @ts-expect-error tab IDs cannot identify tiles
		brands(hash, req, letter, tab, tab, observation, entry);
		// @ts-expect-error tile IDs cannot identify tabs
		brands(hash, req, letter, tile, tile, observation, entry);
		// @ts-expect-error letter IDs cannot identify observations
		brands(hash, req, letter, tile, tab, letter, entry);
		// @ts-expect-error request IDs cannot identify ledger entries
		brands(hash, req, letter, tile, tab, observation, req);
		expectTypeOf(registry.put(bundle)).toEqualTypeOf<
			Effect.Effect<CodeBundle, CodeError | LedgerError>
		>();
		expectTypeOf(Saved.upgradeEffect({}, state, hash)).toEqualTypeOf<
			Effect.Effect<{readonly saved: SavedValue; readonly ran: ReadonlyArray<string>}, ProgramDown>
		>();
		// @ts-expect-error get needs a hash, never an entry ID
		const wrongHash = registry.get(entry);
		// @ts-expect-error outside data does not return synchronously
		const synchronous: CodeBundle = registry.put(bundle);
		return {synchronous, wrongHash};
	};
	expect(typeof compileOnly).toBe("function");
	expectTypeOf<Layer.Error<ReturnType<typeof CodeRegistry.layer>>>().toEqualTypeOf<never>();
});

it("upstream P14 IDs: shared identity decoders exist independently of P15", async () => {
	const upstream = await import("../data/id.ts");
	expect(typeof upstream.Id.make).toBe("function");
	expect(typeof upstream.IdGenerator).toBe("function");
});

it("test-owned P12/P34 stand-ins only return answers and collect calls", async () => {
	await fc.assert(
		fc.asyncProperty(fc.integer(), async (count) => {
			const step = Step.cases.stepped.make({model: {count}, view: {count}, wake: null, cmds: []});
			const {Saved} = await import("./state.ts");
			const saved = Saved.make({v: 1, build: "fixture", model: {count}, after: 0});
			const fixture = executionFixture({
				init: step,
				steps: [step],
				upgrade: {saved, ran: []},
				inspect: {model: {count}, view: {count}, wake: null},
			});
			expect(await Effect.runPromise(fixture.execution.init(null))).toEqual(step);
			expect(await Effect.runPromise(fixture.execution.step({count}, {type: "add", n: 1}))).toEqual(
				step,
			);
			expect(fixture.calls.map((c) => c.method)).toEqual(["init", "step"]);
			const restart = restartFixture({process: typeId("process", 1)});
			expect(restart.requests).toEqual([]);
		}),
		checks,
	);
});

it("outside module declarations fail through ProgramDown; a real Program.make control loads", async () => {
	await fc.assert(
		fc.asyncProperty(fc.jsonValue(), fc.integer({min: -10, max: 10}), async (raw, initial) => {
			const machine = Machine.make({
				model: Schema.Int,
				msg: Schema.Struct({type: Schema.Literal("inc")}),
				cmds: [],
				init: (loaded) => [loaded ?? initial, []],
				update: {inc: (m) => [m + 1, []]},
			});
			const program = Program.make({
				name: "counter",
				machine,
				state: {v: 1, upgrades: []},
				view: (m) => m,
				refuse: () => null,
				inputs: {inc: "Add"},
				outputs: {},
				writes: {},
				wake: () => null,
			});
			const load = (declaration: unknown) =>
				ProgramLoader.use((l) => l.load("counter")).pipe(
					Effect.provide(ProgramLoader.layer({counter: declaration}, {})),
				);
			expect(await failure(load({...program, machine: raw}))).toMatchObject({
				_tag: "ProgramDown",
				why: "load",
			});
			expect(await Effect.runPromise(load(program))).toHaveProperty("handler");
		}),
		checks,
	);
});
