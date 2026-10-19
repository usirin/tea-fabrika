import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";
import {describe, expect, it} from "vitest";
import {SPECS} from "./specs.ts";

// The laws check is standard: every tea machine in the source has a laws
// spec, and every spec holds. A machine is found by how it is made, a call to
// `defineMachine(`, so a new machine fails this test until it has laws. A
// spec passes only when no law breaks and every Msg type the machine takes
// was sent at least once: a law that holds only because nothing tried to
// break it is not a law that holds.
//
// Node's file reads, at this edge only: a test that lists source files.

const SRC = join(import.meta.dirname, "..");
/**
 * Each spec must keep the suite fast, measured in states so a busy machine
 * cannot fail it (the largest spec keeps about 10,000). Longer runs belong in
 * experiment 90's script.
 */
const MOST_STATES = 20_000;

/** Every source file under `dir`, as a path from `wip/src`, tests left out. */
function sources(dir: string): string[] {
	return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(path);
		return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
			? [relative(SRC, path)]
			: [];
	});
}

/** How many machines each file makes. */
const machines = new Map(
	sources(SRC)
		.map((file) => [file, readFileSync(join(SRC, file), "utf8").split("defineMachine(").length - 1])
		.filter((entry): entry is [string, number] => (entry[1] as number) > 0),
);

describe("every machine has laws", () => {
	it("finds the machines by how they are made", () => {
		expect(machines.size).toBeGreaterThan(0);
	});

	it("has one laws spec for each machine a file makes, and none for a file that makes none", () => {
		const specs = new Map<string, number>();
		for (const spec of SPECS) specs.set(spec.file, (specs.get(spec.file) ?? 0) + 1);
		expect(Object.fromEntries(specs)).toEqual(Object.fromEntries(machines));
	});

	it.each(SPECS.map((spec) => [spec.name, spec] as const))(
		"%s: no law broken, every Msg type sent, in a small search",
		(_, spec) => {
			const checked = spec.check();
			expect({broken: checked.broken, unsent: checked.unsent}).toEqual({broken: {}, unsent: []});
			expect(checked.states).toBeLessThan(MOST_STATES);
		},
	);
});
