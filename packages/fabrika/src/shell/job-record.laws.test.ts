import {defineMachine} from "@demlik/tea";
import {Cause, Effect, Redacted, Schema} from "effect";
import {Miniflare} from "miniflare";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {newToken} from "../host/door.ts";
import {recordsHttp} from "../host/http.ts";
import {recordInside, recordsInside} from "../host/inside.ts";
import {jobStorage} from "../host/traces.ts";
import {ledgerOptions} from "../host/worker-options.ts";
import {defineProgram, kind, start} from "../program/program.ts";
import {memoryStorage, type StateSchema, type Storage} from "../program/storage.ts";
import {runTraceId} from "../program/trace-id.ts";
import {tracing} from "./trace/otel.ts";

// The record's secret law: a machine whose state holds a secret (an Effect `Redacted`) writes no
// secret text into any row of any table of its job's record. Not a comment or a review rule: the
// law runs a real program against the Miniflare twin, then reads every row back and looks for
// the secret's text.
//
// Why the state is refused rather than kept: Effect Schema has three ways to write a Redacted,
// and none both hides the secret and reads back (../program/secrets.ts):
//
//   Schema.Redacted(S)                     the object itself; as JSON, "<redacted>", which never reads back
//   Schema.RedactedFromValue(S)            the secret, as plain text
//   RedactedFromValue(S, {disallowEncode}) fails to write at all
//   Schema.toCodecJson(...)                the secret, as plain text, for either of the first two
//
// So every storage refuses a state that holds one, before its schema sees it, and the run fails
// in words that say why. A Msg that holds one is kept as a step, and JSON writes it "<redacted>":
// its value lives in a WeakMap Effect keeps, so no transport can carry it.

const SECRET = "sk-test-the-secret-text-4b9e";
const LEDGER = "demo";
const door = newToken("fabrika_l_");
let mf: Miniflare;
let url = "";

beforeAll(async () => {
	mf = new Miniflare(
		await ledgerOptions({
			persist: false,
			direct: 0,
			door: {kind: "local", person: "owner", secret: door},
		}),
	);
	await mf.ready;
	url = (await mf.unsafeGetDirectURL()).origin;
});
afterAll(async () => {
	await mf.dispose();
});

type Vault = {readonly key: Redacted.Redacted<string> | null; readonly uses: number};
type VaultMsg =
	| {readonly type: "hold"; readonly key: Redacted.Redacted<string>}
	| {readonly type: "use"; readonly key: Redacted.Redacted<string>};

const vault = defineMachine({
	types: {model: {} as Vault, msg: {} as VaultMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {key: null, uses: 0}, []],
	update: {
		hold: (s, m) => [{...s, key: m.key}, []],
		use: (s) => [{...s, uses: s.uses + 1}, []],
	},
});

/** A program with one machine, kept through `state`, that is told `msgs`. */
const keeper = (state: StateSchema<Vault>, msgs: readonly VaultMsg[]) =>
	defineProgram({
		name: "keeper",
		description: "Keeps what it is told.",
		inputs: {},
		outputs: {},
		machines: {
			vault: kind({
				machine: vault,
				state,
				parent: "main",
				options: () => ({ctx: undefined}),
				drawing: () => ({name: "vault", steps: {}}),
				status: (s) => `uses ${s.uses}`,
			}),
		},
		main: ({machines}) =>
			Effect.gen(function* () {
				const one = yield* machines.vault.get("v").start();
				for (const msg of msgs) yield* one.dispatch(msg);
			}).pipe(Effect.scoped),
	});

/** The vault's state, its key written by `key`. */
const vaultOf = <E>(key: Schema.Codec<Redacted.Redacted<string>, E>) =>
	Schema.Struct({key: Schema.NullOr(key), uses: Schema.Int});
const VaultState = vaultOf(Schema.Redacted(Schema.String));

/** Each way Effect Schema writes a Redacted. */
const SCHEMAS: ReadonlyArray<readonly [string, StateSchema<Vault>]> = [
	["Schema.Redacted", VaultState],
	["Schema.RedactedFromValue", vaultOf(Schema.RedactedFromValue(Schema.String))],
	[
		"RedactedFromValue, disallowEncode",
		vaultOf(Schema.RedactedFromValue(Schema.String, {disallowEncode: true})),
	],
	["toCodecJson over Schema.Redacted", Schema.toCodecJson(VaultState)],
];

/** Two ways to reach a record: over HTTP through the door, as a host does, and past it. */
const TRANSPORTS = ["http", "inside"] as const;

const storageFor = (how: (typeof TRANSPORTS)[number], trace: string) =>
	how === "http"
		? Effect.map(recordsHttp({url, ledger: LEDGER, token: door}), (calls) =>
				jobStorage(calls, trace),
			)
		: Effect.succeed(jobStorage(recordsInside(mf, LEDGER, "user:owner"), trace));

/** Run `program` kept in `storage`, its spans sent to the record too: how it ended. */
const runIn = (program: ReturnType<typeof keeper>, run: string, storage: Storage) =>
	Effect.gen(function* () {
		const started = yield* start(program, {}, {}, {id: run, storage});
		if (started.kind !== "running") return yield* Effect.die("keeper did not start");
		return yield* started.run.ended;
	}).pipe(
		Effect.withSpan("keeper"),
		Effect.scoped,
		Effect.provide(
			tracing(`${url}/${LEDGER}`, {}, {authorization: `Bearer ${Redacted.value(door)}`}),
		),
	);

/** Every row of every table of the record, as text. */
const everyRow = async (trace: string) =>
	JSON.stringify(await recordInside(mf, LEDGER, trace).dump());

const hold: VaultMsg = {type: "hold", key: Redacted.make(SECRET)};
const use: VaultMsg = {type: "use", key: Redacted.make(SECRET)};

describe("a job's record keeps no secret", () => {
	for (const how of TRANSPORTS)
		for (const [name, schema] of SCHEMAS)
			it(`refuses a state that holds one (${name}, ${how}), and no row holds its text`, async () => {
				const run = `keeper-${how}-${name.replaceAll(/[^a-z]/gi, "")}`;
				const trace = runTraceId(run);
				const ended = await Effect.runPromise(
					Effect.flatMap(storageFor(how, trace), (storage) =>
						runIn(keeper(schema, [hold, use]), run, storage),
					).pipe(Effect.scoped),
				);
				const rows = await everyRow(trace);
				// The run was written, so the law reads real rows, not an empty record.
				expect(rows).toContain(run);
				expect(rows).not.toContain(SECRET);
				expect(ended.kind).toBe("failed");
				if (ended.kind === "failed") expect(Cause.pretty(ended.cause)).toContain("holds a secret");
			}, 30_000);

	for (const how of TRANSPORTS)
		it(`keeps a Msg that holds one as "<redacted>" (${how})`, async () => {
			const run = `keeper-msg-${how}`;
			const trace = runTraceId(run);
			const ended = await Effect.runPromise(
				Effect.flatMap(storageFor(how, trace), (storage) =>
					runIn(keeper(VaultState, [use, use]), run, storage),
				).pipe(Effect.scoped),
			);
			const rows = await everyRow(trace);
			expect(rows).not.toContain(SECRET);
			if (how === "http") {
				expect(ended.kind).toBe("ended");
				const dump = (await recordInside(mf, LEDGER, trace).dump()) as {
					steps: {msg: string}[];
				};
				expect(dump.steps.map((s) => JSON.parse(s.msg))).toEqual([
					{type: "use", key: "<redacted>"},
					{type: "use", key: "<redacted>"},
				]);
			}
		}, 30_000);

	it("memory storage refuses it too: no storage keeps a secret", async () => {
		const ended = await Effect.runPromise(
			runIn(keeper(SCHEMAS[1]?.[1] ?? VaultState, [hold]), "keeper-memory", memoryStorage()),
		);
		expect(ended.kind).toBe("failed");
		if (ended.kind === "failed") expect(Cause.pretty(ended.cause)).toContain("holds a secret");
	});
});
