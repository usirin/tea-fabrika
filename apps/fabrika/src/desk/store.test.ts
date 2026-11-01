import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {restore, type Saved} from "./desk.ts";
import {createContainer, createTile, split, tiles} from "./layout/index.ts";
import {checkStore, fromKept, type Store, toStore} from "./store.ts";

const buildSaved = (splits: readonly number[]): Saved => {
	let layout = {root: createContainer("c1", "horizontal", [createTile("t1")]), zoomed: null};
	let next = 2;
	for (const at of splits) {
		const all = [...tiles(layout.root)];
		const id = all[at % all.length]?.id ?? "t1";
		layout = {
			...split(layout, id, at % 2 === 0 ? "horizontal" : "vertical", {
				tile: `t${next}`,
				container: `c${next}`,
			}),
			zoomed: null,
		};
		next += 1;
	}
	return {workspaces: [{id: "w1", layout, focused: "t1"}], active: "w1", next};
};

const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("the store's law: each id appears exactly once in a layout", () => {
	it("holds on any desk a person can make, and the store comes back as the same desk", () => {
		fc.assert(
			fc.property(fc.array(fc.nat(50), {maxLength: 16}), (splits) => {
				const saved = buildSaved(splits);
				const store = toStore(saved);
				expect(checkStore(store)).toEqual([]);
				expect(fromKept(wire(store))).toEqual(saved);
			}),
		);
	});

	const plant = (edit: (s: Store) => Store) => edit(toStore(buildSaved([0, 1, 2])));

	it("sees a tile placed twice, and refuses it", () => {
		const broken = plant((s) => {
			const ws = s.workspaces[0];
			if (ws === undefined || ws.layout.root.tag !== "container") return s;
			const root = {
				...ws.layout.root,
				children: [...ws.layout.root.children, {tag: "tile" as const, id: "t1"}],
			};
			return {...s, workspaces: [{...ws, layout: {...ws.layout, root}}]};
		});
		expect(checkStore(broken)).toContainEqual({kind: "twice", id: "t1"});
		expect(fromKept(wire(broken))).toBe(null);
		expect(restore(fromKept(wire(broken)))).toBe(null);
	});

	it("sees a layout naming a tile with no record, and refuses it", () => {
		const broken = plant((s) => {
			const {t1: _gone, ...rest} = s.tiles;
			return {...s, tiles: rest};
		});
		expect(checkStore(broken)).toContainEqual({kind: "no-record", id: "t1"});
		expect(fromKept(wire(broken))).toBe(null);
	});

	it("sees a record no layout names, and a record under the wrong id", () => {
		const t1 = createTile("t1");
		const broken = plant((s) => ({...s, tiles: {...s.tiles, t99: t1}}));
		expect(checkStore(broken)).toContainEqual({kind: "orphan", id: "t99"});
		expect(checkStore(broken)).toContainEqual({kind: "wrong-id", id: "t99"});
	});
});

describe("a kept file", () => {
	it("from before the store passes through, so an old desk still restores", () => {
		const old = wire(buildSaved([0, 1]));
		expect(fromKept(old)).toBe(old);
		expect(restore(fromKept(old))).not.toBe(null);
	});

	it("written as a store restores as the same desk the tree would", () => {
		const saved = buildSaved([0, 1, 4]);
		expect(restore(fromKept(wire(toStore(saved))))).toEqual(restore(wire(saved)));
	});

	it("that does not read as a store is refused", () => {
		expect(fromKept({tiles: 3})).toBe(null);
	});
});
