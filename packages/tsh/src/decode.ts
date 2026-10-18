import type {JsonSchema, Shape} from "../../tea-program/src/shape.ts";
import {didYouMean} from "./did-you-mean.ts";

// A word on a line, read as a value of a program's own shape. The word is
// tried as it is first, then as JSON:
//
//   --mode read           "read"                       (a string that fits)
//   --budget 2            2                            ("2" does not fit a number; JSON 2 does)
//   ask='{"id":"a",...}'  {id: "a", ...}               (JSON)
//
// The shape decides; tsh never converts a value itself. So a value reaches a
// program exactly as its own schema took it, and a word that fits neither way
// is refused in the schema's own words, before anything runs.

export type Read =
	| {readonly kind: "value"; readonly value: unknown}
	| {readonly kind: "refused"; readonly why: string; readonly didYouMean?: string};

/** The JSON a word holds, or nothing when it is not JSON. */
function json(text: string): {readonly value: unknown} | null {
	try {
		return {value: JSON.parse(text)};
	} catch {
		return null;
	}
}

/** Does the shape take some strings? Then a word that does not fit is best explained as a string. */
const takesStrings = (schema: JsonSchema | undefined): boolean => {
	if (schema === undefined) return true;
	if (schema.type === "string" || (Array.isArray(schema.type) && schema.type.includes("string")))
		return true;
	const anyOf = schema.anyOf;
	return Array.isArray(anyOf) && anyOf.some((s) => takesStrings(s as JsonSchema));
};

/** Read one word as a value of `shape`: as it is, then as JSON. */
export function readValue(shape: Shape<unknown>, text: string): Read {
	if (shape.check(text)) return {kind: "value", value: text};
	const parsed = json(text);
	if (parsed !== null && shape.check(parsed.value)) return {kind: "value", value: parsed.value};
	const why =
		parsed === null || takesStrings(shape.json) ? shape.problem(text) : shape.problem(parsed.value);
	const guess = didYouMean(text, choices(shape.json).map(String));
	return {
		kind: "refused",
		why: why ?? "it does not fit",
		...(guess === undefined ? {} : {didYouMean: guess}),
	};
}

/** The values a shape lists, when it is one of a few: an enum, a const, a boolean. Empty: any value of a type. */
export function choices(schema: JsonSchema | undefined): readonly (string | number | boolean)[] {
	if (schema === undefined) return [];
	const plain = (v: unknown): v is string | number | boolean =>
		typeof v === "string" || typeof v === "number" || typeof v === "boolean";
	if (Array.isArray(schema.enum)) return schema.enum.filter(plain);
	if (plain(schema.const)) return [schema.const];
	if (schema.type === "boolean") return [true, false];
	if (Array.isArray(schema.anyOf)) return schema.anyOf.flatMap((s) => choices(s as JsonSchema));
	return [];
}

/** At most this many choices, fields or union members in a short form; the rest are counted. */
const FEW = 4;
/** The most characters an object's short form takes with its fields' types; wider, it shows their names. */
const WIDE = 80;

/** A union's members, with a union inside it opened: `(a | b) | null` is `a | b | null`. */
const membersOf = (schema: JsonSchema): readonly JsonSchema[] =>
	Array.isArray(schema.anyOf)
		? (schema.anyOf as JsonSchema[]).flatMap((m) => (Array.isArray(m.anyOf) ? membersOf(m) : [m]))
		: [schema];

const fieldsOf = (schema: JsonSchema) => {
	const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
	const required = new Set(Array.isArray(schema.required) ? schema.required : []);
	return Object.entries(props).map(([name, s]) => ({
		name,
		schema: s,
		optional: !required.has(name),
	}));
};

/** The field every member of a union of objects fixes to one value, like `kind`: the union's tag. */
function tagOf(members: readonly JsonSchema[]): string | null {
	const [first] = members;
	if (first === undefined || members.some((m) => m.type !== "object")) return null;
	const fixed = (m: JsonSchema, name: string) => {
		const s = ((m.properties ?? {}) as Record<string, JsonSchema>)[name];
		return s !== undefined && choices(s).length === 1;
	};
	return fieldsOf(first).find((f) => members.every((m) => fixed(m, f.name)))?.name ?? null;
}

const counted = (items: readonly string[], noun: string, join: string) =>
	items.length > FEW
		? `${items.slice(0, FEW - 1).join(join)}${join}… (${items.length} ${noun})`
		: items.join(join);

const scalar = (schema: JsonSchema): string => {
	const limits = [
		typeof schema.exclusiveMinimum === "number" ? `> ${schema.exclusiveMinimum}` : null,
		typeof schema.minimum === "number" ? `>= ${schema.minimum}` : null,
		typeof schema.exclusiveMaximum === "number" ? `< ${schema.exclusiveMaximum}` : null,
		typeof schema.maximum === "number" ? `<= ${schema.maximum}` : null,
	].filter((x) => x !== null);
	const name = typeof schema.type === "string" ? schema.type : "any";
	return limits.length === 0 ? name : `${name} ${limits.join(" ")}`;
};

/**
 * A shape in a few words, for `--describe` and refusals: `"read" | "write"`,
 * `number > 0`, `{id: string, pr: string}`. Short on purpose: a long list
 * is cut and counted, an object inside an object shows its field names only,
 * and a union of objects shows its tag. `--describe <program> <name>` prints
 * one shape whole (`shapeLines`).
 */
export function typeOf(schema: JsonSchema | undefined, depth = 0): string {
	if (schema === undefined) return "any (no JSON Schema)";
	const listed = choices(schema);
	if (listed.length > 0 && schema.type !== "boolean")
		return counted(
			listed.map((v) => JSON.stringify(v)),
			"values",
			" | ",
		);
	if (Array.isArray(schema.anyOf)) {
		const all = membersOf(schema);
		const members = all.filter((m) => m.type !== "null");
		const [only] = members;
		if (members.length < all.length)
			return `${members.length === 1 && only !== undefined ? typeOf(only, depth) : typeOf({anyOf: members}, depth)} | null`;
		const tag = tagOf(members);
		if (tag !== null) {
			const tags = [
				...new Set(
					members.map((m) =>
						String(choices(((m.properties ?? {}) as Record<string, JsonSchema>)[tag])[0]),
					),
				),
			];
			return `one of ${members.length} by ${tag}: ${counted(tags, "kinds", ", ")}`;
		}
		return counted(
			members.map((s) => typeOf(s, depth + 1)),
			"shapes",
			" | ",
		);
	}
	if (schema.type === "object") {
		const fields = fieldsOf(schema);
		const braced = (shown: readonly string[]) =>
			fields.length > FEW
				? `{${shown.slice(0, FEW).join(", ")}, … (${fields.length} fields)}`
				: `{${shown.join(", ")}}`;
		const names = braced(fields.map((f) => `${f.name}${f.optional ? "?" : ""}`));
		if (depth > 0) return names;
		const typed = braced(
			fields.map((f) => `${f.name}${f.optional ? "?" : ""}: ${typeOf(f.schema, depth + 1)}`),
		);
		// Typed fields when they read at a glance; the names alone when they would make a wall.
		return typed.length <= WIDE ? typed : names;
	}
	if (schema.type === "array")
		return `${typeOf(schema.items as JsonSchema | undefined, depth + 1)}[]`;
	return scalar(schema);
}

/** One shape whole, one field or member a line, indented: what `--describe <program> <name>` prints. */
export function shapeLines(schema: JsonSchema | undefined, indent = ""): readonly string[] {
	if (schema === undefined) return [`${indent}any (no JSON Schema)`];
	const listed = choices(schema);
	if (listed.length > 0 && schema.type !== "boolean") {
		const values = listed.map((v) => JSON.stringify(v));
		const line = values.join(" | ");
		// A long list reads one value a line.
		return line.length <= WIDE
			? [`${indent}${line}`]
			: [`${indent}one of:`, ...values.map((v) => `${indent}  - ${v}`)];
	}
	if (Array.isArray(schema.anyOf)) {
		const members = membersOf(schema);
		return [
			`${indent}one of:`,
			...members.flatMap((m) => {
				const [head, ...rest] = shapeLines(m, `${indent}    `);
				return [`${indent}  - ${(head ?? "").trimStart()}`, ...rest];
			}),
		];
	}
	if (schema.type === "object" && fieldsOf(schema).length === 0) return [`${indent}{}`];
	if (schema.type === "object")
		return fieldsOf(schema).flatMap((f) => {
			const inner = shapeLines(f.schema, `${indent}  `);
			const label = `${indent}${f.name}${f.optional ? "?" : ""}:`;
			const [head] = inner;
			// A plain field fits on its own line; an object or a union opens below its name.
			return inner.length === 1 && head !== undefined
				? [`${label} ${head.trimStart()}`]
				: [label, ...inner];
		});
	if (schema.type === "array") {
		const inner = shapeLines(schema.items as JsonSchema | undefined, `${indent}  `);
		return inner.length === 1
			? [`${indent}${(inner[0] ?? "").trimStart()}[]`]
			: [`${indent}a list of:`, ...inner];
	}
	return [`${indent}${scalar(schema)}`];
}
