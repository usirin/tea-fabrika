import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {fileShelf, memoryShelf, type Shelf} from "./shelf.ts";

// A shelf keeps a run's machine states and closed inputs past the process.
// Each kind is checked the same way: what one shelf object kept, a second one
// over the same place finds, and runs on other ids find none of it.

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true});
});

const kinds: readonly [string, () => () => Shelf][] = [
	[
		"on disk",
		() => {
			const dir = mkdtempSync(join(tmpdir(), "shelf-"));
			dirs.push(dir);
			// Each call is a new shelf object over the same folder, as the next process would make.
			return () => fileShelf(dir);
		},
	],
	[
		"in memory",
		() => {
			const shelf = memoryShelf();
			return () => shelf;
		},
	],
];

describe.each(kinds)("a shelf %s", (_, place) => {
	it("keeps each machine run's state under its key, a key with a slash in it too, apart from other runs", async () => {
		const open = place();
		const first = open();
		await first.store<{n: number}>("ship:r1", "ship", "r1/1/issue/ship").save({n: 1});
		await first.store<{n: number}>("ship:r1", "ship", "other").save({n: 2});
		await first.store<{n: number}>("ship:r2", "ship", "r1/1/issue/ship").save({n: 3});

		const next = open();
		expect([...next.keys("ship:r1", "ship")].sort()).toEqual(["other", "r1/1/issue/ship"]);
		expect(await next.store("ship:r1", "ship", "r1/1/issue/ship").load()).toEqual({n: 1});
		expect(next.keys("ship:r3", "ship")).toEqual([]);
		expect(await next.store("ship:r3", "ship", "nothing").load()).toBeNull();
	});

	it("keeps a closed input before the close returns, once, by run", () => {
		const open = place();
		const first = open();
		first.close("ship:r1", "pr");
		first.close("ship:r1", "pr");

		expect(open().closed("ship:r1")).toEqual(["pr"]);
		expect(open().closed("ship:r2")).toEqual([]);
	});

	it("hands back a copy: a state changed after it was saved is not what is found", async () => {
		const shelf = place()();
		const state = {n: 1};
		await shelf.store<{n: number}>("ship:r1", "ship", "k").save(state);
		state.n = 2;

		expect(await shelf.store("ship:r1", "ship", "k").load()).toEqual({n: 1});
	});
});
