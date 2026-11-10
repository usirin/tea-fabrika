// P14, next/ (Tier 1, ticket 286): the fixed layout folds locally (docs/plan "Layout and key
// tables"). Written before `desktop/layout.ts`; the module loads by `import()` in each test.
//
// The shape these laws hold the module to, from the plan's sketch (the build may add more):
// - `Layout`: a Schema for a checked percentage tree. A tile is `{_tag: "tile", id, pid}`; a split is
//   `{_tag: "split", dir: "row" | "col", at, a, b}` with `0 < at < 100`. Tile ids are unique.
// - `tilesIn(tree)`: every tile, `{id, pid}`, in order.
// - `rectangles(tree, {w, h})`: one `{id, x, y, w, h}` per tile, the tree laid out in that size.
// - `fold(tree, {w, h}, focused)`: `{shown, folded}`. `shown` are rectangles that fit `MINIMUM`,
//   `folded` the ids that do not fit. Local to the call: the tree and the other tabs are untouched.
// - `MINIMUM`: `{width, height}`, the least size a tile may be shown at.
import {describe, expect, it} from "@effect/vitest";
import {Schema} from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const LOAD = "./layout.ts";
const opts = {seed: SEED, numRuns: 300};

type Tree =
	| {readonly _tag: "tile"; readonly id: string; readonly pid: string}
	| {
			readonly _tag: "split";
			readonly dir: "row" | "col";
			readonly at: number;
			readonly a: Tree;
			readonly b: Tree;
	  };

type Rect = {
	readonly id: string;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
};

interface LayoutApi {
	readonly Layout: Schema.Codec<Tree, unknown>;
	readonly MINIMUM: {readonly width: number; readonly height: number};
	readonly tilesIn: (t: Tree) => ReadonlyArray<{readonly id: string; readonly pid: string}>;
	readonly rectangles: (t: Tree, size: {w: number; h: number}) => ReadonlyArray<Rect>;
	readonly fold: (
		t: Tree,
		size: {w: number; h: number},
		focused: string | null,
	) => {readonly shown: ReadonlyArray<Rect>; readonly folded: ReadonlyArray<string>};
}

const api = async (): Promise<LayoutApi> => (await import(LOAD)) as LayoutApi;

/** A checked percentage tree: the shape from generated depth and splits, ids numbered so each is unique. */
const shapes: fc.Arbitrary<unknown> = fc.letrec<{node: unknown}>((tie) => ({
	node: fc.oneof(
		{depthSize: "small", maxDepth: 3},
		fc.constant("tile"),
		fc.record({
			dir: fc.constantFrom("row", "col"),
			at: fc.integer({min: 5, max: 95}),
			a: tie("node"),
			b: tie("node"),
		}),
	),
})).node;

const number = (shape: unknown, next: {n: number} = {n: 0}): Tree => {
	if (shape === "tile") {
		const n = next.n++;
		return {_tag: "tile", id: `tile_${n}`, pid: `process_${n % 2}`};
	}

	const s = shape as {dir: "row" | "col"; at: number; a: unknown; b: unknown};
	return {_tag: "split", dir: s.dir, at: s.at, a: number(s.a, next), b: number(s.b, next)};
};

const trees: fc.Arbitrary<Tree> = shapes.map((s) => number(s));
const sizes = fc.record({w: fc.integer({min: 1, max: 2400}), h: fc.integer({min: 1, max: 1600})});

const deepFreeze = <T>(value: T): T => {
	if (typeof value === "object" && value !== null) {
		for (const v of Object.values(value)) {deepFreeze(v);}

		Object.freeze(value);
	}

	return value;
};

const area = (rs: ReadonlyArray<Rect>): number => rs.reduce((n, r) => n + r.w * r.h, 0);

const overlap = (p: Rect, q: Rect): boolean =>
	p.x < q.x + q.w - 1e-6 &&
	q.x < p.x + p.w - 1e-6 &&
	p.y < q.y + q.h - 1e-6 &&
	q.y < p.y + p.h - 1e-6;

type Check = (
	a: LayoutApi,
	tree: Tree,
	size: {w: number; h: number},
	focused: string | null,
) => void;

const checks: Readonly<Record<string, Check>> = {
	"every tile is shown or folded exactly once, and shown ones fit": (a, tree, size, focused) => {
		const out = a.fold(structuredClone(tree), size, focused);
		const all = a
			.tilesIn(tree)
			.map((t) => t.id)
			.sort();
		expect([...out.shown.map((r) => r.id), ...out.folded].sort()).toEqual(all);

		for (const r of out.shown) {
			expect(r.w).toBeGreaterThanOrEqual(a.MINIMUM.width - 1e-6);
			expect(r.h).toBeGreaterThanOrEqual(a.MINIMUM.height - 1e-6);
			expect(r.x).toBeGreaterThanOrEqual(-1e-6);
			expect(r.y).toBeGreaterThanOrEqual(-1e-6);
			expect(r.x + r.w).toBeLessThanOrEqual(size.w + 1e-6);
			expect(r.y + r.h).toBeLessThanOrEqual(size.h + 1e-6);
		}

		for (const [i, p] of out.shown.entries())
			{for (const q of out.shown.slice(i + 1)) expect(overlap(p, q)).toBe(false);}
	},
	"the input tree is never changed": (a, tree, size, focused) => {
		const frozen = deepFreeze(structuredClone(tree));
		a.fold(frozen, size, focused);
		a.rectangles(frozen, size);
		expect(frozen).toEqual(tree);
	},
	"a window that fits everything folds nothing, and the rectangles fill it": (a, tree, size) => {
		const big = {w: Math.max(size.w, 4000), h: Math.max(size.h, 4000)};
		const out = a.fold(tree, big, null);
		const fits = a
			.rectangles(tree, big)
			.every((r) => r.w >= a.MINIMUM.width && r.h >= a.MINIMUM.height);
		// A tree that fits the big window folds nothing and fills it; one that does not is not this law's.
		expect(fits ? out.folded : []).toEqual([]);
		expect(fits ? Math.abs(area(out.shown) - big.w * big.h) / (big.w * big.h) : 0).toBeLessThan(
			1e-3,
		);
	},
	"a fold is this call's own: the same input gives the same answer after another tab's size": (
		a,
		tree,
		size,
		focused,
	) => {
		const first = a.fold(tree, size, focused);
		a.fold(tree, {w: size.w + 777, h: Math.max(1, size.h - 3)}, null);
		a.fold(tree, {w: 1, h: 1}, focused);
		expect(a.fold(tree, size, focused)).toEqual(first);
	},
	"the focused tile is shown whenever any tile is": (a, tree, size, focused) => {
		const ids = a.tilesIn(tree).map((t) => t.id);
		const pick =
			focused === null
				? null
				: (ids[ids.length > 0 ? Math.abs(focused.length) % ids.length : 0] ?? null);
		const out = a.fold(tree, size, pick);
		// The focused tile is shown whenever it is shown with no focus at all: focus never costs a tile.
		const shownUnfocused = a.fold(tree, size, null).shown.some((r) => r.id === pick);
		const shownFocused = out.shown.some((r) => r.id === pick);
		expect(pick === null || !shownUnfocused ? true : shownFocused).toBe(true);
	},
};

describe("layout: the fixed layout folds locally", () => {
	for (const [name, check] of Object.entries(checks)) {
		it(name, async () => {
			const a = await api();
			fc.assert(
				fc.property(trees, sizes, fc.option(fc.string({maxLength: 3}), {nil: null}), (t, s, f) =>
					check(a, t, s, f),
				),
				opts,
			);
		});
	}

	it("tilesIn lists every tile once, in order, and rectangles gives one rectangle per tile", async () => {
		const a = await api();
		fc.assert(
			fc.property(trees, sizes, (tree, size) => {
				const ids = a.tilesIn(tree).map((t) => t.id);
				expect(new Set(ids).size).toBe(ids.length);
				expect(a.rectangles(tree, size).map((r) => r.id)).toEqual(ids);
			}),
			opts,
		);
	});

	it("a checked tree decodes, and a split outside 0..100 or a repeated tile id is refused", async () => {
		const a = await api();
		fc.assert(
			fc.property(trees, fc.constantFrom(0, 100, -5, 140, Number.NaN), (tree, at) => {
				expect(Schema.decodeUnknownSync(a.Layout)(tree)).toEqual(tree);
				const bad: Tree = {
					_tag: "split",
					dir: "row",
					at,
					a: tree,
					b: {_tag: "tile", id: "tile_x", pid: "process_x"},
				};
				expect(() => Schema.decodeUnknownSync(a.Layout)(bad)).toThrow();
				const twice: Tree = {_tag: "split", dir: "col", at: 50, a: tree, b: tree};
				expect(() => Schema.decodeUnknownSync(a.Layout)(twice)).toThrow();
			}),
			opts,
		);
	});

	it("good thing: the generated runs include a lone tile, many tiles, folding and a full fit", async () => {
		const a = await api();
		const seen = {lone: 0, many: 0, folds: 0, fits: 0};
		fc.assert(
			fc.property(trees, sizes, (tree, size) => {
				const n = a.tilesIn(tree).length;
				const out = a.fold(tree, size, null);

				if (n === 1) {seen.lone++;}

				if (n >= 3) {seen.many++;}

				if (out.folded.length > 0) {seen.folds++;}

				if (n > 1 && out.folded.length === 0) {seen.fits++;}
			}),
			opts,
		);

		for (const [name, count] of Object.entries(seen)) {expect(count, name).toBeGreaterThan(0);}
	});

	// Plants (layout): change the shared tree; lose a folded tile; give another tab this tab's size.
	it("plant: a fold that loses its folded tiles is caught", async () => {
		const real = await api();
		const broken: LayoutApi = {...real, fold: (t, s, f) => ({...real.fold(t, s, f), folded: []})};
		expect(() =>
			fc.assert(
				fc.property(trees, sizes, (t, s) =>
					checks["every tile is shown or folded exactly once, and shown ones fit"]?.(
						broken,
						t,
						s,
						null,
					),
				),
				opts,
			),
		).toThrow();
	});
	it("plant: a fold that changes the shared tree is caught", async () => {
		const real = await api();
		const broken: LayoutApi = {
			...real,
			fold: (t, s, f) => {
				if (t._tag === "split") {(t as {a: Tree}).a = t.b;}

				return real.fold(t, s, f);
			},
		};
		expect(() =>
			fc.assert(
				fc.property(trees, sizes, (t, s) =>
					checks["the input tree is never changed"]?.(broken, t, s, null),
				),
				opts,
			),
		).toThrow();
	});
	it("plant: a fold that remembers another tab's size is caught", async () => {
		const real = await api();
		let last: {w: number; h: number} | null = null;
		const broken: LayoutApi = {
			...real,
			fold: (t, s, f) => {
				const use = last ?? s;
				last = s;
				return real.fold(t, use, f);
			},
		};
		expect(() =>
			fc.assert(
				fc.property(trees, sizes, (t, s) =>
					checks[
						"a fold is this call's own: the same input gives the same answer after another tab's size"
					]?.(broken, t, s, null),
				),
				opts,
			),
		).toThrow();
	});
});
