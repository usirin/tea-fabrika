// P27a, next/. The same real WebSocket driver runs on local and an already deployed drill.
// This file contains I/O and expected client work. It contains no fault action or recovery.
import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {grantText, revokeText} from "@kampus/libfabrika/coordination";
import {Id, IdGenerator, InputId, type IdSchema} from "@kampus/libfabrika/data";
import {Chain, Entry, SpanRow} from "@kampus/libfabrika/data";
import {helloText, KeyLine, writeSshsig} from "@kampus/libfabrika/transport";
import {Effect, Result, Schema} from "effect";
import {Base64, Base64Url} from "effect/encoding";

export const SEED = 119120;
export class TestFailure extends Schema.TaggedError<TestFailure>()("P27StageFailure", {
	why: Schema.String,
}) {}
type Evidence = {
	readonly experiment: string;
	readonly through: number;
	readonly entries: ReadonlyArray<typeof Entry.Type>;
	readonly spans: ReadonlyArray<typeof SpanRow.Type>;
};
type Report = Readonly<Record<"_tag", "complete" | "incomplete" | "broken">> & {
	readonly rows: ReadonlyArray<{
		readonly tick: string;
		readonly fault: Readonly<Record<"_tag", string>>;
		readonly hits: ReadonlyArray<unknown>;
		readonly recovery: Readonly<Record<"_tag", string>>;
	}>;
	readonly issues?: ReadonlyArray<unknown>;
};
type HistoryModule = {readonly explainFaults: (raw: unknown) => Effect.Effect<Report, unknown>};
const production = Effect.fn("p27.stage.production")(function* <A>(path: string, name: string) {
	const url = new URL(path, import.meta.url).href;
	// oxlint-disable-next-line fabrika/no-promises -- edge: ESM loading returns a Promise
	const loaded: A = yield* Effect.tryPromise({
		// oxlint-disable-next-line fabrika/no-promises -- edge: ESM loading returns a Promise
		try: () => import(/* @vite-ignore */ url),
		catch: () => new TestFailure({why: `red: missing export ${name}`}),
	});
	if (!Reflect.has(Object(loaded), name))
		return yield* new TestFailure({why: `red: missing export ${name}`});
	return loaded;
});

type ExpectedOperation = {
	readonly input: InputId;
	readonly target: string;
	readonly payload: Schema.Json;
	readonly answer: Schema.Json;
	readonly placing: {readonly rev: number; readonly pos: number};
};
export type StageResult = {
	readonly evidence: Evidence;
	readonly report: Report;
	readonly expected: ReadonlyArray<ExpectedOperation>;
	readonly reports: ReadonlyArray<Report>;
	readonly controls: ReadonlyArray<{
		readonly msg: string;
		readonly unknown: unknown;
		readonly revoked: unknown;
		readonly forged: unknown;
		readonly input: InputId;
		readonly by: string;
	}>;
	readonly cases: ReadonlyArray<{
		readonly fault: string;
		readonly before: unknown;
		readonly after: unknown;
	}>;
};

const APP = resolve(import.meta.dirname, "..");
const GrantId = Id.make("grant");
const Json = Schema.Json;
const Rpc = Schema.Struct({
	jsonrpc: Schema.Literal("2.0"),
	id: Schema.optionalKey(Schema.Number),
	result: Schema.optionalKey(Json),
	error: Schema.optionalKey(Json),
	method: Schema.optionalKey(Schema.String),
	params: Schema.optionalKey(Json),
});

const key = Effect.fn("p27.stage.key")(function* () {
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto generates a temporary signing key
	const pair = yield* Effect.promise(() =>
		crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]),
	);
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports only the public key
	const publicBytes = yield* Effect.promise(() => crypto.subtle.exportKey("raw", pair.publicKey));
	const raw = new Uint8Array(publicBytes);
	const blob = new Uint8Array(51);
	new DataView(blob.buffer).setUint32(0, 11);
	blob.set(new TextEncoder().encode("ssh-ed25519"), 4);
	new DataView(blob.buffer).setUint32(15, 32);
	blob.set(raw, 19);
	const line = yield* Schema.decodeUnknownEffect(KeyLine)(`ssh-ed25519 ${Base64.encode(blob)}`);
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes a public key
	const hash = new Uint8Array(yield* Effect.promise(() => crypto.subtle.digest("SHA-256", raw)));
	const sign = (text: string) =>
		writeSshsig({
			text,
			space: "fabrika-client",
			line,
			sign: (bytes) => {
				// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs with the temporary nonextractable key
				return Effect.promise(() => crypto.subtle.sign("Ed25519", pair.privateKey, bytes)).pipe(
					Effect.map((b) => new Uint8Array(b)),
				);
			},
		});
	return {
		raw: Base64Url.encode(raw),
		fingerprint: `SHA256:${Base64.encode(hash).replace(/=+$/, "")}`,
		line,
		sign,
	};
});

const connect = Effect.fn("p27.stage.connect")(function* (
	url: string,
	tab: string,
	k: Effect.Success<ReturnType<typeof key>>,
) {
	const socket = yield* Effect.acquireRelease(
		Effect.sync(
			() =>
				new WebSocket(
					`${url.replace(/^http/, "ws")}/client/${encodeURIComponent(k.fingerprint)}/${tab}`,
				),
		),
		(s) => Effect.sync(() => s.close()),
	);
	let serial = 0;
	const waiting = new Map<number, (value: unknown) => void>();
	const frames: unknown[] = [];
	let challenge = "";
	socket.addEventListener("message", ({data}) => {
		if (data === "pong") return;
		const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Rpc))(String(data));
		if (decoded._tag === "None") return;
		const frame = decoded.value;
		frames.push(frame);
		if (frame.method === "challenge") {
			const parsed = Schema.decodeUnknownOption(Schema.Struct({nonce: Schema.String}))(
				frame.params,
			);
			if (parsed._tag === "Some") challenge = parsed.value.nonce;
		}
		if (frame.id !== undefined) {
			waiting.get(frame.id)?.(frame);
			waiting.delete(frame.id);
		}
	});
	socket.addEventListener("close", () => {
		for (const done of waiting.values()) done({closed: true});
		waiting.clear();
	});
	const call = (method: string, params: unknown) =>
		Effect.callback<unknown, TestFailure>((resume) => {
			const id = ++serial;
			waiting.set(id, (answer) => resume(Effect.succeed(answer)));
			socket.send(JSON.stringify({jsonrpc: "2.0", id, method, params}));
			return Effect.sync(() => {
				waiting.delete(id);
			});
		}).pipe(Effect.timeout("10 seconds"));
	yield* Effect.repeat(Effect.sleep("10 millis"), {while: () => challenge === ""});
	const hello = {
		versions: [1],
		has: ["seal"],
		ping: "30s",
		key: k.raw,
		tab,
		nonce: challenge,
		platform: "headless",
		os: "linux",
		sentAt: new Date().toISOString(),
		signed: yield* k.sign(helloText({url, tab, nonce: challenge})),
	};
	const admission = yield* call("initialize", hello);
	return {call, socket, frames, admission, key: k, tab};
});

const localStage = Effect.fn("p27.stage.localStage")(function* (
	home: string,
	founder: string,
	chaos = "throwaway",
	revoke?: {text: string; armored: string},
) {
	const dev = resolve(APP, "dev.ts");
	if (!existsSync(dev))
		return yield* new TestFailure({why: "red: missing export dev.ts local stage (P12)"});
	const env = {...process.env, FABRIKA_HOME: home};
	delete env.TYPESAFE_API_KEY;
	delete env.FABRIKA_FOREGROUND;
	// Local only. No credential discovery or deployment occurs here.
	delete env.CLOUDFLARE_API_TOKEN;
	const child = yield* Effect.acquireRelease(
		Effect.sync(() =>
			spawn(
				process.execPath,
				[
					dev,
					"--port",
					"18727",
					"--name",
					"throwaway-p27",
					"--person",
					"test-owner",
					"--founder",
					founder,
					`--chaos=${chaos}`,
					...(revoke === undefined ? [] : ["--chaos-revoke", JSON.stringify(revoke)]),
				],
				{cwd: APP, env, stdio: "ignore"},
			),
		),
		(c) =>
			Effect.sync(() => {
				c.kill("SIGTERM");
			}),
	);
	const url = "http://127.0.0.1:18727";
	yield* Effect.repeat(
		Effect.gen(function* () {
			if (child.exitCode !== null) return yield* new TestFailure({why: "P12 local stage exited"});
			// oxlint-disable-next-line fabrika/no-promises -- edge: readiness uses the actual local HTTP endpoint
			return yield* Effect.tryPromise({
				try: () => fetch(url),
				catch: () => new TestFailure({why: "not listening"}),
			});
		}).pipe(Effect.retry({times: 100, delay: "20 millis"})),
		{while: (r) => !r.ok},
	);
	return url;
});

const result = (raw: unknown) =>
	Schema.decodeUnknownEffect(Schema.Struct({result: Json}))(raw).pipe(Effect.map((r) => r.result));
const pagedEntries = Effect.fn("p27.stage.entries")(function* (
	client: Effect.Success<ReturnType<typeof connect>>,
	stream: string,
) {
	const rows: Entry[] = [];
	let after = 0;
	for (;;) {
		const raw = yield* result(yield* client.call("ledger.read", {stream, after}));
		const {entries} = yield* Schema.decodeUnknownEffect(
			Schema.Struct({entries: Schema.Array(Entry)}),
		)(raw);
		rows.push(...entries);
		const last = entries.at(-1);
		if (last === undefined) return rows;
		after = last.rev;
	}
});

export const stageFaults = Effect.fn("p27.stage.faults")(function* (options: {
	readonly url: string;
	readonly home: string;
	readonly stage: "local" | "drill";
	readonly seed: number;
}) {
	const H = yield* production<HistoryModule>(
		"../../../packages/libfabrika/src/chaos/history.ts",
		"explainFaults",
	);
	// Import real programs before touching the platform. Never replace an unlanded program.
	yield* production("../../../programs/chaos/src/program.ts", "chaos");
	yield* production("../../../programs/notes/src/program.ts", "notes");
	const N = yield* production<{
		FaultOffer: Schema.Schema<Readonly<Record<"_tag", string>> & {fault: string}>;
		ChaosId: IdSchema<"chaos">;
	}>("../../../packages/libfabrika/src/app/nemesis.ts", "FaultOffer");
	const {RevokeId}: {RevokeId: IdSchema<"revoke">} = yield* production(
		"../../../packages/libfabrika/src/coordination/fault-journal.ts",
		"RevokeId",
	);
	const P = yield* production<{
		planFaults: (
			input: unknown,
		) => Result.Result<
			ReadonlyArray<{fault: Readonly<Record<"_tag", string>> & {readonly times?: number}}>,
			unknown
		>;
	}>("../../../packages/libfabrika/src/app/chaos-state.ts", "planFaults");
	const founder = yield* key();
	const first = yield* key();
	const second = yield* key();
	const stranger = yield* key();
	const ids = yield* IdGenerator;
	const revoke = revokeText({
		id: yield* ids.next(RevokeId),
		key: first.raw,
		for: "test-owner",
		to: "throwaway-p27",
		sentAt: new Date().toISOString(),
		saw: {label: "Old client", where: "local", how: "panel", check: "touch"},
	});
	const prepared = {text: revoke, armored: yield* founder.sign(revoke)};
	const url =
		options.stage === "local"
			? yield* localStage(options.home, founder.line, "throwaway", prepared)
			: options.url;
	const control = yield* connect(url, "founder", founder);
	let a = yield* connect(url, "client-a", first);
	let b = yield* connect(url, "client-b", second);
	const unknown = yield* connect(url, "unknown", stranger);
	for (const client of [a, b]) {
		const text = grantText({
			id: yield* ids.next(GrantId),
			key: client.key.raw,
			for: "test-owner",
			to: "throwaway-p27",
			sentAt: new Date().toISOString(),
			as: "window",
			saw: {label: "Test client", where: "local", how: "panel", check: "touch"},
		});
		yield* control.call("keys.grant", {text, armored: yield* founder.sign(text)});
	}
	a.socket.close();
	b.socket.close();
	a = yield* connect(url, "client-a-new", first);
	b = yield* connect(url, "client-b-new", second);
	const processRows = yield* pagedEntries(control, "processes/chaos:1");
	const {process: pid} = yield* Schema.decodeUnknownEffect(Schema.Struct({process: Schema.String}))(
		processRows.find((e) => e._tag === "started")?.body,
	);
	const counterRows = yield* pagedEntries(control, "processes/counter:1");
	const firstCounter = yield* Schema.decodeUnknownEffect(Schema.Struct({process: Schema.String}))(
		counterRows.find((e) => e._tag === "started")?.body,
	);
	let counter = firstCounter.process;
	const noteRows = yield* pagedEntries(control, "processes/notes:1");
	const {process: notes} = yield* Schema.decodeUnknownEffect(
		Schema.Struct({process: Schema.String}),
	)(noteRows.find((e) => e._tag === "started")?.body);
	const send = Effect.fn("p27.stage.send")(function* (
		client: typeof a,
		target: string,
		payload: Schema.Json,
		forged: object = {},
	) {
		const letter = yield* ids.next(InputId);
		return {
			input: letter,
			raw: yield* client.call("process.send", {
				pid: target,
				letter,
				m: payload,
				sentAt: new Date().toISOString(),
				seen: 0,
				...forged,
			}),
		};
	});
	const expected: ExpectedOperation[] = [];
	const controls: StageResult["controls"][number][] = [];
	const cases: StageResult["cases"][number][] = [];
	const experiment = yield* ids.next(N.ChaosId);
	const target = {
		program: "counter",
		name: "counter:1",
		process: counter,
		client: a.tab,
		key: first.fingerprint,
	};
	const msgs = [
		{type: "stop"},
		{type: "start", value: {id: experiment, seed: options.seed, most: 7, gap: 1, target}},
	];
	for (const msg of msgs) {
		const untrusted = yield* send(unknown, pid, msg);
		const forged = yield* send(a, pid, msg, {
			by: founder.fingerprint,
			key: founder.raw,
			person: "forged-owner",
		});
		controls.push({
			msg: msg.type,
			unknown: untrusted.raw,
			forged: forged.raw,
			revoked: null,
			input: forged.input,
			by: first.fingerprint,
		});
	}
	let version = 0;
	const work = Effect.fn("p27.stage.work")(function* () {
		const lives = yield* pagedEntries(control, "processes/counter:1");
		const latest = lives.filter((e) => e._tag === "started" || e._tag === "restarted").at(-1);
		const current = yield* Schema.decodeUnknownEffect(Schema.Struct({process: Schema.String}))(
			latest?.body,
		);
		counter = current.process;
		// These expectations exist before the system's history is read.
		for (const [client, destination, payload] of [
			[a, counter, {type: "inc"}],
			[
				b,
				notes,
				{
					type: "save",
					value: {note: "p27", base: version, body: `version-${version}`, how: "kept"},
				},
			],
		] as const) {
			if (client.socket.readyState !== WebSocket.OPEN) continue;
			const sent = yield* send(client, destination, payload);
			const answer = yield* result(sent.raw);
			const placing = yield* Schema.decodeUnknownEffect(
				Schema.Struct({rev: Schema.Int, pos: Schema.Int}),
			)(answer);
			expected.push({input: sent.input, target: destination, payload, answer, placing});
			if (destination === notes) version++;
		}
	});
	// Find the real saved offers without tying the driver to a view's field layout.
	const offersIn = (value: unknown): ReadonlyArray<{fault: string}> => {
		const decoded = Schema.decodeUnknownOption(N.FaultOffer)(value);
		if (decoded._tag === "Some") return decoded.value._tag === "ready" ? [decoded.value] : [];
		return typeof value === "object" && value !== null
			? Object.values(value).flatMap(offersIn)
			: [];
	};
	const available = offersIn(yield* control.call("view.open", {pid})).map((o) => o.fault);
	if (available.length === 0)
		return yield* new TestFailure({why: "live stage advertised no ready faults"});
	const experiments: string[] = [];
	for (const wanted of [...available.filter((f) => f !== "revoke_key"), "seeded", "revoke_key"]) {
		if (wanted === "revoke_key") for (let n = 0; n < 300; n++) yield* work;
		target.process = counter;
		target.client = a.tab;
		const id = yield* ids.next(N.ChaosId);
		experiments.push(id);
		let seed = options.seed;
		if (wanted !== "seeded") {
			for (let n = 0; n < 10_000; n++) {
				const planned = P.planFaults({id, seed, target, most: 1, gap: 1, from: 0, available});
				if (
					Result.isSuccess(planned) &&
					planned.success[0]?.fault._tag === wanted &&
					(wanted !== "fail_step" || planned.success[0].fault.times === 3)
				)
					break;
				seed++;
				if (n === 9999) return yield* new TestFailure({why: `no saved seed for ${wanted}`});
			}
		}
		const before = yield* pagedEntries(control, "processes/counter:1");
		yield* send(control, pid, {type: "stop"});
		yield* send(control, pid, {
			type: "start",
			value: {id, target, seed, most: wanted === "seeded" ? 7 : 1, gap: 1},
		});
		for (let n = 0; n < 50; n++) {
			if (a.socket.readyState !== WebSocket.OPEN && wanted !== "revoke_key")
				a = yield* connect(url, `client-a-${seed}-${n}`, first);
			yield* work;
			const did = (yield* pagedEntries(control, `chaos/${id}`)).filter(
				(e) => e._tag === "chaos.did",
			);
			if (did.length >= (wanted === "seeded" ? 7 : 1)) {
				cases.push({fault: wanted, before, after: did});
				break;
			}
			yield* Effect.sleep("10 millis");
			if (n === 49)
				return yield* new TestFailure({why: `missing actual fault evidence: ${wanted}`});
		}
	}
	for (let n = 0; n < 300; n++) yield* work;
	if (a.socket.readyState !== WebSocket.OPEN) a = yield* connect(url, "revoked-reconnect", first);
	for (const [i, msg] of msgs.entries()) {
		const previous = controls[i];
		if (previous === undefined) return yield* new TestFailure({why: "missing control expectation"});
		controls[i] = {...previous, revoked: (yield* send(a, pid, msg)).raw};
	}
	const entries = (yield* Effect.forEach(
		[
			"chaos:1/inbox",
			"counter:1/inbox",
			"notes:1/inbox",
			"notes:1",
			"processes/counter:1",
			"counter:1/dead",
			"door/hellos",
			"door/members",
		],
		(stream) => pagedEntries(control, stream),
		{concurrency: 1},
	)).flat();
	for (const id of experiments) entries.push(...(yield* pagedEntries(control, `chaos/${id}`)));
	const spans: SpanRow[] = [];
	const processes = new Set([pid, counter, notes]);
	for (const e of entries.filter((e) => e._tag === "started" || e._tag === "restarted")) {
		const decoded = Schema.decodeUnknownOption(Schema.Struct({process: Schema.String}))(e.body);
		if (decoded._tag === "Some") processes.add(decoded.value.process);
	}
	for (const process of processes) {
		let after = 0;
		for (;;) {
			const raw = yield* result(
				yield* control.call("spans.read", {chain: Chain.cases.job.make({process}), after}),
			);
			const page = yield* Schema.decodeUnknownEffect(
				Schema.Struct({spans: Schema.Array(SpanRow), next: Schema.Int}),
			)(raw);
			spans.push(...page.spans);
			if (page.spans.length === 0) break;
			after = page.next;
		}
	}
	const lastExperiment = experiments.at(-1);
	if (lastExperiment === undefined)
		return yield* new TestFailure({why: "no completed experiments"});
	const evidence: Evidence = {
		experiment: lastExperiment,
		through: Math.max(...entries.map((e) => e.rev)),
		entries,
		spans,
	};
	const reports = yield* Effect.forEach(
		experiments,
		(id) => H.explainFaults({...evidence, experiment: id}),
		{concurrency: 1},
	);
	const lastReport = reports.at(-1);
	if (lastReport === undefined) return yield* new TestFailure({why: "no report"});
	return {evidence, report: lastReport, reports, expected, controls, cases};
});

export const offWork = Effect.fn("p27.stage.offWork")(function* (home: string) {
	const founder = yield* key();
	const url = yield* localStage(home, founder.line, "off");
	const client = yield* connect(url, "off-client", founder);
	const ids = yield* IdGenerator;
	const saved: Array<{target: string; payload: Schema.Json; answer: unknown}> = [];
	for (const name of ["counter:1", "notes:1"]) {
		const rows = yield* pagedEntries(client, `processes/${name}`);
		const {process: pid} = yield* Schema.decodeUnknownEffect(
			Schema.Struct({process: Schema.String}),
		)(rows.find((e) => e._tag === "started")?.body);
		for (let n = 0; n < 3; n++) {
			const payload =
				name === "counter:1"
					? {type: "inc"}
					: {type: "save", value: {note: "off", base: n, body: `off-version-${n}`}};
			const answer = yield* client.call("process.send", {
				pid,
				letter: yield* ids.next(InputId),
				m: payload,
				sentAt: new Date().toISOString(),
				seen: 0,
			});
			saved.push({target: name, payload, answer});
		}
	}
	return {
		saved,
		counter: yield* pagedEntries(client, "counter:1/inbox"),
		notes: yield* pagedEntries(client, "notes:1/inbox"),
		chaos: yield* pagedEntries(client, "processes/chaos:1"),
	};
});
