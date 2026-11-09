// P24, next/. Decoder properties, actual declarations and repeat founding. No cloud calls.
import {DatabaseSync} from "node:sqlite";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Layer, Schema} from "effect";
import {sha256} from "../app/built.ts";
import {runs, StageName} from "../build/p24.test-support.ts";
import {ClientManager, type Founder} from "../coordination/client-manager.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {nodeSql} from "../data/sqlite.ts";
import {ProcessId} from "../data/trace.ts";
import {workerLoader} from "../workers/index.ts";
import {captureStack, PublicSettings, type Captured} from "./p24.test-support.ts";

const resource = (resources: readonly Captured[], name: string) => {
	const found = resources.find((r) => r.name === name);
	expect(found, `actual declaration ${name}`).toBeDefined();
	return found!;
};
const retained = (resources: readonly Captured[]) => {
	expect(resource(resources, "Brain").retained).toBe(true);
	expect(resource(resources, "Health").retained).toBe(true);
	expect(resource(resources, "Health").props).toMatchObject({lifecycleRules: [], locks: []});
};
const traced = (resources: readonly Captured[]) =>
	expect(resource(resources, "Brain").props.observability).toMatchObject({
		enabled: true,
		traces: {enabled: true, headSamplingRate: 1, persist: true},
	});
const sealed = (resources: readonly Captured[]) => {
	const worker = resource(resources, "Brain").props;
	expect(worker.bundle).toBe(false);
	expect(worker.main).toBe("brain.mjs");
	expect(Object.keys(worker.env).sort()).toEqual([
		"GATEWAY",
		"HEALTH",
		"LOADER",
		"PROCESS",
		"PROJECT",
		"RECORD",
		"STAGE",
	]);
	expect(Buffer.byteLength(worker.env.STAGE)).toBeLessThan(5 * 1024);
	expect(worker.env.STAGE).not.toMatch(/export\s|PRIVATE KEY|rawPass|accountId/);
	expect(worker.compatibility.date).toBe("2026-10-12");
};
const sealedCode = (code: unknown) => {
	expect(code).toHaveProperty("env", {});
	expect(code).toHaveProperty("globalOutbound", null);
};
const stopLoaderCapture = (): never => {
	throw new Error("stop after the real loader supplied its code");
};
const separated = (cloud: readonly Captured[], drill: readonly Captured[]) => {
	expect(resource(cloud, "Brain").props.name).toBe("fabrika");
	expect(resource(drill, "Brain").props.name).toBe("fabrika-drill");
	expect(resource(drill, "Health").props.name).not.toBe(resource(cloud, "Health").props.name);
};

describe("P24 stages", () => {
	it.effect.prop(
		"p33 real Worker Loader keeps program bindings empty and outbound sealed",
		{process: ProcessId, source: Schema.NonEmptyString},
		({process, source}) =>
			Effect.gen(function* () {
				const calls: unknown[] = [];
				const keys: Array<string | null> = [];
				const loader = workerLoader(
					{
						get: (key, code) => {
							keys.push(key);
							calls.push(code());
							return stopLoaderCapture();
						},
						load: stopLoaderCapture,
					},
					{p24: {source, hash: sha256(source)}},
				);
				yield* Effect.exit(loader.load("p24", process));
				expect(keys).toEqual([`${sha256(source)}/${process}`]);
				expect(calls).toHaveLength(1);
				sealedCode(calls[0]);
				for (const code of [
					{env: {SECRET: "forbidden"}, globalOutbound: null},
					{env: {}, globalOutbound: "internet"},
				])
					expect(() => sealedCode(code)).toThrow();
			}),
		runs,
	);
	it.effect("scenario: actual cloud declarations retain data and explicitly trace", () =>
		Effect.gen(function* () {
			const captured = yield* captureStack("cloud", {
				name: "fabrika",
				person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
				founder: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
				window: null,
				port: 3310,
				build: "p24-build",
			});
			expect(captured.name).toBe("fabrika");
			sealed(captured.resources);
			retained(captured.resources);
			traced(captured.resources);
		}),
	);
	it.effect.prop(
		"cloud/drill names and storage cannot collide",
		{settings: PublicSettings},
		({settings}) =>
			Effect.gen(function* () {
				const {stageSettings} = yield* Effect.promise(() => import("./stage.ts"));
				const cloud = yield* stageSettings({...settings, stage: "cloud"});
				const drill = yield* stageSettings({...settings, stage: "drill"});
				separated(
					(yield* captureStack("cloud", cloud)).resources,
					(yield* captureStack("drill", drill)).resources,
				);
				// An outside storage override cannot point drill at the real cloud bucket.
				const collision = yield* Effect.exit(
					stageSettings({...settings, stage: "drill", health: "fabrika-health", name: "fabrika"}),
				);
				if (Exit.isSuccess(collision))
					separated(
						(yield* captureStack("cloud", cloud)).resources,
						(yield* captureStack("drill", collision.value)).resources,
					);
			}),
		runs,
	);
	it.effect.prop(
		"cloud Worker and health data are retained",
		{settings: PublicSettings},
		({settings}) =>
			Effect.gen(function* () {
				const {stageSettings} = yield* Effect.promise(() => import("./stage.ts"));
				retained(
					(yield* captureStack("cloud", yield* stageSettings({...settings, stage: "cloud"})))
						.resources,
				);
			}),
		runs,
	);
	it.effect.prop(
		"cloud tracing explicitly records each request",
		{settings: PublicSettings},
		({settings}) =>
			Effect.gen(function* () {
				const {stageSettings} = yield* Effect.promise(() => import("./stage.ts"));
				traced(
					(yield* captureStack("cloud", yield* stageSettings({...settings, stage: "cloud"})))
						.resources,
				);
			}),
		runs,
	);
	it.effect.prop(
		"p33 actual declarations use a completed file and small public env",
		{settings: PublicSettings, stage: StageName},
		({settings, stage}) =>
			Effect.gen(function* () {
				const {stageSettings} = yield* Effect.promise(() => import("./stage.ts"));
				sealed((yield* captureStack(stage, yield* stageSettings({...settings, stage}))).resources);
			}),
		runs,
	);
	it.effect.prop(
		"unsupported personal stages and malformed settings fail",
		{
			stage: Schema.String.check(Schema.isPattern(/^(?:live|dev|test)_[a-z]{1,20}$/)),
			settings: PublicSettings,
			raw: Schema.Unknown,
		},
		({stage, settings, raw}) =>
			Effect.gen(function* () {
				const {stageSettings} = yield* Effect.promise(() => import("./stage.ts"));
				for (const value of [
					{...settings, stage},
					{stage: "cloud"},
					{stage: raw, ledger: ""},
					null,
				])
					expect(Exit.isFailure(yield* Effect.exit(stageSettings(value)))).toBe(true);
			}),
		runs,
	);
	it.effect.prop(
		"cloud founding settings preserve the supplied public identity",
		{settings: PublicSettings},
		({settings}) =>
			Effect.gen(function* () {
				const {stageSettings} = yield* Effect.promise(() => import("./stage.ts"));
				const checked = yield* stageSettings({...settings, stage: "cloud"});
				expect(checked.founder).toEqual(settings.founder);
				const env = resource((yield* captureStack("cloud", checked)).resources, "Brain").props.env;
				expect(JSON.stringify(env.STAGE)).toContain(settings.founder.person);
				expect(JSON.stringify(env.STAGE)).toContain(settings.founder.key);
			}),
		runs,
	);
	it.effect.prop(
		"repeat founding never overwrites existing cloud facts and mismatch fails visibly",
		{
			settings: PublicSettings,
			replacement: PublicSettings,
		},
		({settings, replacement}) =>
			Effect.gen(function* () {
				const db = new DatabaseSync(":memory:");
				try {
					const first = {
						person: settings.founder.person,
						name: settings.founder.name,
						keys: [settings.founder.key],
						window: settings.founder.window,
						by: settings.founder.key,
						build: settings.build,
					};
					const store = Ledger.sql(nodeSql(db), {reader: "p24"}).pipe(
						Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
					);
					const read = (founder: Founder & {person: string; by: string; build: string}) =>
						ClientManager.use((m) => m.members).pipe(
							Effect.provide(ClientManager.layer(founder)),
							Effect.provide(store),
						);
					const original = yield* read(first);
					expect(yield* read(first)).toEqual(original);
					const alternate =
						first.person === "person_01m6v5270hf3c8x2q7w9z4k5mn"
							? "person_01jc9q4w7zef0b5r2t6v0xkb4d"
							: "person_01m6v5270hf3c8x2q7w9z4k5mn";
					const mismatch = yield* Effect.exit(
						read({
							...first,
							person: alternate,
							keys: [replacement.founder.key],
							window: replacement.founder.window,
						}),
					);
					expect(Exit.isFailure(mismatch)).toBe(true);
					expect(yield* read(first)).toEqual(original);
				} finally {
					db.close();
				}
			}),
		runs,
	);
	it.prop(
		"plants: retention, traces, env source, and shared drill storage are detected",
		{settings: PublicSettings},
		({settings}) => {
			const resources: Captured[] = [
				{
					type: "Worker",
					name: "Brain",
					retained: true,
					props: {
						name: "fabrika",
						main: "brain.mjs",
						bundle: false,
						compatibility: {date: "2026-10-12"},
						observability: {
							enabled: true,
							traces: {enabled: true, headSamplingRate: 1, persist: true},
						},
						env: {
							PROJECT: {},
							PROCESS: {},
							GATEWAY: {},
							RECORD: {},
							LOADER: {},
							HEALTH: {},
							STAGE: JSON.stringify(settings),
						},
					},
				},
				{
					type: "Bucket",
					name: "Health",
					retained: true,
					props: {name: "fabrika-health", lifecycleRules: [], locks: []},
				},
			];
			retained(resources);
			traced(resources);
			sealed(resources);
			for (const name of ["Brain", "Health"])
				expect(() => retained(resources.map((r) => ({...r, retained: r.name !== name})))).toThrow();
			expect(() =>
				traced(
					resources.map((r) =>
						r.name === "Brain" ? {...r, props: {...r.props, observability: {enabled: true}}} : r,
					),
				),
			).toThrow();
			expect(() =>
				sealed(
					resources.map((r) =>
						r.name === "Brain"
							? {...r, props: {...r.props, env: {...r.props.env, SOURCE: "export default 1"}}}
							: r,
					),
				),
			).toThrow();
			expect(() => separated(resources, resources)).toThrow();
		},
		runs,
	);
});
