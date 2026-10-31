import {Option, Schema} from "effect";

// JSON patches (RFC 6902, the three ops a view needs): how a view reaches a window after its whole
// copy (A3). `diff` is the brain's side, `applyPatch` the window's.
//
//   diff({n: 1}, {n: 2})                                  [{op: "replace", path: "/n", value: 2}]
//   applyPatch({n: 1}, [{op: "replace", path: "/n", value: 2}])    {n: 2}

export const PatchOp = Schema.Union([
	Schema.Struct({op: Schema.Literal("add"), path: Schema.String, value: Schema.Unknown}),
	Schema.Struct({op: Schema.Literal("replace"), path: Schema.String, value: Schema.Unknown}),
	Schema.Struct({op: Schema.Literal("remove"), path: Schema.String}),
]);
export type PatchOp = typeof PatchOp.Type;

/** A plain JSON object, told apart from an array and a primitive. */
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
type JsonObject = typeof JsonObject.Type;

const asObject = (value: unknown): Option.Option<JsonObject> =>
	Array.isArray(value) ? Option.none() : Schema.decodeUnknownOption(JsonObject)(value);

const JsonArray = Schema.Array(Schema.Unknown);
const asArray = (value: unknown): Option.Option<readonly unknown[]> =>
	Schema.decodeUnknownOption(JsonArray)(value);

const pointer = (key: string): string => key.replaceAll("~", "~0").replaceAll("/", "~1");
const unpointer = (key: string): string => key.replaceAll("~1", "/").replaceAll("~0", "~");

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The ops that turn `from` into `to`. Keys that are in both are walked; the rest replaced. */
export const diff = (from: unknown, to: unknown, path = ""): readonly PatchOp[] => {
	const fromArray = asArray(from);
	const toArray = asArray(to);
	if (Option.isSome(fromArray) && Option.isSome(toArray)) {
		const a = fromArray.value;
		const b = toArray.value;
		const shared = Math.min(a.length, b.length);
		const ops: PatchOp[] = [];
		for (let i = 0; i < shared; i++) ops.push(...diff(a[i], b[i], `${path}/${i}`));
		for (let i = shared; i < b.length; i++)
			ops.push({op: "add", path: `${path}/${i}`, value: b[i]});
		for (let i = a.length - 1; i >= shared; i--) ops.push({op: "remove", path: `${path}/${i}`});
		return ops;
	}
	const fromObject = asObject(from);
	const toObject = asObject(to);
	if (Option.isSome(fromObject) && Option.isSome(toObject)) {
		const a = fromObject.value;
		const b = toObject.value;
		const ops: PatchOp[] = [];
		for (const key of Object.keys(a)) {
			const at = `${path}/${pointer(key)}`;
			if (!Object.hasOwn(b, key)) ops.push({op: "remove", path: at});
			else ops.push(...diff(a[key], b[key], at));
		}
		for (const key of Object.keys(b)) {
			if (!Object.hasOwn(a, key))
				ops.push({op: "add", path: `${path}/${pointer(key)}`, value: b[key]});
		}
		return ops;
	}
	return same(from, to) ? [] : [{op: "replace", path, value: to}];
};

const applyAt = (doc: unknown, keys: readonly string[], op: PatchOp): unknown => {
	const [key, ...rest] = keys;
	if (key === undefined) return op.op === "remove" ? undefined : op.value;
	const array = asArray(doc);
	if (Option.isSome(array)) {
		const items = [...array.value];
		const at = key === "-" ? items.length : Number(key);
		if (rest.length > 0) items[at] = applyAt(items[at], rest, op);
		else if (op.op === "add") items.splice(at, 0, op.value);
		else if (op.op === "remove") items.splice(at, 1);
		else items[at] = op.value;
		return items;
	}
	const object = Option.getOrElse(asObject(doc), (): JsonObject => ({}));
	// Built from entries, so a key named `__proto__` stays a key and sets no prototype.
	const others = Object.entries(object).filter(([k]) => k !== key);
	if (rest.length > 0) {
		const inner = Object.hasOwn(object, key) ? object[key] : undefined;
		return Object.fromEntries([...others, [key, applyAt(inner, rest, op)]]);
	}
	return op.op === "remove"
		? Object.fromEntries(others)
		: Object.fromEntries([...others, [key, op.value]]);
};

/** `doc` with the ops applied in order; `doc` itself stays as it was. */
export const applyPatch = (doc: unknown, ops: readonly PatchOp[]): unknown =>
	ops.reduce<unknown>(
		(current, op) => applyAt(current, op.path.split("/").slice(1).map(unpointer), op),
		doc,
	);
