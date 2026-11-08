// P12, next/. Lifecycle events use tea's type; persisted state uses Effect Schema's _tag.
import {applyCell} from "@demlik/tea";
import {propertyInvariant} from "@demlik/tea/pbt";
import {syncTest} from "@kampus/libfabrika/testing";
import {Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";

const SEED = 119120;
const start = "process_01jc9q4w7z3m8n5r2t6v0xkb4d";
const after = "process_01jc9q4w7z3m8n5r2t6v0xkb4e";
const events = [
	{type: "started", start, after: null, build: "build-a", why: "open"},
	{type: "waiting", after: start, until: 250, why: "crash"},
	{type: "started", start: after, after: start, build: "build-a", why: "crash"},
	{type: "braked", after, why: "intensity"},
	{type: "stop"},
	{type: "stopped"},
] as const;

describe("P12 stage machine laws", () => {
	it("p88 plant: missing start or stop transition cannot finish a normal life", async () => {
		const {brainLife} = await import("./brain-life.ts");
		const [initial] = brainLife.init(null, {});
		expect(initial).toMatchObject({_tag: "starting"});
		const [online] = applyCell(brainLife, initial, events[0]);
		expect(online).toMatchObject({_tag: "online", start, build: "build-a"});
		const [stopping] = applyCell(brainLife, online, {type: "stop"});
		const [stopped] = applyCell(brainLife, stopping, {type: "stopped"});
		expect(stopped).toMatchObject({_tag: "stopped"});
	});
	it("p88 plant: saved pending stop is lost; every generated JSON cut must resume unchanged", async () => {
		const {brainLife, BrainState} = await import("./brain-life.ts");
		fc.assert(
			fc.property(fc.array(fc.constantFrom(...events), {maxLength: 30}), (msgs) => {
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
			{seed: SEED, numRuns: 100},
		);
		// A generated list need not contain this exact stop-in-flight cut.
		syncTest(
			brainLife,
			{},
			{
				msgs: [events[0], {type: "stop"}, events[1], events[2], {type: "stopped"}],
				encode: Schema.encodeSync(BrainState),
				decode: Schema.decodeUnknownSync(BrainState),
				equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
				seed: SEED,
			},
		);
	});
	it("p81 plant: a braked or cleanly stopped stage must never launch a replacement", async () => {
		const {brainLife} = await import("./brain-life.ts");
		propertyInvariant(
			brainLife,
			{},
			fc.array(fc.constantFrom(...events), {maxLength: 40}),
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
