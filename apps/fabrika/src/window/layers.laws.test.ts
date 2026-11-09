// Today's app, T204 PR 1. The new step returns data; clocks, IDs and writes stay in adapters.
import * as fc from "fast-check";
import {assert, describe, expect, it} from "vitest";
import {readFromPage} from "../messages.ts";
import * as frameModule from "./frame.ts";
import {FRAME, type Frame, type FrameMsg, frameUpdate} from "./frame.ts";

type Layer = {_tag: "palette"} | {_tag: "popover"; item: string} | {_tag: "tooltip"; for: string};
type Via = {_tag: "key"; keys: string} | {_tag: "click"} | {_tag: "word"} | {_tag: "palette"};
type Reason =
	| "escape"
	| "outside"
	| "done"
	| "owner_gone"
	| "toggle"
	| "replacement"
	| "navigation";
type Change =
	| {_tag: "open"; layer: Layer; via: Via | null}
	| {_tag: "close"; layer: Layer; reason: Reason};
type Message = FrameMsg & {readonly via?: Via; readonly reason?: Reason};
type FrameStep = (frame: Frame, msg: Message) => readonly [Frame, readonly Change[]];
// Keep missing PR 1 behavior red at runtime without importing a nonexistent export.
const frameApi: typeof frameModule & {readonly stepFrame?: FrameStep} = frameModule;
const step: FrameStep = (frame, msg) => {
	const run = frameApi.stepFrame;
	assert(run !== undefined, "PR 1 must add the real stepFrame transition function");
	return run(frame, msg);
};
const options = {seed: 119120, numRuns: 100};
const via: fc.Arbitrary<Via> = fc.oneof(
	fc.constantFrom({_tag: "click"} as const, {_tag: "word"} as const, {_tag: "palette"} as const),
	fc.constantFrom("ctrl+b a", "cmd+k", "ctrl+a J").map((keys) => ({_tag: "key" as const, keys})),
);
const reason = fc.constantFrom<Reason>(
	"escape",
	"outside",
	"done",
	"owner_gone",
	"toggle",
	"replacement",
	"navigation",
);
const message: fc.Arbitrary<Message> = fc.oneof(
	fc.record({type: fc.constant("palette" as const), via}),
	fc.record({
		type: fc.constant("show" as const),
		what: fc.constantFrom("asks" as const, "jobs" as const, "keys" as const, "palette" as const),
		via,
	}),
	fc.record({
		type: fc.constant("item" as const),
		what: fc.constantFrom("host" as const, "agents" as const, "sync" as const),
		via,
	}),
	fc.record({type: fc.constant("query" as const), query: fc.string()}),
	fc.record({
		type: fc.constant("move" as const),
		by: fc.integer({min: -1, max: 1}),
		of: fc.nat({max: 20}),
	}),
	fc.record({type: fc.constant("close" as const), reason}),
	fc.record({
		type: fc.constant("escape" as const),
		desk: fc.record({armed: fc.boolean(), asking: fc.boolean()}),
	}),
	fc.record({type: fc.constant("ran" as const), key: fc.constantFrom("C-b z", "C-b a")}),
);
const identity = (frame: Frame): string | null => {
	const over = frame.over;
	switch (over.kind) {
		case "none":
			return null;
		case "palette":
			return `palette/${over.title}`;
		case "item":
			return `popover/${over.what}`;
		default:
			return `popover/${over.kind}`;
	}
};
const layer = (frame: Frame): Layer | null => {
	const over = frame.over;
	return over.kind === "none"
		? null
		: over.kind === "palette"
			? {_tag: "palette"}
			: {_tag: "popover", item: over.kind === "item" ? over.what : over.kind};
};
const expected = (before: Frame, after: Frame, msg: Message): readonly Change[] => {
	if (identity(before) === identity(after)) return [];
	const old = layer(before);
	const next = layer(after);
	const why: Reason =
		next !== null
			? "replacement"
			: msg.type === "escape"
				? "escape"
				: msg.type === "ran" || msg.type === "say"
					? "done"
					: msg.type === "close"
						? (msg.reason ?? "outside")
						: "toggle";
	return [
		...(old === null ? [] : [{_tag: "close" as const, layer: old, reason: why}]),
		...(next === null ? [] : [{_tag: "open" as const, layer: next, via: msg.via ?? null}]),
	];
};
const checkTransitions = (run: typeof step, moves: readonly Message[]) => {
	expect(typeof run, "PR 1 must add the real stepFrame transition function").toBe("function");
	let frame = FRAME;
	for (const msg of moves) {
		const [next, changes] = run(frame, msg);
		expect(next).toEqual(frameUpdate(frame, msg));
		expect(changes).toEqual(expected(frame, next, msg));
		frame = next;
	}
};

describe("today's layer lifecycle", () => {
	it("records replacement close before open, toggle once, and no record for unchanged state", () => {
		fc.assert(
			fc.property(fc.array(message, {minLength: 1, maxLength: 70}), (moves) => {
				checkTransitions(step, moves);
			}),
			options,
		);
	});
	it("query edits, row movement and repeated show do not open a second instance", () => {
		fc.assert(
			fc.property(fc.array(fc.string(), {minLength: 1, maxLength: 20}), via, (queries, source) => {
				checkTransitions(step, [
					{type: "show", what: "palette", via: source},
					...queries.flatMap((query): Message[] => [
						{type: "query", query},
						{type: "move", by: 1, of: 7},
						{type: "show", what: "palette", via: source},
					]),
					{type: "close", reason: "outside"},
					{type: "close", reason: "outside"},
				]);
			}),
			options,
		);
	});
	it("each supplied dismissal reason survives, and replacement never resurrects asks", () => {
		fc.assert(
			fc.property(reason, via, (why, source) => {
				checkTransitions(step, [
					{type: "show", what: "asks", via: source},
					{type: "palette", via: source},
					{type: "close", reason: why},
				]);
				const [asks] = step(FRAME, {type: "show", what: "asks"});
				const [palette] = step(asks, {type: "palette"});
				const [closed] = step(palette, {type: "escape", desk: {armed: false, asking: false}});
				expect(closed.over).toEqual({kind: "none"});
			}),
			options,
		);
	});
	it("the transition law rejects the plant that records a query edit as another opening", () => {
		fc.assert(
			fc.property(fc.string(), (query) => {
				const plant: typeof step = (frame, msg) => {
					const next = frameUpdate(frame, msg);
					const changes = expected(frame, next, msg);
					return [
						next,
						msg.type === "query"
							? [...changes, {_tag: "open", layer: {_tag: "palette"}, via: null}]
							: changes,
					];
				};
				expect(() =>
					checkTransitions(plant, [{type: "palette"}, {type: "query", query}]),
				).toThrow();
			}),
			options,
		);
	});
	it("[secrets] generated typed content never enters outgoing lifecycle reports", () => {
		fc.assert(
			fc.property(
				fc.record({
					query: fc.uuid(),
					note: fc.uuid(),
					terminal: fc.uuid(),
					moves: fc.array(message, {minLength: 1, maxLength: 30}),
				}),
				({query, note, terminal, moves}) => {
					let frame = FRAME;
					const outgoing: unknown[] = [];
					for (const [at, msg] of [
						...moves,
						{type: "palette"} as const,
						{type: "query", query: `made-up-query/${query}`} as const,
						{type: "say", note: `made-up-note/${note}`} as const,
						{type: "explain", text: `made-up-terminal/${terminal}`} as const,
					].entries()) {
						const [next, changes] = step(frame, msg);
						for (const [n, change] of changes.entries()) {
							const report = {
								type: "layer",
								id: `event-${at}-${n}`,
								instance: "instance-1",
								change,
								said: at,
							};
							expect(readFromPage(report)).toEqual({kind: "read", msg: report});
							outgoing.push(report);
						}
						frame = next;
					}
					const check = (value: unknown) => {
						const serialized = JSON.stringify(value);
						for (const secret of [query, note, terminal]) {
							expect(serialized).not.toContain(secret);
							expect(serialized).not.toContain(encodeURIComponent(secret));
						}
					};
					check(outgoing);
					expect(() => check([...outgoing, {frame: {query}}])).toThrow();
				},
			),
			options,
		);
	});
});
