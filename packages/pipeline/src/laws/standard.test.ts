import {readdirSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join, relative} from "node:path";
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

/** fabrika's own folder, found by its name as Node finds it: the agents' machines are in it. */
const FABRIKA = dirname(createRequire(import.meta.url).resolve("@kampus/fabrika/package.json"));
/**
 * The parts searched, each under the name its files are keyed by: this
 * package's source, and fabrika's agents. Together they are what `wip/src`
 * held before experiment 103. Since experiment 114 the agents are in
 * `@kampus/fabrika` and their laws stayed here, beside the checker, so this is
 * the one place the pipeline reads fabrika's folder: as files to count
 * machines in, never as code it imports. The shell's two machines
 * (`shell/jobs.ts`, `shell/small.ts`) have no laws yet, so the shell is not
 * searched.
 */
const PARTS: Readonly<Record<string, string>> = {
	pipeline: join(import.meta.dirname, ".."),
	agents: join(FABRIKA, "src", "agents"),
};
/**
 * Each spec must keep the suite fast, measured in states so a busy machine
 * cannot fail it (the largest spec keeps about 10,000). Longer runs belong in
 * experiment 90's script.
 */
const MOST_STATES = 20_000;

/** Every source file under a part's folder, tests left out: its key (`<part>/<path in the part>`) and its path. */
function sources(part: string, root: string, dir = root): (readonly [string, string])[] {
	return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(part, root, path);
		return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
			? [[`${part}/${relative(root, path)}`, path] as const]
			: [];
	});
}

/** How many machines each file makes. */
const machines = new Map(
	Object.entries(PARTS)
		.flatMap(([part, root]) => sources(part, root))
		.map(([file, path]) => [file, readFileSync(path, "utf8").split("defineMachine(").length - 1])
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
