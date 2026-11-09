// T328, next/. Structural contracts from P25 A-G until the product exports land.
// Only generic tools/drive laws use the constructed program and client below.
import {Machine} from "@demlik/tea/effect";
import {Context, Effect, Layer, PubSub, Ref, Schema, Stream, type Result} from "effect";
import {Input, Program} from "../app/program.ts";
import * as Id from "../id.ts";

export const options = {arbitrary: {seed: 119120, runs: 100, size: 100}};
export const Small = Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 10000}));
export const Save = Schema.Struct({
	note: Schema.NonEmptyString,
	base: Small,
	body: Schema.String,
	how: Schema.optionalKey(Schema.Literals(["pause", "leave", "done", "kept"])),
	from: Schema.optionalKey(Schema.Struct({note: Schema.NonEmptyString, version: Small})),
});
const ReadQuery = Schema.Struct({note: Schema.String});
export const ClientState = Schema.TaggedUnion({
	connecting: {},
	waiting: {code: Schema.String, until: Schema.Number},
	online: {key: Schema.String, person: Schema.String},
	denied: {},
	removed: {},
	failed: {why: Schema.String},
});
export class BridgeDown extends Schema.TaggedError<BridgeDown>()("BridgeDown", {
	why: Schema.Literals([
		"bad_args",
		"key",
		"storage",
		"crypto",
		"connection",
		"bad_reply",
		"recording",
	]),
}) {}
export const Delivery = Schema.TaggedUnion({
	accepted: {rev: Small, pos: Small},
	refused: {
		why: Schema.String,
		now: Schema.optionalKey(Schema.Number),
		most: Schema.optionalKey(Schema.Number),
	},
});
export const McpReply = Schema.Struct({
	content: Schema.Array(Schema.Struct({type: Schema.Literal("text"), text: Schema.String})),
	isError: Schema.optionalKey(Schema.Boolean),
});
export type McpReply = typeof McpReply.Type;
export type AnyProgram = typeof Program.schema.Type;
export interface Tool {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: {readonly type: "object"; readonly [key: string]: Schema.Json};
	readonly annotations?: {readonly readOnlyHint: true};
}
export class ToolError extends Schema.TaggedError<ToolError>()("ToolError", {
	why: Schema.Literals(["bad_program", "bad_schema", "duplicate_tool"]),
}) {}
export const Call = Schema.TaggedUnion({
	ps: {},
	input: {program: Schema.String, input: Schema.String, value: Schema.Json},
	refused: {why: Schema.String},
});
export interface ToolsModule {
	readonly listTools: (
		programs: ReadonlyArray<AnyProgram>,
	) => Result.Result<ReadonlyArray<Tool>, ToolError>;
	readonly readCall: (
		programs: ReadonlyArray<AnyProgram>,
		name: string,
		args: unknown,
	) => typeof Call.Type;
	readonly toolName: (program: string, input: string) => string;
	readonly toolNames: (program: AnyProgram) => ReadonlyArray<string>;
}
export interface HeadlessClient {
	readonly state: Effect.Effect<typeof ClientState.Type, BridgeDown>;
	readonly changes: Stream.Stream<typeof ClientState.Type, BridgeDown>;
	readonly ps: Effect.Effect<Schema.Json, BridgeDown>;
	readonly open: (
		process: typeof Id.Process.Type,
	) => Effect.Effect<
		{readonly rev: number; readonly ledger: number; readonly view: Schema.Json},
		BridgeDown
	>;
	readonly send: (request: {
		readonly process: typeof Id.Process.Type;
		readonly letter: typeof Id.Letter.Type;
		readonly m: Schema.Json;
		readonly sentAt: string;
		readonly seen: number;
	}) => Effect.Effect<typeof Delivery.Type, BridgeDown>;
	readonly close: Effect.Effect<void>;
}
export interface Drive {
	readonly tools: ReadonlyArray<Tool>;
	readonly call: (name: string, args: unknown) => Effect.Effect<McpReply, BridgeDown>;
}
export const CallReceipt = Schema.Struct({
	letter: Id.Letter,
	digest: Schema.String,
	key: Schema.String,
	ledger: Schema.String,
	target: Schema.String,
	sentAt: Schema.String,
	seen: Schema.Int,
	answer: Schema.NullOr(Schema.Json),
});
export class CallStore extends Context.Service<
	CallStore,
	{
		readonly reserve: (
			request: Omit<typeof CallReceipt.Type, "letter" | "answer">,
		) => Effect.Effect<typeof CallReceipt.Type, BridgeDown>;
		readonly settle: (
			letter: typeof Id.Letter.Type,
			answer: typeof Delivery.Type,
		) => Effect.Effect<void, BridgeDown>;
	}
>()("@kampus/libfabrika/CallStore") {}
export interface DriveModule {
	// P25's HeadlessClient contract omits the ledger identity required by the digest.
	// A ledger revision is a position, so it cannot supply that identity. Reconcile this before build.
	readonly driveFor: (
		programs: ReadonlyArray<AnyProgram>,
		client: HeadlessClient,
	) => Effect.Effect<Drive, ToolError, CallStore>;
}

// Named schema references and a union are deliberately present even in the generic fixture.
export const Payload = Schema.Union([
	Schema.Struct({shape: Schema.Literal("text"), body: Schema.String}).annotate({
		identifier: "TextPayload",
	}),
	Schema.Struct({shape: Schema.Literal("count"), count: Schema.Int}).annotate({
		identifier: "CountPayload",
	}),
]);
const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("save"), value: Save}),
	Schema.Struct({type: Schema.Literal("inc")}),
	Schema.Struct({type: Schema.Literal("extra"), value: Payload}),
	Schema.Struct({type: Schema.Literal("approve"), value: Schema.Json}),
]);
const Model = Schema.Struct({body: Schema.String, version: Small});
const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [],
	init: (loaded) => [loaded ?? {body: "", version: 0}, []],
	update: {
		save: (s) => [s, []],
		inc: (s) => [s, []],
		extra: (s) => [s, []],
		approve: (s) => [s, []],
	},
});
const Port = Schema.Struct({
	name: Schema.Literals(["save", "inc", "extra", "approve", "read", "list"]),
	hidden: Schema.Boolean,
	description: Schema.String,
});
export const Declaration = Schema.Struct({
	name: Schema.NonEmptyString,
	ports: Schema.Array(Port).check(Schema.isMaxLength(20)),
});
export const programFixture = (spec: typeof Declaration.Type): AnyProgram => {
	const inputs = Object.fromEntries(
		spec.ports.map((p) => [
			p.name,
			p.name === "read" || p.name === "list"
				? Input.cases.read.make({
						schema: ReadQuery,
						description: p.description,
						answer: (view: typeof Model.Type, query) => ({...view, note: query.note}),
					})
				: p.hidden
					? {description: p.description, personOnly: true as const}
					: p.description,
		]),
	);
	return Program.make({
		name: spec.name,
		machine,
		state: {v: 1, upgrades: []},
		view: (m) => m,
		refuse: () => null,
		inputs,
		outputs: {},
		writes: {},
		wake: () => null,
	});
};
export const notesFixture = (): AnyProgram =>
	programFixture({
		name: "notes",
		ports: [
			{name: "save", hidden: false, description: "Save a note"},
			{name: "read", hidden: false, description: "Read a note"},
			{name: "list", hidden: false, description: "List notes"},
			{name: "approve", hidden: true, description: "Person only"},
		],
	});
export const process = Id.Process.make("process_0000000000e008000000000000");
export const clientFixture = Effect.fn("test.clientFixture")(function* () {
	const state = yield* Ref.make<typeof ClientState.Type>(
		ClientState.cases.online.make({key: "checked-agent", person: "checked-person"}),
	);
	const changes = yield* PubSub.unbounded<typeof ClientState.Type>();
	const requests = yield* Ref.make<ReadonlyArray<Schema.Json>>([]);
	const view = yield* Ref.make<Schema.Json>({body: "fresh", version: 1});
	const delivery = yield* Ref.make<typeof Delivery.Type>(
		Delivery.cases.accepted.make({rev: 1, pos: 1}),
	);
	const client: HeadlessClient = {
		state: Ref.get(state),
		changes: Stream.fromPubSub(changes),
		ps: Effect.succeed([{process, name: "notes:1", program: "notes", build: "test", restarts: 0}]),
		open: () => Ref.get(view).pipe(Effect.map((view) => ({rev: 1, ledger: 1, view}))),
		send: (r) => Ref.update(requests, (all) => [...all, r]).pipe(Effect.andThen(Ref.get(delivery))),
		close: Effect.void,
	};
	return {
		client,
		setState: (next: typeof ClientState.Type) =>
			Ref.set(state, next).pipe(Effect.andThen(PubSub.publish(changes, next))),
		requests: Ref.get(requests),
		setView: (v: Schema.Json) => Ref.set(view, v),
		setDelivery: (d: typeof Delivery.Type) => Ref.set(delivery, d),
	};
});

// Captures retry requests. This is not the durable-store integration.
export const storeFixture = Effect.fn("test.storeFixture")(function* () {
	const receipts = yield* Ref.make<ReadonlyArray<typeof CallReceipt.Type>>([]);
	const generator = yield* Id.Generator;
	const layer = Layer.succeed(CallStore, {
		reserve: Effect.fn("test.reserve")(function* (r) {
			const old = (yield* Ref.get(receipts)).find((a) => a.digest === r.digest);
			if (old) return old;
			const receipt = {...r, letter: yield* generator.next(Id.Letter), answer: null};
			yield* Ref.update(receipts, (all) => [...all, receipt]);
			return receipt;
		}),
		settle: (letter, answer) =>
			Ref.update(receipts, (all) => all.map((a) => (a.letter === letter ? {...a, answer} : a))),
	});
	return {layer, receipts: Ref.get(receipts)};
});
export const text = (reply: McpReply) => reply.content.map((c) => c.text).join("\n");
export const fixtureLayer = Id.Generator.layer;
