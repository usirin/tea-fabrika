// Today's field records. Cores measured against 437 notes and the last 500 runs
// by the approved T342 plan. README drift advises; unknown facts stay unknown.
import {Schema} from "effect";

const Day = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
const Text = Schema.NullOr(Schema.String);
const Count = Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)));

const Note = Schema.Struct({
	id: Schema.String,
	date: Day,
	stage: Schema.String,
	kind: Schema.String,
	what: Schema.String,
	lanes: Schema.Array(Schema.Unknown),
	fix: Text,
	cause: Schema.optionalKey(Text),
	person: Schema.optionalKey(Schema.Boolean),
	primitive: Schema.optionalKey(Text),
	test: Schema.optionalKey(Text),
	links: Schema.optionalKey(Schema.Array(Schema.String)),
});

const Run = Schema.Struct({
	date: Day,
	role: Schema.String,
	model: Text,
	effort: Text,
	outcome: Text,
	note: Schema.optionalKey(Text),
	why: Text,
	tokens: Count,
	tools: Count,
	minutes: Count,
	run: Schema.optionalKey(Schema.String),
	started: Schema.optionalKey(Text),
	ended: Schema.optionalKey(Text),
	parent: Schema.optionalKey(Text),
	active: Schema.optionalKey(Count),
	costUsd: Schema.optionalKey(Count),
	listUsd: Schema.optionalKey(Count),
	billed: Schema.optionalKey(Count),
	inputTokens: Schema.optionalKey(Count),
	cachedTokens: Schema.optionalKey(Count),
	outputTokens: Schema.optionalKey(Count),
	driver_caused: Schema.optionalKey(Schema.Boolean),
});

const fields = {
	file: Schema.String,
	line: Schema.Number,
	field: Schema.String,
	reason: Schema.String,
};

export const Finding = Schema.TaggedUnion({error: fields, warning: fields});
export type Finding = typeof Finding.Type;

const words: Record<string, readonly string[]> = {
	stage: ["report", "triage", "plan", "ruling", "build", "review", "ship", "harness", "driver"],
	kind: ["failure", "friction", "cost", "success"],
	role: [
		"operator",
		"builder",
		"reviewer",
		"shipper",
		"triager",
		"planner",
		"machine",
		"acp",
		"hand",
		"session",
		"pipeline",
		"driver",
		"step",
	],
	outcome: ["merged", "pass", "fail", "triaged", "parked", "skip", "stopped"],
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Never put a value or a decoder's input-bearing error into a finding. */
export const checkRow = (file: string, line: number, value: unknown): Finding[] => {
	const error = (field: string, reason: string) =>
		Finding.cases.error.make({file, line, field, reason});
	const warning = (field: string, reason: string) =>
		Finding.cases.warning.make({file, line, field, reason});

	if (!isObject(value)) {
		return [error("row", "expected a JSON object")];
	}

	const schema = file === "field/notes.jsonl" ? Note : file === "field/runs.jsonl" ? Run : null;

	if (schema === null) {
		return [warning("row", "no detailed schema for this file")];
	}

	const failures = Object.entries(schema.fields).flatMap(([field, rule]) =>
		Schema.is(Schema.Struct({[field]: rule}))(value)
			? []
			: [error(field, "invalid or missing core field")],
	);

	if (failures.length > 0) {
		return failures;
	}

	const findings: Finding[] = [];
	const note = file === "field/notes.jsonl";
	const metadata = note
		? ["cause", "person", "primitive", "test", "links"]
		: [
				"run",
				"ticket",
				"pr",
				"started",
				"ended",
				"parent",
				"active",
				"driver_caused",
				"costUsd",
				"billed",
			];

	for (const field of metadata) {
		if (!(field in value)) {
			findings.push(warning(field, "README metadata is absent"));
		}
	}

	for (const field of note ? ["stage", "kind"] : ["role", "outcome"]) {
		if (!(words[field] ?? []).includes(String(value[field]))) {
			findings.push(warning(field, "word outside README list"));
		}
	}

	if (Array.isArray(value["lanes"]) && value["lanes"].some((lane) => typeof lane !== "string")) {
		findings.push(warning("lanes", "lane member is not text"));
	}

	const id = note ? "id" : "run";

	if (typeof value[id] === "string" && !/^\d{4}-\d{2}-\d{2}-(?:r)?\d+(?:-c\d+)?$/.test(value[id])) {
		findings.push(warning(id, "unusual record id"));
	}

	const day = value["date"];

	if (
		typeof day === "string" &&
		(!Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)
	) {
		findings.push(warning("date", "unusual calendar date"));
	}

	for (const field of ["started", "ended"]) {
		const time = value[field];

		if (
			typeof time === "string" &&
			(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(time) || !Number.isFinite(Date.parse(time)))
		) {
			findings.push(warning(field, "unusual timestamp"));
		}
	}

	for (const field of ["ticket", "pr"]) {
		const ref = value[field];

		if (ref != null && (typeof ref !== "string" || !/^[^/\s]+\/[^#\s]+#\d+$/.test(ref))) {
			findings.push(warning(field, "unusual reference"));
		}
	}

	if (
		typeof value["parent"] === "string" &&
		!/^\d{4}-\d\d-\d\d-r\d+(?:-c\d+)?$/.test(value["parent"])
	) {
		findings.push(warning("parent", "unusual parent reference"));
	}

	if (
		typeof value["started"] === "string" &&
		typeof value["ended"] === "string" &&
		Date.parse(value["ended"]) < Date.parse(value["started"])
	) {
		findings.push(warning("ended", "end precedes start"));
	}

	if (
		typeof value["active"] === "number" &&
		typeof value["minutes"] === "number" &&
		value["active"] > value["minutes"]
	) {
		findings.push(warning("active", "active time exceeds wall time"));
	}

	if (
		typeof value["cachedTokens"] === "number" &&
		typeof value["inputTokens"] === "number" &&
		value["cachedTokens"] > value["inputTokens"]
	) {
		findings.push(warning("cachedTokens", "cached count exceeds input count"));
	}

	if (
		typeof value["billed"] === "number" &&
		typeof value["inputTokens"] === "number" &&
		typeof value["outputTokens"] === "number" &&
		value["billed"] !== value["inputTokens"] + value["outputTokens"]
	) {
		findings.push(warning("billed", "billed count differs from input plus output"));
	}

	if (
		Array.isArray(value["links"]) &&
		value["links"].some((link) => typeof link === "string" && !/^https?:\/\/\S+$/.test(link))
	) {
		findings.push(warning("links", "unusual public URL"));
	}

	return findings;
};
