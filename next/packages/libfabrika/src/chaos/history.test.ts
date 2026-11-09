// P27a, next/. Evidence is constructed without calling the checker or a recovery helper.
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {describe, expect, expectTypeOf, it} from "@effect/vitest";
import {Effect, Exit, Layer, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {Dead, ProcessFact} from "../coordination/process.ts";
import {Id, IdGenerator, InputId} from "../data/id.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {Entry, PAGE} from "../data/log.ts";
import {RecordManager} from "../data/records.ts";
import {nodeSql} from "../data/sqlite.ts";
import {Chain, SpanRow} from "../data/trace.ts";
import {
	forSchema,
	FROM,
	Positive,
	production,
	SEED,
	TestProcessId,
	TestInstanceId,
	withIds,
	type HistoryModule,
	type NemesisModule,
} from "./p27.test-support.ts";

const Chaos = Id.make("chaos");
const Case = Schema.Struct({
	name: Schema.Literals(["counter", "notes"]),
	fault: Schema.Literals([
		"drop_socket",
		"drop_answer",
		"delay",
		"abort",
		"abort_all",
		"fail_step",
		"revoke_key",
	]),
	at: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 1_000_000})),
	gap: Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 10_000})),
	errors: Schema.Tuple([
		Schema.Literals(["TypeError", "RangeError", "SyntaxError"]),
		Schema.Literals(["TypeError", "RangeError", "SyntaxError"]),
		Schema.Literals(["TypeError", "RangeError", "SyntaxError"]),
	]),
	refused: Schema.Boolean,
});

const evidence = Effect.fn("p27.test.evidence")(function* (draw: typeof Case.Type) {
	const N = yield* production<NemesisModule>("../app/nemesis.ts", "Fault");
	const ids = yield* IdGenerator;
	const experiment = yield* ids.next(Chaos);
	const tick = yield* ids.next(InputId);
	const pid = yield* ids.next(TestProcessId);
	const next = yield* ids.next(TestProcessId);
	const session = yield* ids.next(TestProcessId);
	const laterSession = yield* ids.next(TestProcessId);
	const instance = yield* ids.next(TestInstanceId);
	const laterInstance = yield* ids.next(TestInstanceId);
	const letter = yield* ids.next(InputId);
	const name = `${draw.name}:1`;
	const client = "client-a";
	const key = "SHA256:client-a";
	const target = yield* Schema.decodeUnknownEffect(N.Target)({
		program: draw.name,
		name,
		process: pid,
		client,
		key,
	});
	const rawFault: unknown =
		draw.fault === "abort"
			? {_tag: draw.fault, target: "process", name}
			: draw.fault === "abort_all"
				? {_tag: draw.fault}
				: draw.fault === "fail_step"
					? {_tag: draw.fault, pid, times: 3}
					: draw.fault === "delay"
						? {_tag: draw.fault, client, ms: draw.gap + 1}
						: draw.fault === "revoke_key"
							? {_tag: draw.fault, client, key}
							: {_tag: draw.fault, client};
	const fault = yield* Schema.decodeUnknownEffect(N.Fault)(rawFault);
	const hit = yield* Schema.decodeUnknownEffect(N.FaultHit)(
		draw.fault === "fail_step"
			? {_tag: "step", name, process: pid, letter, times: 3}
			: draw.fault === "abort" || draw.fault === "abort_all"
				? {_tag: "object", target: "process", name, instance, process: pid}
				: {_tag: "client", client, session, gateway: "gateway-a", key},
	);
	let rev = 0;
	const entries: Entry[] = [];
	const add = (stream: string, tag: string, body: Schema.Json, parent: InputId | null = tick) => {
		rev++;
		const row = Entry.make({
			...FROM,
			id: `e-${rev}`,
			stream,
			rev,
			pos: entries.filter((e) => e.stream === stream).length + 1,
			arrivedAt: draw.at,
			parent,
			_tag: tag,
			body,
		});
		entries.push(row);
		return row;
	};
	add(
		"chaos:1/inbox",
		"send",
		{m: {type: "start", value: {id: experiment, target, seed: SEED, most: 1, gap: draw.gap + 1}}},
		null,
	);
	add("chaos:1/inbox", "send", {m: {type: "timer", id: tick, at: draw.at}});
	add(`chaos/${experiment}`, "chaos.selected", {experiment, tick, n: 1, fault, hits: [hit]});
	const result = draw.refused ? {_tag: "refused", why: "unavailable"} : {_tag: "fired"};
	add(`chaos/${experiment}`, "chaos.did", {
		experiment,
		tick,
		result,
		error: draw.refused ? "NemesisError" : null,
	});
	add("chaos:1/inbox", "send", {
		m: draw.refused
			? {
					type: "fire_err",
					cmd: {type: "fire", tick, fault},
					error: {_tag: "NemesisError", why: "unavailable"},
				}
			: {type: "fire_ok", cmd: {type: "fire", tick, fault}, value: result},
	});
	const spans: SpanRow[] = [];
	const span = (name: string, attributes: SpanRow["attributes"] = {}, ok = true) => {
		const row = SpanRow.make({
			traceId: FROM.traceId,
			spanId: String(spans.length + 1).padStart(16, "0"),
			parentSpanId: null,
			name,
			kind: "internal",
			startTimeUnixNano: String(BigInt(draw.at) * 1_000_000n),
			endTimeUnixNano: String(BigInt(draw.at + draw.gap + 1) * 1_000_000n),
			attributes: {
				"fab.process": pid,
				"fab.chaos.experiment": experiment,
				"fab.chaos.tick": tick,
				...attributes,
			},
			events: [],
			links: [],
			resource: {attributes: {"fab.object": name}},
			ok,
		});
		spans.push(row);
		return row;
	};
	for (const phase of ["fire", "observe", "complete", "check"])
		span(
			`chaos.${phase}`,
			draw.refused ? {"error.type": "NemesisError", "fab.chaos.why": "unavailable"} : {},
			!draw.refused,
		);
	if (draw.fault === "fail_step" && !draw.refused) {
		let predecessor = pid;
		for (const error of draw.errors) {
			const successor = yield* ids.next(TestProcessId);
			span(
				"runner.step",
				{"fab.process": predecessor, "error.type": error, "messaging.message.id": letter},
				false,
			);
			const fact = ProcessFact.cases.restarted.make({
				process: successor,
				after: predecessor,
				name,
				why: "crashed",
				build: FROM.build,
			});
			const {_tag, ...body} = fact;
			add(`processes/${name}`, _tag, body);
			predecessor = successor;
		}
		const dead = Dead.make({
			process: predecessor,
			program: draw.name,
			name,
			tries: 3,
			limit: 3,
			m: letter,
			build: FROM.build,
			errors: draw.errors,
		});
		const {_tag, ...body} = dead;
		add(`${name}/dead`, _tag, body);
		const down = ProcessFact.cases.down.make({
			process: predecessor,
			why: "crashed",
			crashes: 3,
			until: draw.at + draw.gap + 1,
		});
		const {_tag: tag, ...fields} = down;
		add(`processes/${name}`, tag, fields);
		const afterWait = yield* ids.next(TestProcessId);
		const replacement = ProcessFact.cases.restarted.make({
			process: afterWait,
			after: predecessor,
			name,
			why: "backoff",
			build: FROM.build,
		});
		const {_tag: replacementTag, ...replacementFields} = replacement;
		const resumed = add(`processes/${name}`, replacementTag, replacementFields);
		entries[entries.length - 1] = {...resumed, arrivedAt: draw.at + draw.gap + 2};
		const useful = span("runner.step", {
			"fab.process": afterWait,
			"messaging.message.id": yield* ids.next(InputId),
		});
		spans[spans.length - 1] = {
			...useful,
			startTimeUnixNano: String(BigInt(draw.at + draw.gap + 2) * 1_000_000n),
			endTimeUnixNano: String(BigInt(draw.at + draw.gap + 3) * 1_000_000n),
		};
	} else if ((draw.fault === "abort" || draw.fault === "abort_all") && !draw.refused) {
		span("object.wake", {
			"fab.instance": laterInstance,
			"fab.previous.instance": instance,
			"fab.chaos.process": pid,
		});
	} else if (draw.fault === "revoke_key" && !draw.refused) {
		add("door/keys", "revoked", {key});
		span("door.route", {"fab.key": key, "error.type": "NotGranted"}, false);
		add(`${name}/inbox`, "send", {
			m: {type: draw.name === "notes" ? "save" : "inc"},
			client: "client-b",
		});
		span("runner.step");
	} else if (!draw.refused) {
		add("door/hellos", "hello", {client, session: laterSession, key, after: session});
		const input = yield* ids.next(InputId);
		add(`${name}/inbox`, "send", {m: {type: draw.name === "notes" ? "save" : "inc"}, id: input});
		span("runner.step", {"fab.input": input, "fab.session": laterSession});
		if (draw.fault === "delay")
			span("chaos.release", {"fab.chaos.until": draw.at + draw.gap + 1, "fab.input": input});
		if (draw.fault === "drop_answer")
			span("chaos.suppressed", {"fab.input": input, "fab.placing.rev": rev, "fab.placing.pos": 1});
	}
	if (draw.refused) {
		const input = yield* ids.next(InputId);
		add(`${name}/inbox`, "send", {m: {type: draw.name === "notes" ? "save" : "inc"}, id: input});
		span("runner.step", {"fab.process": pid, "fab.input": input});
	}
	return {
		experiment,
		through: rev,
		entries,
		spans,
		tick,
		pid,
		next,
		letter,
		name,
		fault,
		errors: draw.errors,
	};
});

// vector: p91 assigns these fixed meanings. Input evidence and omissions are generated.
const omissions = [
	["target", "missing_target"],
	["did", "missing_did"],
	["span", "missing_span"],
	["error", "missing_error"],
	["dead", "missing_dead"],
	["until", "missing_until"],
	["answer", "missing_did"],
	["recovery", "missing_recovery"],
] as const;

describe("P27a p91 permanent evidence", () => {
	for (const [remove, why] of omissions) {
		it.effect(`p91 plant: omit ${remove}; vector oracle requires ${why}`, () =>
			Effect.gen(function* () {
				const H = yield* production<HistoryModule>("./history.ts", "explainFaults");
				yield* forSchema(Case, (draw) =>
					Effect.gen(function* () {
						const required = ["error", "dead", "until"].includes(remove)
							? {...draw, fault: "fail_step" as const, refused: false}
							: draw;
						const full = yield* evidence(required);
						expect((yield* H.explainFaults(full))._tag).toBe("complete");
						const entries = full.entries.flatMap((e) => {
							if (remove === "target" && e._tag === "chaos.selected") return [];
							if (remove === "did" && e._tag === "chaos.did") return [];
							if (remove === "dead" && e._tag === "dead") return [];
							if (remove === "until" && e._tag === "down") {
								const body = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
									e.body,
								);
								const {until: _until, ...left} = body;
								return [{...e, body: left}];
							}
							if (remove === "error" && e._tag === "dead")
								return [{...e, body: {...Object(e.body), errors: []}}];
							if (
								remove === "answer" &&
								e.stream === "chaos:1/inbox" &&
								JSON.stringify(e.body).includes('"fire_')
							)
								return [];
							if (
								remove === "recovery" &&
								(e._tag === "restarted" ||
									e.stream === "door/hellos" ||
									e.stream === `${full.name}/inbox` ||
									e._tag === "revoked")
							)
								return [];
							return [e];
						});
						const spans = full.spans.filter((s) =>
							remove === "span"
								? !s.name.startsWith("chaos.")
								: remove === "recovery"
									? s.name.startsWith("chaos.") && s.name !== "chaos.release"
									: remove === "error"
										? s.name !== "runner.step"
										: true,
						);
						const result = yield* Effect.exit(H.explainFaults({...full, entries, spans}));
						if (Exit.isFailure(result)) {
							// A required field with a malformed shape must take the typed bad_row path.
							expect(yield* Effect.flip(H.explainFaults({...full, entries, spans}))).toMatchObject({
								why: "bad_row",
							});
						} else {
							expect(result.value._tag).not.toBe("complete");
							expect(result.value.issues).toContainEqual({tick: full.tick, why});
						}
					}).pipe(withIds),
				);
			}),
		);
	}

	it.effect("plant: nearby recovery, did.ok, earlier hello or wrong predecessor makes green", () =>
		Effect.gen(function* () {
			const H = yield* production<HistoryModule>("./history.ts", "explainFaults");
			yield* forSchema(Case, (draw) =>
				Effect.gen(function* () {
					const full = yield* evidence({...draw, fault: "fail_step", refused: false});
					const stranger = yield* (yield* IdGenerator).next(TestProcessId);
					const entries = full.entries.map((e) =>
						e._tag === "restarted" ? {...e, body: {...Object(e.body), after: stranger}} : e,
					);
					const report = yield* H.explainFaults({...full, entries});
					expect(report._tag).not.toBe("complete");
					expect(
						report.issues?.some((i) => ["missing_recovery", "wrong_target"].includes(i.why)),
					).toBe(true);
				}).pipe(withIds),
			);
		}),
	);

	it.effect("plant: success for contradictory target or result records", () =>
		Effect.gen(function* () {
			const H = yield* production<HistoryModule>("./history.ts", "explainFaults");
			yield* forSchema(Case, (draw) =>
				Effect.gen(function* () {
					const full = yield* evidence(draw);
					const did = full.entries.find((e) => e._tag === "chaos.did")!;
					const changed = {
						...did,
						id: `${did.id}-conflict`,
						rev: full.through + 1,
						pos: did.pos + 1,
						body: {...Object(did.body), result: {_tag: "refused", why: "different"}},
					};
					const report = yield* H.explainFaults({
						...full,
						through: changed.rev,
						entries: [...full.entries, changed],
					});
					expect(report._tag).toBe("broken");
					expect(report.issues).toContainEqual({tick: full.tick, why: "conflict"});
				}).pipe(withIds),
			);
		}),
	);

	it.effect(
		"p91 plant: keep refused did but erase fire_err.why; a failed Cmd needs its saved reason",
		() =>
			Effect.gen(function* () {
				const H = yield* production<HistoryModule>("./history.ts", "explainFaults");
				yield* forSchema(Case, (draw) =>
					Effect.gen(function* () {
						const full = yield* evidence({...draw, refused: true});
						const entries = full.entries.map((e) => {
							if (e.stream !== "chaos:1/inbox") return e;
							const decoded = Schema.decodeUnknownOption(
								Schema.Struct({
									m: Schema.Struct({
										type: Schema.Literal("fire_err"),
										cmd: Schema.Json,
										error: Schema.Struct({_tag: Schema.String, why: Schema.String}),
									}),
								}),
							)(e.body);
							return decoded._tag === "None"
								? e
								: {
										...e,
										body: {m: {...decoded.value.m, error: {_tag: decoded.value.m.error._tag}}},
									};
						});
						expect(entries).not.toEqual(full.entries);
						const result = yield* Effect.exit(H.explainFaults({...full, entries}));
						if (Exit.isFailure(result))
							expect(yield* Effect.flip(H.explainFaults({...full, entries}))).toMatchObject({
								why: "bad_row",
							});
						else {
							expect(result.value._tag).not.toBe("complete");
							expect(result.value.issues).toContainEqual({tick: full.tick, why: "missing_error"});
						}
					}).pipe(withIds),
				);
			}),
	);

	it.effect("plant: earlier hello or equal-clock earlier revision counts as recovery", () =>
		Effect.gen(function* () {
			const H = yield* production<HistoryModule>("./history.ts", "explainFaults");
			yield* forSchema(Case, (draw) =>
				Effect.gen(function* () {
					const full = yield* evidence({...draw, fault: "drop_socket", refused: false});
					const asked = full.entries.find(
						(e) => e.stream === "chaos:1/inbox" && JSON.stringify(e.body).includes('"timer"'),
					)!;
					for (const earlier of [0, 1]) {
						const entries = full.entries.map((e) =>
							e.stream === "door/hellos"
								? {...e, arrivedAt: asked.arrivedAt - earlier, rev: asked.rev - 1}
								: e,
						);
						const report = yield* H.explainFaults({...full, entries});
						expect(report._tag).not.toBe("complete");
						expect(report.issues).toContainEqual({tick: full.tick, why: "missing_recovery"});
					}
				}).pipe(withIds),
			);
		}),
	);

	it.effect("plant: collapse classes or lose their order; original dead errors survive", () =>
		Effect.gen(function* () {
			const H = yield* production<HistoryModule>("./history.ts", "explainFaults");
			yield* forSchema(Case, (draw) =>
				Effect.gen(function* () {
					const full = yield* evidence({...draw, fault: "fail_step", refused: false});
					const report = yield* H.explainFaults(full);
					expect(report.rows.find((r) => r.tick === full.tick)?.errors).toEqual(draw.errors);
				}).pipe(withIds),
			);
		}),
	);

	it.effect("plant: throwing decoder on malformed saved evidence", () =>
		Effect.gen(function* () {
			const H = yield* production<HistoryModule>("./history.ts", "explainFaults");
			for (const raw of fc.sample(fc.anything(), {seed: SEED, numRuns: 100})) {
				const exit = yield* Effect.exit(H.explainFaults(raw));
				expect(Exit.isFailure(exit)).toBe(true);
				expect(yield* Effect.flip(H.explainFaults(raw))).toMatchObject({why: "bad_input"});
			}
			yield* forSchema(Case, (draw) =>
				Effect.gen(function* () {
					const value = yield* H.explainFaults(yield* evidence(draw));
					yield* Schema.decodeUnknownEffect(H.FaultReport)(value);
				}).pipe(withIds),
			);
			expectTypeOf<Effect.Error<ReturnType<typeof H.explainFaults>>>().not.toBeAny();
		}),
	);

	it.effect(
		"plant: first page, unrolled records or private memory; permanent records alone reproduce p91",
		() =>
			Effect.gen(function* () {
				const H = yield* production<HistoryModule>("./history.ts", "FaultHistory");
				yield* forSchema(Schema.Struct({draw: Case, pages: Positive}), ({draw, pages}) =>
					Effect.scoped(
						Effect.gen(function* () {
							const full = yield* evidence({...draw, fault: "fail_step", refused: false});
							const expected = yield* H.explainFaults(full);
							const home = yield* Effect.acquireRelease(
								Effect.sync(() => mkdtempSync("/tmp/fh.XXXX-")),
								(h) => Effect.sync(() => rmSync(h, {recursive: true, force: true})),
							);
							const opened: DatabaseSync[] = [];
							yield* Effect.addFinalizer(() =>
								Effect.sync(() => {
									for (const db of opened) if (db.isOpen) db.close();
								}),
							);
							const open = (name: string) => {
								const db = new DatabaseSync(join(home, name));
								opened.push(db);
								return nodeSql(db);
							};
							const base = () => {
								const parts = new Map<string, ReturnType<typeof nodeSql>>();
								return Layer.mergeAll(
									Ledger.sql(open("ledger.db"), {reader: "fresh-p91"}).pipe(
										Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
									),
									RecordManager.sql((name) => {
										const known = parts.get(name);
										if (known !== undefined) return known;
										const sql = open(`record-${name.replaceAll("/", "_")}.db`);
										parts.set(name, sql);
										return sql;
									}, 64 * 1024),
								);
							};
							yield* Effect.gen(function* () {
								const ledger = yield* Ledger;
								const records = yield* RecordManager;
								// Force more than one ledger page before required facts, without moving their clocks.
								for (let i = 0; i < PAGE + pages; i++)
									yield* ledger.append("chaos:1/inbox", `padding-${i}`, {
										...FROM,
										_tag: "padding",
										body: {n: i},
									});
								for (const e of full.entries) {
									const {id, stream, rev: _rev, pos: _pos, arrivedAt: _at, ...line} = e;
									yield* TestClock.setTime(e.arrivedAt);
									expect((yield* ledger.append(stream, id, line))._tag).toBe("placed");
								}
								let part = 0;
								// Actual SQLite parts roll. Required fault evidence lands after filler spans.
								for (const row of [
									...Array.from({length: 501}, (_, i) => ({
										...full.spans[0]!,
										spanId: `padding-${i}`,
									})),
									...full.spans,
								]) {
									for (;;) {
										const written = yield* records.write(
											Chain.cases.job.make({process: full.pid}),
											part,
											[{span: row, content: null}],
										);
										if (written._tag === "written") break;
										part++;
									}
								}
								expect(part).toBeGreaterThan(0);
							}).pipe(Effect.provide(base()));
							for (const db of opened) if (db.isOpen) db.close();
							// No old Layer, health row, stderr or recovery table is given to the fresh reader.
							const fresh = yield* H.FaultHistory.use((h) =>
								h.read({
									experiment: full.experiment,
									chaos: "chaos:1",
									through: Number.MAX_SAFE_INTEGER,
								}),
							).pipe(Effect.provide(H.FaultHistory.layer.pipe(Layer.provide(base()))));
							const rebuilt = yield* H.explainFaults(fresh);
							expect(rebuilt._tag).toBe(expected._tag);
							expect(
								rebuilt.rows.map((r) => ({
									tick: r.tick,
									fault: r.fault,
									hits: r.hits,
									errors: r.errors,
									recovery: r.recovery._tag,
								})),
							).toEqual(
								expected.rows.map((r) => ({
									tick: r.tick,
									fault: r.fault,
									hits: r.hits,
									errors: r.errors,
									recovery: r.recovery._tag,
								})),
							);
						}),
					).pipe(withIds),
				);
			}),
	);
});
