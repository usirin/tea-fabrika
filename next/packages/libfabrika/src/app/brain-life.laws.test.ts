// P12, next/. Lifecycle events use tea's type; persisted state uses Effect Schema's _tag.
import {applyCell} from "@demlik/tea";
import {propertyInvariant} from "@demlik/tea/pbt";
import {syncTest} from "@kampus/libfabrika/testing";
import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {fcProcessIds, processId} from "../id.test-support.ts";

const SEED = 119120;
const start = Effect.runSync(processId);
const after = Effect.runSync(processId);
const events = [
	{type: "started", start, after: null, build: "build-a", reason: "open"},
	{type: "waiting", after: start, until: 250, reason: "crash"},
	{type: "started", start: after, after: start, build: "build-a", reason: "crash"},
	{type: "braked", after, reason: "intensity"},
	{type: "stop"},
	{type: "stopped"},
] as const;
const lifecycle = fc.record({
	start: fcProcessIds,
	after: fcProcessIds,
	build: fc.string(),
	until: fc.nat(),
	reason: fc.string(),
});
const normalLife = {start, after, build: "build-a", until: 250, reason: "crash"};
const stopInFlight = [events[0], {type: "stop"}, events[1], events[2], {type: "stopped"}] as const;
const messages = lifecycle.map(
	({start, after, build, until, reason}) =>
		[
			{type: "started", start, after: null, build, reason: "open"},
			{type: "waiting", after: start, until, reason},
			{type: "started", start: after, after: start, build, reason},
			{type: "braked", after, reason},
			{type: "stop"},
			{type: "stopped"},
		] as const,
);
const message = messages.chain((msgs) => fc.constantFrom(...msgs));

describe("P12 stage machine laws", () => {
	it("p88 plant: missing start or stop transition cannot finish a normal life", async () => {
		const {brainLife} = await import("./brain-life.ts");
		fc.assert(
			fc.property(lifecycle, ({start, after, build, until, reason}) => {
				const msgs = [
					{type: "started", start, after: null, build, reason: "open"},
					{type: "waiting", after: start, until, reason},
					{type: "started", start: after, after: start, build, reason},
					{type: "braked", after, reason},
				] as const;
				const [initial] = brainLife.init(null, {});
				expect(initial).toMatchObject({_tag: "starting"});
				const [online] = applyCell(brainLife, initial, msgs[0]);
				expect(online).toMatchObject({_tag: "online", start, build});
				const [stopping] = applyCell(brainLife, online, {type: "stop"});
				for (const msg of msgs) expect(applyCell(brainLife, stopping, msg)[0]).toEqual(stopping);
				const [stopped] = applyCell(brainLife, stopping, {type: "stopped"});
				expect(stopped).toMatchObject({_tag: "stopped"});
			}),
			{seed: SEED, examples: [[normalLife]]},
		);
	});
	it("p88 plant: saved pending stop is lost; every generated JSON cut must resume unchanged", async () => {
		const {brainLife, BrainState} = await import("./brain-life.ts");
		fc.assert(
			fc.property(fc.array(message, {maxLength: 30}), (msgs) => {
				syncTest(
					brainLife,
					{},
					{
						msgs,
						encode: Schema.encodeSync(BrainState),
						decode: Schema.decodeUnknownSync(BrainState),
						equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
						seed: SEED,
					},
				);
			}),
			{seed: SEED, numRuns: 100, examples: [[[...stopInFlight]]]},
		);
	});
	// Pin p81's replacement-after-stop plant; generated events also cover the restart brake.
	it("pinned: p81 replacement-after-stop, a braked or cleanly stopped stage must never launch a replacement", async () => {
		const {brainLife} = await import("./brain-life.ts");
		propertyInvariant(
			brainLife,
			{},
			fc.array(message, {maxLength: 40}),
			({
				prev,
				next,
				cmds,
			}: {
				prev: {_tag: string};
				next: {_tag: string};
				cmds: ReadonlyArray<unknown>;
			}) =>
				!["braked", "stopped"].includes(prev._tag) ||
				(next._tag === prev._tag && cmds.length === 0),
			{seed: SEED, numRuns: 100},
		);
	});
});
