// The desk in a person's object: workspaces, layouts and the focused tile, saved and restored.
//
// The shape is the app's own (`apps/fabrika/src/desk/desk.ts`'s `Saved`, and the layout tree of
// `apps/fabrika/src/desk/layout/node.ts`), copied here because the app's package exports none of
// its modules. Today the app keeps it in `desk.json` in its data folder; here it is one event on
// `desk/saved` in the person's object, the last one being the desk.
//
// Writing needs the lease on `desk`: the ledger lets only a fence write under a registered name.
// So one app at a time writes a person's desk; a second one hears `Held`.
import {Ledger, type Row} from "@kampus/fabrika-old";
import {Effect, Schema} from "effect";

// ---------------------------------------------------------------- the app's shapes

type Shown = {readonly id: string; readonly program: string};
type TileNode = {
	readonly tag: "tile";
	readonly id: string;
	readonly shows: {readonly kind: "tsh"; readonly run: Shown | null};
};
type StackNode = {
	readonly tag: "stack";
	readonly id: string;
	readonly orientation: "horizontal" | "vertical";
	readonly children: readonly (TileNode | StackNode)[];
	readonly sizes: Readonly<Record<string, number>>;
};
type LayoutTree = {readonly root: StackNode; readonly zoomed: string | null};

const isObject = (v: unknown): v is object => typeof v === "object" && v !== null;
const get = (v: unknown, k: string): unknown => (isObject(v) ? Reflect.get(v, k) : undefined);
const isNode = (v: unknown): v is TileNode | StackNode => {
	if (get(v, "tag") === "tile")
		return typeof get(v, "id") === "string" && get(get(v, "shows"), "kind") === "tsh";
	const children = get(v, "children");
	return (
		get(v, "tag") === "stack" &&
		typeof get(v, "id") === "string" &&
		Array.isArray(children) &&
		children.every(isNode) &&
		isObject(get(v, "sizes"))
	);
};
/** The app checks a layout tree with a guard too (`isLayoutTree`); this is a shorter one. */
const isLayoutTree = (v: unknown): v is LayoutTree =>
	isNode(get(v, "root")) && get(get(v, "root"), "tag") === "stack";

/** The desk as it is kept between starts, as the app's `Saved`. */
export const Saved = Schema.Struct({
	workspaces: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			layout: Schema.declare(isLayoutTree),
			focused: Schema.String,
		}),
	),
	active: Schema.String,
	next: Schema.Int,
});
export type Saved = typeof Saved.Type;

/** A desk of `workspaces` workspaces, each a row of `tiles` tiles, every few covered by a run. */
export const deskOf = (workspaces: number, tiles: number): Saved => {
	let n = 0;
	const ws = Array.from({length: workspaces}, (_, w) => {
		const children: TileNode[] = Array.from({length: tiles}, (_, t) => ({
			tag: "tile",
			id: `t${++n}`,
			shows: {kind: "tsh", run: t % 3 === 0 ? {id: `run-${w}-${t}`, program: "lane"} : null},
		}));
		const sizes = Object.fromEntries(children.map((c) => [c.id, 100 / tiles]));
		const root: StackNode = {tag: "stack", id: `s${w}`, orientation: "horizontal", children, sizes};
		return {id: `w${w + 1}`, layout: {root, zoomed: null}, focused: children[0]?.id ?? ""};
	});
	return {workspaces: ws, active: "w1", next: n + 1};
};

// ---------------------------------------------------------------- the desk on the ledger

export const DESK = "desk";
export const SAVED = `${DESK}/saved`;

const decodeSaved = Schema.decodeUnknownEffect(Schema.fromJsonString(Saved));

/** The desk a row holds, or null: a row that does not decode is no desk. */
export const savedOf = (row: Row | undefined) =>
	row === undefined
		? Effect.succeed(null)
		: decodeSaved(row.data).pipe(Effect.orElseSucceed(() => null));

/** The last desk saved, from the server: null on a first start. */
export const restore = Effect.gen(function* () {
	const l = yield* Ledger;
	const last = yield* l.readLast(SAVED, 1);
	return yield* savedOf(last[0]);
});

/**
 * Open the desk to write: register `desk` (once ever), then take its lease. Answers `save`,
 * which writes one desk under a message id: a save sent again with its id lands once.
 */
export const openDesk = (holder: string, ttlMs = 60_000) =>
	Effect.gen(function* () {
		const l = yield* Ledger;
		const reg = yield* l.register(DESK, holder);
		const last = yield* l.readLast(DESK, 1);
		const lease = yield* l.claim(DESK, holder, last[0]?.rev ?? reg.rev, ttlMs);
		const save = (desk: Saved, id: string) =>
			l.append(SAVED, "any", {kind: "saved", writer: holder, data: desk, id}, lease.fence);
		return {fence: lease.fence, save};
	});
