// P16, next/. These checks consume the lead's real-stage observations. P12's stage and driver
// are absent on this base; inventing their RPC or provider API here would test a stand-in.
// P16_STAGE_PROOF names the saved JSON from that run, P16_BRAIN its copied brain.mjs. Neither
// path is recorded. The digest binds every observation to the exact completed file.
//
// The lead must collect declarations from the REAL Alchemy test provider, loader calls from the
// REAL box, HTTP bytes from the copied-file stage, and inbox/view results from P12's driver.
// Plants below exercise the same rejecting checks. They are not claims that workerd ran here.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {basename, resolve} from "node:path";
import {Schema} from "effect";
import {describe, expect, it} from "vitest";

const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Blob = Schema.Struct({hash: Hash, base64: Schema.String});
const Program = Schema.Struct({name: Schema.String, hash: Hash, source: Schema.String});
const Asset = Schema.Struct({
	route: Schema.String,
	type: Schema.String,
	hash: Hash,
	body: Schema.String,
});
const Setting = Schema.Struct({name: Schema.String, value: Schema.Json});
const Binding = Schema.Struct({name: Schema.String, type: Schema.String});
const Declaration = Schema.Struct({
	stage: Schema.Literals(["local", "cloud"]),
	chaos: Schema.Boolean,
	main: Schema.String,
	bundle: Schema.Boolean,
	file: Blob,
	settings: Schema.Array(Setting),
	bindings: Schema.Array(Binding),
});
const Loader = Schema.Struct({
	key: Schema.String,
	process: Schema.String,
	program: Schema.String,
	hash: Hash,
	mainModule: Schema.String,
	modules: Schema.Record(Schema.String, Schema.String),
	env: Schema.Record(Schema.String, Schema.Json),
	// optional only so the omitted-outbound plant reaches the assertion, not a decoder error.
	globalOutbound: Schema.optionalKey(Schema.Json),
});
const Http = Schema.Struct({
	route: Schema.String,
	status: Schema.Int,
	type: Schema.String,
	body: Schema.String,
});
const Place = Schema.Struct({rev: Schema.Int, pos: Schema.Int});
const Counter = Schema.Struct({
	letter: Schema.String,
	first: Place,
	resent: Place,
	acknowledgedBeforeStop: Schema.Array(Schema.String),
	inbox: Schema.Array(Schema.Struct({id: Schema.String, pos: Schema.Int})),
	view: Schema.Struct({count: Schema.Int}),
	watcher: Schema.Struct({count: Schema.Int}),
	stoppedBeforeReply: Schema.Boolean,
	restartedOnSameUrl: Schema.Boolean,
});
const Proof = Schema.Struct({
	brain: Blob,
	declarations: Schema.Array(Declaration),
	programs: Schema.Array(Program),
	assets: Schema.Array(Asset),
	loaders: Schema.Array(Loader),
	http: Schema.Array(Http),
	copiedFiles: Schema.Array(Schema.String),
	unknownProgram: Schema.Struct({
		_tag: Schema.Literal("ProgramDown"),
		why: Schema.Literal("no_program"),
	}),
	isolation: Schema.Struct({
		parentBinding: Schema.String,
		bindingValue: Schema.String,
		programKeys: Schema.Array(Schema.String),
		outbound: Schema.Literals(["denied", "allowed"]),
		controlOutbound: Schema.Literal("allowed"),
		probeHits: Schema.Int,
	}),
	counter: Counter,
	wake: Schema.Struct({before: Schema.String, after: Schema.String}),
});
type Proof = typeof Proof.Type;

const readProof = () => {
	assert(
		existsSync(resolve(import.meta.dirname, "local-stage.ts")),
		"P12 not built: next/apps/fabrika/src/local-stage.ts",
	);
	const path = process.env.P16_STAGE_PROOF;
	const brain = process.env.P16_BRAIN;
	assert(
		path && brain,
		"P16 real run unfinished: lead must set P16_STAGE_PROOF and P16_BRAIN after running P12's actual stage driver",
	);
	const proof = Schema.decodeUnknownSync(Schema.fromJsonString(Proof))(readFileSync(path, "utf8"));
	assert.equal(
		proof.brain.hash,
		sha(readFileSync(brain)),
		"proof is for different final brain bytes",
	);
	assert.equal(proof.brain.hash, sha(Buffer.from(proof.brain.base64, "base64")));
	return proof;
};

const environment = (proof: Proof) => {
	assert.equal(proof.declarations.length, 2);
	const code = [
		...proof.programs.map((row) => row.source),
		...proof.assets.map((row) => row.body),
	].filter(Boolean);
	for (const declaration of proof.declarations) {
		for (const setting of declaration.settings) {
			assert(
				Buffer.byteLength(
					typeof setting.value === "string" ? setting.value : JSON.stringify(setting.value),
					"utf8",
				) <
					5 * 1024,
				"setting exceeds 5 KB of encoded bytes",
			);
			assert(!/WINDOW_JS|PROGRAM_SOURCE/i.test(setting.name), "source returned to environment");
			const includesCode = (value: unknown): boolean =>
				typeof value === "string"
					? code.some((source) => value.includes(source))
					: value !== null && typeof value === "object" && Object.values(value).some(includesCode);
			assert(!includesCode(setting.value), "compiled code in setting");
		}
		for (const binding of declaration.bindings) {
			assert(
				!/WINDOW_JS|PROGRAM_SOURCE/i.test(binding.name),
				"source masquerading as resource binding",
			);
			assert(binding.type.length > 0, "provider did not identify resource binding");
		}
	}
};

const stages = (proof: Proof) => {
	assert.deepEqual(proof.declarations.map((row) => row.stage).sort(), ["cloud", "local"]);
	assert.equal(new Set(proof.declarations.map((row) => row.chaos)).size, 1);
	for (const declaration of proof.declarations) {
		assert.equal(declaration.bundle, false, "stack bundles the completed file again");
		assert.equal(
			basename(declaration.main),
			"brain.mjs",
			"stack selects source instead of the completed file",
		);
		assert.equal(sha(Buffer.from(declaration.file.base64, "base64")), declaration.file.hash);
		assert.equal(declaration.file.hash, proof.brain.hash, "local/cloud clean builds differ");
	}
};

const assets = (proof: Proof) => {
	assert.deepEqual(
		proof.copiedFiles,
		["brain.mjs"],
		"complete-output run retained source or sibling files",
	);
	assert(
		proof.assets.filter((row) => row.type === "text/javascript; charset=utf-8").length >= 2,
		"secondary chunk absent",
	);
	assert(
		proof.assets.some((row) => row.type === "text/css; charset=utf-8"),
		"CSS absent",
	);
	assert.equal(
		new Set(proof.assets.map((row) => row.route)).size,
		proof.assets.length,
		"duplicate asset route",
	);
	for (const asset of proof.assets) {
		assert.equal(sha(asset.body), asset.hash);
		const response = proof.http.find((row) => row.route === asset.route);
		assert(response, "embedded route was not fetched from the copied-file stage");
		assert.equal(response.status, 200);
		assert.equal(response.type, asset.type);
		assert.equal(response.body, asset.body, "served bytes changed");
	}
	assert.equal(
		proof.http.find((row) => row.route === "/p16-missing.js")?.status,
		404,
		"missing script got HTML fallback",
	);
};

const loader = (proof: Proof) => {
	assert(proof.programs.length >= 2, "table must exercise two distinguishable programs");
	assert.equal(
		new Set(proof.programs.map((row) => row.name)).size,
		proof.programs.length,
		"duplicate program name",
	);
	assert.equal(
		new Set(proof.programs.map((row) => row.hash)).size,
		proof.programs.length,
		"fixture programs must have distinguishable code",
	);
	for (const program of proof.programs) {
		assert.equal(sha(program.source), program.hash, "program hash paired with another source");
		const calls = proof.loaders.filter((row) => row.program === program.name);
		assert(calls.length > 0, "table entry fell back to host execution");
		for (const call of calls) {
			assert.equal(call.hash, program.hash);
			assert.equal(call.key, `${program.hash}:${call.process}`);
			assert.equal(call.mainModule, "program.mjs");
			assert.deepEqual(call.modules, {"program.mjs": program.source});
			assert.deepEqual(call.env, {}, "program received a binding");
			assert.equal(call.globalOutbound, null, "program inherited outbound access");
		}
	}
	assert(proof.isolation.parentBinding.length > 0 && proof.isolation.bindingValue.length > 0);
	assert.deepEqual(proof.isolation.programKeys, [], "program read parent bindings");
	assert.equal(proof.isolation.controlOutbound, "allowed");
	assert.equal(proof.isolation.outbound, "denied", "program fetched externally");
	assert.equal(proof.isolation.probeHits, 0);
	assert.equal(proof.wake.after, proof.wake.before, "storage wake changed the process ID");
	assert(
		proof.loaders.some((row) => row.process === proof.wake.before),
		"wake did not exercise the loader",
	);
};

const recovery = (proof: Proof) => {
	const run = proof.counter;
	assert(run.stoppedBeforeReply && run.restartedOnSameUrl, "recovery scenario was not reached");
	assert.deepEqual(run.resent, run.first, "resend lost its first placing");
	assert.equal(
		run.inbox.filter((row) => row.id === run.letter).length,
		1,
		"resend duplicated or lost the input",
	);
	assert.equal(run.inbox.find((row) => row.id === run.letter)?.pos, run.first.pos);
	for (const id of run.acknowledgedBeforeStop)
		assert.equal(
			run.inbox.filter((row) => row.id === id).length,
			1,
			"acknowledgement preceded durable append",
		);
	assert.equal(run.view.count, 1);
	assert.equal(run.watcher.count, 1);
};

describe("P16 real-stage obligations, lead run required", () => {
	it("p33 environment: encoded sizes and code-free settings, including multibyte and WINDOW_JS plants", () => {
		const proof = readProof();
		environment(proof);
		const declaration = proof.declarations[0]!;
		for (const setting of [
			{name: "WINDOW_JS", value: proof.assets[0]!.body},
			{name: "multibyte", value: "雪".repeat(2000)},
		]) {
			const planted = {
				...proof,
				declarations: [
					{...declaration, settings: [...declaration.settings, setting]},
					proof.declarations[1]!,
				],
			};
			expect(() => environment(planted)).toThrow();
		}
	});
	it("p33 same file: actual local/cloud declarations, source/time/URL/rebundle plants", () => {
		const proof = readProof();
		stages(proof);
		for (const change of [
			{main: "src/brain.ts"},
			{bundle: true},
			{
				file: {
					hash: sha("stage URL or build time"),
					base64: Buffer.from("stage URL or build time").toString("base64"),
				},
			},
		]) {
			expect(() =>
				stages({
					...proof,
					declarations: [{...proof.declarations[0]!, ...change}, proof.declarations[1]!],
				}),
			).toThrow();
		}
	});
	it("p33 complete output and assets: copied file serves every chunk and CSS; missing script is 404", () => {
		const proof = readProof();
		assets(proof);
		for (const planted of [
			{...proof, copiedFiles: ["brain.mjs", "window.js"]},
			{...proof, assets: proof.assets.filter((row) => !row.type.startsWith("text/css"))},
			{
				...proof,
				assets: proof.assets.filter(
					(row) => row.type.startsWith("text/css") || row.route === "/window.js",
				),
			},
			{
				...proof,
				http: proof.http.map((row) =>
					row.route === "/p16-missing.js"
						? {...row, status: 200, body: "<html>fallback</html>"}
						: row,
				),
			},
			{...proof, http: proof.http.slice(1)},
		])
			expect(() => assets(planted)).toThrow();
	});
	it("p33 isolation and table: actual loader config, binding/outbound/host-fallback/swapped-hash plants", () => {
		const proof = readProof();
		loader(proof);
		const call = proof.loaders[0]!;
		const {globalOutbound: _outbound, ...omitted} = call;
		for (const first of [{...call, env: {P16_BINDING: "planted"}}, omitted])
			expect(() => loader({...proof, loaders: [first, ...proof.loaders.slice(1)]})).toThrow();
		expect(() => loader({...proof, loaders: []})).toThrow("host execution");
		expect(() =>
			loader({
				...proof,
				programs: [
					{...proof.programs[0]!, source: proof.programs[1]!.source},
					...proof.programs.slice(1),
				],
			}),
		).toThrow("hash paired");
		expect(() =>
			loader({...proof, isolation: {...proof.isolation, outbound: "allowed", probeHits: 1}}),
		).toThrow("fetched externally");
	});
	it("T10 behavior: lost reply and restart return the first placing and one input to both clients", () => {
		const proof = readProof();
		recovery(proof);
		for (const counter of [
			{...proof.counter, resent: {...proof.counter.first, pos: proof.counter.first.pos + 1}},
			{...proof.counter, inbox: []},
			{
				...proof.counter,
				inbox: [
					...proof.counter.inbox,
					{id: proof.counter.letter, pos: proof.counter.first.pos + 1},
				],
			},
		])
			expect(() => recovery({...proof, counter})).toThrow();
	});
});

// This is the lead's measurement, not a benchmark performed by the tests step. P12 supplies
// the actual caps. CI checks behavior and prints timings; only the laptop run compares caps.
const Readings = Schema.Struct({
	acceptedSend: Schema.Number,
	publication: Schema.Number,
	restart: Schema.Number,
	reconnect: Schema.Number,
	lostLink: Schema.Number,
	rss: Schema.Number,
	startup: Schema.Number,
});
const Sample = Schema.Struct({
	ok: Schema.Boolean,
	brain: Hash,
	session: Schema.String,
	settings: Schema.String,
	load: Schema.String,
	chaos: Schema.Boolean,
	readings: Readings,
});
const Bar = Schema.Struct({
	driver: Schema.String,
	capsFrom: Schema.String,
	caps: Readings,
	base: Schema.Array(Sample),
	head: Schema.Array(Sample),
	sizes: Schema.Struct({brain: Schema.Int, programs: Schema.Int, window: Schema.Int}),
});
type Bar = typeof Bar.Type;
const metrics = [
	"acceptedSend",
	"publication",
	"restart",
	"reconnect",
	"lostLink",
	"rss",
	"startup",
] as const;
const median = (values: readonly number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const localBar = (bar: Bar, brain: string, enforce: boolean) => {
	assert.equal(bar.base.length, 4, "four individual base runs required");
	assert.equal(bar.head.length, 5, "five individual head runs required");
	assert(
		bar.driver.length > 0 && bar.capsFrom.length > 0,
		"P12 driver and recorded cap source required",
	);
	const reference = bar.base[0]!;
	for (const sample of [...bar.base, ...bar.head]) {
		assert(sample.ok, "a failed run blocks the bar");
		for (const key of ["session", "settings", "load", "chaos"] as const)
			assert.equal(sample[key], reference[key], "base/head settings or sitting differ");
		for (const value of Object.values(sample.readings))
			assert(Number.isFinite(value) && value >= 0, "missing or invalid reading");
	}
	for (const sample of bar.head)
		assert.equal(sample.brain, brain, "measurement is for different final bytes");
	for (const size of Object.values(bar.sizes))
		assert(size > 0, "brain/program/window sizes required separately");
	for (const metric of metrics) {
		assert(
			Number.isFinite(bar.caps[metric]) && bar.caps[metric] > 0,
			"cap must come from P12's measured bar",
		);
		if (enforce)
			assert(
				median(bar.head.map((row) => row.readings[metric])) <= bar.caps[metric],
				`local bar regressed: ${metric}`,
			);
	}
};

describe("P16 T10 laptop bar, measured by the lead", () => {
	it("keeps all four base and five head readings, and rejects failure, wrong bytes, or a controlled delay over P12's cap", () => {
		const proof = readProof();
		const path = process.env.P16_LOCAL_BAR;
		assert(path, "T10 unfinished: lead must save P12 driver readings and set P16_LOCAL_BAR");
		const bar = Schema.decodeUnknownSync(Schema.fromJsonString(Bar))(readFileSync(path, "utf8"));
		localBar(bar, proof.brain.hash, !process.env.CI);
		console.log(
			JSON.stringify({
				law: "T10",
				base: bar.base.map((row) => row.readings),
				head: bar.head.map((row) => row.readings),
				sizes: bar.sizes,
			}),
		);
		const delayed = {
			...bar,
			head: bar.head.map((row) => ({
				...row,
				readings: {...row.readings, acceptedSend: bar.caps.acceptedSend + 1},
			})),
		};
		expect(() => localBar(delayed, proof.brain.hash, true)).toThrow("acceptedSend");
		expect(() =>
			localBar(
				{...bar, head: [{...bar.head[0]!, ok: false}, ...bar.head.slice(1)]},
				proof.brain.hash,
				false,
			),
		).toThrow("failed run");
		expect(() => localBar(bar, sha("different final file"), false)).toThrow(
			"different final bytes",
		);
	});
});
