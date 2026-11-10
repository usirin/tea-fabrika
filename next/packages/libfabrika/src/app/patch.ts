// View patches, next/: the RFC 6902 operations that turn one JSON view into the next (Tier 1, P11,
// law p22). A watcher gets the whole view once, then a patch per step. Pure, and it never changes
// its inputs.
import {Result, Schema} from "effect";

/** One RFC 6902 operation. `add`, `remove` and `replace` are all a view diff needs. */
export type Patch =
	| {readonly op: "add"; readonly path: string; readonly value: unknown}
	| {readonly op: "remove"; readonly path: string}
	| {readonly op: "replace"; readonly path: string; readonly value: unknown};

/** A JSON Pointer token: `~` as `~0`, `/` as `~1` (RFC 6901). */
const token = (key: string | number): string =>
	String(key).replaceAll("~", "~0").replaceAll("/", "~1");

type Plain = {readonly [key: string]: unknown};

const isPlain = (u: unknown): u is Plain =>
	typeof u === "object" && u !== null && !Array.isArray(u);

/** Same JSON value: `Object.is` for leaves, so `0` and `-0` differ as they do to a watcher. */
const same = (a: unknown, b: unknown): boolean => {
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((one, i) => same(one, b[i]));
	}

	if (isPlain(a) && isPlain(b)) {
		const keys = Object.keys(a);
		return (
			keys.length === Object.keys(b).length &&
			keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
		);
	}

	return Object.is(a, b);
};

const walk = (path: string, before: unknown, after: unknown, out: Array<Patch>): void => {
	if (same(before, after)) {
		return;
	}

	if (Array.isArray(before) && Array.isArray(after)) {
		const common = Math.min(before.length, after.length);

		for (let i = 0; i < common; i++) {
			walk(`${path}/${i}`, before[i], after[i], out);
		}

		for (let i = common; i < after.length; i++) {
			out.push({op: "add", path: `${path}/${i}`, value: structuredClone(after[i])});
		}

		for (let i = before.length - 1; i >= common; i--) {
			out.push({op: "remove", path: `${path}/${i}`});
		}

		return;
	}

	if (isPlain(before) && isPlain(after)) {
		for (const key of Object.keys(before)) {
			if (!Object.hasOwn(after, key)) {
				out.push({op: "remove", path: `${path}/${token(key)}`});
			}
		}

		for (const [key, value] of Object.entries(after)) {
			const at = `${path}/${token(key)}`;

			if (Object.hasOwn(before, key)) {
				walk(at, before[key], value, out);
			} else {
				out.push({op: "add", path: at, value: structuredClone(value)});
			}
		}

		return;
	}

	out.push({op: "replace", path, value: structuredClone(after)});
};

/** The patches that turn `before` into `after`, in the order to apply them. None when equal. */
export const diff = (before: unknown, after: unknown): ReadonlyArray<Patch> => {
	const out: Array<Patch> = [];
	walk("", before, after, out);
	return out;
};

// Applying a patch, client side (Tier 1, P14, law p3). The client checks each candidate view before
// it installs it, so a patch is decoded first and refused whole when any part is malformed: a path
// that is not a JSON Pointer, a key that names an object's prototype, an operation outside add,
// remove and replace, or a target that is not there. It copies only the containers on each path, so
// the old view is never changed and untouched parts keep their references.

const Operation = Schema.Union([
	Schema.Struct({op: Schema.Literal("add"), path: Schema.String, value: Schema.Json}),
	Schema.Struct({op: Schema.Literal("remove"), path: Schema.String}),
	Schema.Struct({op: Schema.Literal("replace"), path: Schema.String, value: Schema.Json}),
]);

const decodeOperations = Schema.decodeUnknownResult(Schema.Array(Operation));
type Operation = typeof Operation.Type;

/** Why a patch was refused. */
export class PatchError extends Schema.TaggedError<PatchError>()("PatchError", {
	reason: Schema.Literals(["malformed", "pointer", "unsafe_key", "missing"]),
}) {}

/** The key that reaches an object's prototype when a later reader assigns through it. Other keys,
 *  `constructor` included, are only ever read as own properties here. */
const UNSAFE: ReadonlySet<string> = new Set(["__proto__"]);

/** The tokens of an RFC 6901 pointer, or why it is not one. `""` is the whole value. */
const tokens = (path: string): Result.Result<ReadonlyArray<string>, PatchError> => {
	if (path === "") {
		return Result.succeed([]);
	}

	if (!path.startsWith("/")) {
		return Result.fail(new PatchError({reason: "pointer"}));
	}

	const out: Array<string> = [];

	for (const raw of path.slice(1).split("/")) {
		if (/~(?![01])/.test(raw)) {
			return Result.fail(new PatchError({reason: "pointer"}));
		}

		const token = raw.replaceAll("~1", "/").replaceAll("~0", "~");

		if (UNSAFE.has(token)) {
			return Result.fail(new PatchError({reason: "unsafe_key"}));
		}

		out.push(token);
	}

	return Result.succeed(out);
};

const INDEX = /^(0|[1-9][0-9]*)$/;

const missing = (): Result.Result<never, PatchError> =>
	Result.fail(new PatchError({reason: "missing"}));

/** `doc` with `op` done at `path`, a new value; `doc` itself is never changed. */
const at = (
	doc: unknown,
	path: ReadonlyArray<string>,
	op: Operation,
): Result.Result<unknown, PatchError> => {
	const [key, ...rest] = path;

	if (key === undefined) {
		return op.op === "remove" ? missing() : Result.succeed(op.value);
	}

	if (Array.isArray(doc)) {
		const append = key === "-" && rest.length === 0 && op.op === "add";

		if (!append && !INDEX.test(key)) {
			return missing();
		}

		const i = append ? doc.length : Number(key);
		const copy = [...doc];

		if (rest.length > 0) {
			if (i >= doc.length) {
				return missing();
			}

			return Result.map(at(doc[i], rest, op), (child) => {
				copy[i] = child;
				return copy;
			});
		}

		if (op.op === "add") {
			if (i > doc.length) {
				return missing();
			}

			copy.splice(i, 0, op.value);
		} else if (i >= doc.length) {
			return missing();
		} else if (op.op === "remove") {
			copy.splice(i, 1);
		} else {
			copy[i] = op.value;
		}

		return Result.succeed(copy);
	}

	if (!isPlain(doc)) {
		return missing();
	}

	const has = Object.hasOwn(doc, key);

	if (rest.length > 0) {
		return has
			? Result.map(at(doc[key], rest, op), (child) => ({...doc, [key]: child}))
			: missing();
	}

	if (op.op === "add") {
		return Result.succeed({...doc, [key]: op.value});
	}

	if (!has) {
		return missing();
	}

	if (op.op === "replace") {
		return Result.succeed({...doc, [key]: op.value});
	}

	const {[key]: _gone, ...kept} = doc;
	return Result.succeed(kept);
};

/** The value after `ops`, in order, or why the patch was refused. Never throws, never mutates. */
export const applyPatch = (before: unknown, ops: unknown): Result.Result<unknown, PatchError> => {
	const decoded = decodeOperations(ops);

	if (Result.isFailure(decoded)) {
		return Result.fail(new PatchError({reason: "malformed"}));
	}

	let doc = before;

	for (const op of decoded.success) {
		const path = tokens(op.path);

		if (Result.isFailure(path)) {
			return path;
		}

		const next = at(doc, path.success, op);

		if (Result.isFailure(next)) {
			return next;
		}

		doc = next.success;
	}

	return Result.succeed(doc);
};
