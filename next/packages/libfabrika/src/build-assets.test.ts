// P16, next/. Fixtures are disposable. Compiler and Rolldown are the installed implementations.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
	existsSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {NodeServices} from "@effect/platform-node";
import {Cause, Deferred, Effect, Exit, Fiber, FileSystem, PlatformError, Tracer} from "effect";
import * as fc from "fast-check";
import type {RolldownOutput, RolldownOptions, OutputOptions} from "rolldown";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {Asset} from "./app/built.ts";
import {check} from "./compiler.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const runs = {seed: 119120, numRuns: 3};
const names = fc.integer({min: 0, max: 10000}).map((n) => `View${n}`);
const values = fc.string({minLength: 1, maxLength: 30});
const graphs = fc.record({
	name: names,
	value: values,
	id: fc.integer({min: 0, max: 10000}),
});
const homes: string[] = [];
type Options = {
	readonly out: string;
	readonly root: string;
	readonly entry: string;
	readonly programs: readonly {
		readonly name: string;
		readonly package: string;
		readonly export: string;
	}[];
	readonly files: readonly string[];
	readonly ledger?: readonly {readonly file: string; readonly fn: string; readonly why: string}[];
	readonly chaos: boolean;
};
type Build = {
	readonly build: (
		o: Options,
	) => Effect.Effect<
		{readonly brain: string; readonly assets: Readonly<Record<string, Asset>>},
		unknown
	>;
};
type Handle = {generate: (o: OutputOptions) => Promise<RolldownOutput>; close: () => Promise<void>};
type Roll = {readonly rolldown: (o: RolldownOptions) => Promise<Handle>};
const fixture = (name: string, value: string) => {
	const home = mkdtempSync("/tmp/fh.");
	homes.push(home);
	mkdirSync(join(home, "node_modules/@p16"), {recursive: true});
	for (const pkg of ["effect", "@demlik", "@kampus"])
		symlinkSync(
			join(ROOT, "next/apps/fabrika/node_modules", pkg),
			join(home, "node_modules", pkg),
			"dir",
		);
	symlinkSync(join(import.meta.dirname, "../node_modules/react"), join(home, "node_modules/react"));
	const pkg = join(home, "programs/compiler"),
		file = join(pkg, "window.tsx");
	mkdirSync(pkg, {recursive: true});
	// Match workspace resolution without asking the Compiler to compile installed dependencies.
	symlinkSync(pkg, join(home, "node_modules/@p16/compiler"), "dir");
	writeFileSync(join(home, "package.json"), '{"type":"module"}');
	writeFileSync(
		join(pkg, "package.json"),
		JSON.stringify({type: "module", exports: {".": "./program.ts", "./window": "./window.tsx"}}),
	);
	writeFileSync(join(pkg, "program.ts"), 'export {counter as program} from "@kampus/counter";');
	writeFileSync(
		file,
		`import './window.css'; export const ${name} = () => <b>{${JSON.stringify(value)}}</b>; export const ready = import('./chunk.ts');`,
	);
	writeFileSync(join(pkg, "chunk.ts"), `export const text=${JSON.stringify(value)};`);
	writeFileSync(join(pkg, "window.css"), `b { color: rgb(12, 34, 56); }`);
	cpSync(join(ROOT, "next/apps/fabrika/src"), join(home, "src"), {
		recursive: true,
		filter: (p) => !p.endsWith(".test.ts"),
	});
	const options: Options = {
		out: join(home, "dist"),
		root: home,
		entry: join(home, "src/brain.ts"),
		programs: [{name: "counter", package: "@p16/compiler", export: "program"}],
		files: [],
		ledger: [],
		chaos: false,
	};
	vi.stubEnv("TYPESAFE_API_KEY", undefined);
	return {home, file, options};
};
const load = async () => {
	const file = join(import.meta.dirname, "build.ts");
	assert(existsSync(file), "P16 not built: libfabrika/build and embedded assets absent");
	return vi.importActual<Build>(pathToFileURL(file).href);
};
const run = async (options: Options) =>
	Effect.runPromise((await load()).build(options).pipe(Effect.provide(NodeServices.layer)));
const previous = (f: ReturnType<typeof fixture>, value: string) => {
	mkdirSync(f.options.out);
	writeFileSync(join(f.options.out, "brain.mjs"), value);
};
afterEach(() => {
	vi.doUnmock("rolldown");
	vi.resetModules();
	vi.unstubAllEnvs();
	for (const h of homes.splice(0)) rmSync(h, {recursive: true, force: true});
});

describe("P16 assets and Compiler", () => {
	it("outside metadata plants: malformed package and Compiler-ledger JSON fail in the typed channel", async () => {
		await fc.assert(
			fc.asyncProperty(values, fc.constantFrom("manifest", "ledger"), async (value, kind) => {
				const f = fixture("View", value);
				previous(f, value);
				const file =
					kind === "manifest"
						? join(f.home, "programs/compiler/package.json")
						: join(f.home, "compiler-ledger.json");
				writeFileSync(file, `{${JSON.stringify(value)}`);
				const {ledger: _ledger, ...options} = f.options;
				const result = await Effect.runPromise(
					Effect.result((await load()).build(options)).pipe(Effect.provide(NodeServices.layer)),
				);
				expect(result).toMatchObject({_tag: "Failure", failure: {_tag: "BuildError"}});
				expect(readFileSync(join(f.options.out, "brain.mjs"), "utf8")).toBe(value);
			}),
			{...runs, numRuns: 4},
		);
	});
	it("assets: entry, secondary chunks and CSS retain routes, hashes, MIME types and bytes; missing script is 404", async () => {
		await fc.assert(
			fc.asyncProperty(names, values, async (name, value) => {
				const f = fixture(name, value),
					built = await run(f.options);
				const worker = await vi.importActual<{
					readonly serveAsset: (
						assets: Readonly<Record<string, Asset>>,
						request: Request,
					) => Effect.Effect<Response, unknown>;
				}>(pathToFileURL(join(import.meta.dirname, "workers/index.ts")).href);
				assert.equal(typeof worker.serveAsset, "function", "P16 library asset serving is absent");
				expect(
					Object.values(built.assets).filter((a) => a.type === "text/javascript; charset=utf-8")
						.length,
				).toBeGreaterThanOrEqual(2);
				expect(Object.values(built.assets).some((a) => a.type === "text/css; charset=utf-8")).toBe(
					true,
				);
				for (const [route, asset] of Object.entries(built.assets)) {
					expect(route.startsWith("/")).toBe(true);
					expect(asset.hash).toBe(createHash("sha256").update(asset.body).digest("hex"));
					const response = await Effect.runPromise(
						worker.serveAsset(built.assets, new Request(`https://test.invalid${route}`)),
					);
					expect(response.status).toBe(200);
					expect(response.headers.get("content-type")).toBe(asset.type);
					expect(await response.text()).toBe(asset.body);
					const {[route]: _removed, ...planted} = built.assets;
					expect(
						(
							await Effect.runPromise(
								worker.serveAsset(planted, new Request(`https://test.invalid${route}`)),
							)
						).status,
					).toBe(404);
				}
				expect(
					(
						await Effect.runPromise(
							worker.serveAsset(built.assets, new Request("https://test.invalid/missing.js")),
						)
					).status,
				).toBe(404);
			}),
			runs,
		);
	});
	for (const url of [false, true])
		it(`CSS graph plant: ${url ? "import url()" : "quoted imports"} resolves to served routes after rebasing`, async () => {
			await fc.assert(
				fc.asyncProperty(graphs, async ({name, value, id}) => {
					const f = fixture(name, value),
						pkg = dirname(f.file),
						nested = `styles${id}`;
					mkdirSync(join(pkg, nested));
					const theme = `./${nested}/theme.css`,
						tokens = `../tokens${id}.css`;
					writeFileSync(
						join(pkg, "window.css"),
						`@import ${url ? `url("${theme}")` : `"${theme}"`}; b { color: red; }`,
					);
					writeFileSync(
						join(pkg, nested, "theme.css"),
						`@import url("${tokens}"); b { --theme: ${id}; }`,
					);
					writeFileSync(join(pkg, `tokens${id}.css`), `b { --tokens: ${id}; }`);
					const built = await run(f.options);
					const {serveAsset} = await import("./workers/index.ts");
					const verify = async (assets: Readonly<Record<string, Asset>>) => {
						for (const [route, asset] of Object.entries(assets)) {
							const refs = asset.type.startsWith("text/css")
								? [
										...asset.body.matchAll(
											/@import\s+["']([^"']+)["']|url\(\s*["']?([^\s"')]+)["']?\s*\)/g,
										),
									].map((m) => m[1] ?? m[2]!)
								: [...asset.body.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)].map(
										(m) => m[1]!,
									);
							for (const ref of refs) {
								if (/^(?:data:|https?:|#)/.test(ref)) continue;
								const request = new Request(new URL(ref, `https://test.invalid${route}`));
								const response = await Effect.runPromise(serveAsset(assets, request));
								expect(response.status, `${route} references ${request.url}`).toBe(200);
							}
						}
					};
					// Plant the exact old behavior in real output: retain a CSS import to an absent route.
					const css = Object.entries(built.assets).find(([, a]) => a.type.startsWith("text/css"));
					assert(css, "window stylesheet must be emitted");
					await expect(
						verify({...built.assets, [css[0]]: {...css[1], body: '@import "./absent-theme.css";'}}),
					).rejects.toThrow("references");
					await verify(built.assets);
					const styles = Object.values(built.assets)
						.filter((a) => a.type.startsWith("text/css"))
						.map((a) => a.body)
						.join("\n");
					expect(styles).toContain(`--theme: ${id}`);
					expect(styles).toContain(`--tokens: ${id}`);
				}),
				// Pinned review bug: the published stylesheet's two import forms request absent routes.
				{
					...runs,
					examples: [[{name: "View", value: "css", id: 1}]],
					endOnFailure: true,
				},
			);
		});
	it("Compiler: reachable refused TSX fails before replacing the last good brain", async () => {
		await fc.assert(
			fc.asyncProperty(
				names,
				values,
				fc.constantFrom("ref", "clock", "directive", "stale"),
				async (name, value, kind) => {
					const f = fixture(name, value),
						good = `last-good-${value}`;
					previous(f, good);
					const source =
						kind === "ref"
							? `import {useRef} from 'react'; export const ${name}=()=>{const r=useRef(1);return <b>{r.current}</b>}`
							: kind === "clock"
								? `export const ${name}=()=> <b>{Date.now()}</b>`
								: kind === "directive"
									? `export const ${name}=()=>{'use no memo';return <b>{${JSON.stringify(value)}}</b>}`
									: `export const ${name}=()=> <b>{${JSON.stringify(value)}}</b>`;
					const path = "programs/compiler/window.tsx",
						ledger = kind === "stale" ? [{file: path, fn: name, why: "planted stale row"}] : [];
					expect(check(new Map([[path, source]]), ledger).length).toBeGreaterThan(0);
					writeFileSync(f.file, source);
					const result = await Effect.runPromise(
						Effect.result((await load()).build({...f.options, ledger})).pipe(
							Effect.provide(NodeServices.layer),
						),
					);
					expect(result).toMatchObject({
						_tag: "Failure",
						failure: {_tag: "BuildError", why: "compiler"},
					});
					expect(readFileSync(join(f.options.out, "brain.mjs"), "utf8")).toBe(good);
				},
			),
			{...runs, numRuns: 8},
		);
	});
	it("Compiler plants run independently against the moved real check for every refusal", () => {
		fc.assert(
			fc.property(names, values, (name, value) => {
				const clean = `export const ${name}=(p:{text:string})=><b>{p.text+${JSON.stringify(value)}}</b>`;
				expect(check(new Map([["next/view.tsx", clean]]), [])).toEqual([]);
				for (const source of [
					`export const ${name}=()=> <b>{Date.now()}</b>`,
					`export const ${name}=()=>{'use no memo';return <b>x</b>}`,
					`import {useRef} from 'react';export const ${name}=()=>{const r=useRef(1);return <b>{r.current}</b>}`,
				])
					expect(check(new Map([["next/view.tsx", source]]), []).length).toBeGreaterThan(0);
				expect(
					check(new Map([["next/view.tsx", clean]]), [
						{file: "next/view.tsx", fn: name, why: "plant"},
					]).length,
				).toBeGreaterThan(0);
			}),
			{...runs, numRuns: 12},
		);
	});
});

describe("P16 cleanup and recording", () => {
	for (const point of ["after backup", "before final", "after final"] as const)
		for (const interrupt of [false, true])
			it(`publication plant: ${interrupt ? "interruption" : "failure"} ${point} preserves the last good file`, async () => {
				await fc.assert(
					fc.asyncProperty(values, async (value) => {
						const f = fixture("View", value);
						previous(f, value);
						const entered = Effect.runSync(Deferred.make<void>()),
							release = Effect.runSync(Deferred.make<void>());
						let fired = false;
						const builder = await load();
						const task = Effect.gen(function* () {
							const fs = yield* FileSystem.FileSystem;
							const stop = Effect.gen(function* () {
								fired = true;
								yield* Deferred.succeed(entered, undefined);
								if (interrupt) yield* Deferred.await(release);
								else
									return yield* Effect.fail(
										PlatformError.systemError({
											_tag: "PermissionDenied",
											module: "FileSystem",
											method: "rename",
											description: "planted publication failure",
										}),
									);
							});
							const rename: typeof fs.rename = (from, to) =>
								Effect.gen(function* () {
									const backup = from === f.options.out && to.endsWith(".old");
									const final = to === f.options.out && !from.endsWith(".old");
									if (!fired && point === "before final" && final) yield* stop;
									yield* fs.rename(from, to);
									if (
										!fired &&
										((point === "after backup" && backup) || (point === "after final" && final))
									)
										yield* stop;
								});
							return yield* builder
								.build(f.options)
								.pipe(Effect.provideService(FileSystem.FileSystem, {...fs, rename}));
						}).pipe(Effect.provide(NodeServices.layer));
						if (interrupt) {
							const fiber = Effect.runFork(task);
							try {
								await Effect.runPromise(Effect.race(Deferred.await(entered), Fiber.join(fiber)));
								fiber.interruptUnsafe();
								await Effect.runPromise(Deferred.succeed(release, undefined));
								const exit = await Effect.runPromise(Fiber.await(fiber));
								expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
							} finally {
								await Effect.runPromise(Deferred.succeed(release, undefined));
								await Effect.runPromise(Fiber.interrupt(fiber));
							}
						} else
							expect(await Effect.runPromise(Effect.result(task))).toMatchObject({
								_tag: "Failure",
								failure: {_tag: "BuildError", why: "output"},
							});
						expect(fired, "plant reached the real publication rename").toBe(true);
						expect(
							existsSync(join(f.options.out, "brain.mjs")),
							"last good brain must remain published",
						).toBe(true);
						expect(readFileSync(join(f.options.out, "brain.mjs"), "utf8")).toBe(value);
					}),
					{...runs, numRuns: 2, endOnFailure: true},
				);
			});
	it("cleanup plants run on P12's real bundler: failed and interrupted generation closes acquired handles", async () => {
		await fc.assert(
			fc.asyncProperty(values, async (value) => {
				for (const interrupt of [false, true]) {
					const f = fixture("View", value),
						entry = join(f.home, "inner.ts");
					writeFileSync(entry, `export const text=${JSON.stringify(value)};`);
					const native = await vi.importActual<Roll>("rolldown");
					let closed = false,
						opened = false;
					const entered = Effect.runSync(Deferred.make<void>());
					vi.doMock("rolldown", () => ({
						...native,
						rolldown: async (options: RolldownOptions) => {
							const handle = await native.rolldown(options);
							opened = true;
							return {
								...handle,
								generate: () => {
									Effect.runSync(Deferred.succeed(entered, undefined));
									return interrupt
										? new Promise<RolldownOutput>(() => {})
										: Promise.reject(Error("planted generate failure"));
								},
								close: async () => {
									await handle.close();
									closed = true;
								},
							};
						},
					}));
					vi.resetModules();
					const {bundle} = await import("./node/build.ts");
					if (interrupt) {
						const fiber = Effect.runFork(bundle(entry, []));
						try {
							await Effect.runPromise(Effect.race(Deferred.await(entered), Fiber.join(fiber)));
						} finally {
							await Effect.runPromise(Fiber.interrupt(fiber));
						}
					} else
						expect(await Effect.runPromise(Effect.result(bundle(entry, [])))).toMatchObject({
							_tag: "Failure",
							failure: {_tag: "BuildError"},
						});
					expect(opened).toBe(true);
					expect(closed).toBe(true);
					const cleaned = (value: boolean) => assert(value, "Rolldown handle left open");
					expect(() => cleaned(false)).toThrow("handle left open");
					vi.doUnmock("rolldown");
					vi.resetModules();
				}
			}),
			{...runs, numRuns: 2},
		);
	});
	it("cleanup: failures and interruption at each acquired Rolldown handle close it and preserve old output", async () => {
		await fc.assert(
			fc.asyncProperty(
				values,
				fc.integer({min: 0, max: 2}),
				fc.boolean(),
				async (value, phase, interrupt) => {
					const f = fixture("View", value);
					previous(f, value);
					const native = await vi.importActual<Roll>("rolldown"),
						closed: boolean[] = [];
					const entered = Effect.runSync(Deferred.make<void>());
					let fired = false;
					vi.doMock("rolldown", () => ({
						...native,
						rolldown: async (options: RolldownOptions) => {
							const handle = await native.rolldown(options),
								index = closed.push(false) - 1;
							return {
								...handle,
								generate: (o: OutputOptions) => {
									if (index !== phase) return handle.generate(o);
									fired = true;
									Effect.runSync(Deferred.succeed(entered, undefined));
									return interrupt
										? new Promise<RolldownOutput>(() => {})
										: Promise.reject(new Error("planted private failure"));
								},
								close: async () => {
									await handle.close();
									closed[index] = true;
								},
							};
						},
					}));
					vi.resetModules();
					const task = (await load()).build(f.options).pipe(Effect.provide(NodeServices.layer));
					if (interrupt) {
						const fiber = Effect.runFork(task);
						try {
							await Effect.runPromise(Effect.race(Deferred.await(entered), Fiber.join(fiber)));
						} finally {
							await Effect.runPromise(Fiber.interrupt(fiber));
						}
					} else
						expect(await Effect.runPromise(Effect.result(task))).toMatchObject({
							_tag: "Failure",
							failure: {_tag: "BuildError"},
						});
					expect(fired, "plant must reach selected real build phase").toBe(true);
					expect(closed.length).toBeGreaterThan(0);
					expect(closed.every(Boolean)).toBe(true);
					expect(readFileSync(join(f.options.out, "brain.mjs"), "utf8")).toBe(value);
					vi.doUnmock("rolldown");
					vi.resetModules();
				},
			),
			{
				...runs,
				numRuns: 6,
			},
		);
	});
	it("asset collision plant: duplicate emitted routes fail without publishing partial output", async () => {
		await fc.assert(
			fc.asyncProperty(values, async (value) => {
				const f = fixture("View", value);
				previous(f, value);
				const native = await vi.importActual<Roll>("rolldown");
				let fired = false;
				vi.doMock("rolldown", () => ({
					...native,
					rolldown: async (options: RolldownOptions) => {
						const handle = await native.rolldown(options);
						return {
							...handle,
							generate: async (o: OutputOptions) => {
								const out = await handle.generate(o);
								const css = out.output.find((f) => f.fileName.endsWith(".css"));
								if (!css) return out;
								fired = true;
								return {...out, output: [...out.output, css]};
							},
							close: () => handle.close(),
						};
					},
				}));
				vi.resetModules();
				const result = await Effect.runPromise(
					Effect.result((await load()).build(f.options)).pipe(Effect.provide(NodeServices.layer)),
				);
				expect(fired).toBe(true);
				expect(result).toMatchObject({_tag: "Failure", failure: {_tag: "BuildError"}});
				expect(readFileSync(join(f.options.out, "brain.mjs"), "utf8")).toBe(value);
				vi.doUnmock("rolldown");
				vi.resetModules();
			}),
			runs,
		);
	});
	it("recording: success and failure retain phases, outcomes, duration, versions, sizes and hashes without content", async () => {
		await fc.assert(
			fc.asyncProperty(values, async (value) => {
				for (const phase of ["success", "program", "window", "brain"] as const) {
					const f = fixture("View", value),
						spans: Tracer.Span[] = [];
					const fail = phase !== "success";
					if (fail)
						writeFileSync(
							phase === "brain"
								? f.options.entry
								: phase === "window"
									? f.file
									: join(dirname(f.file), "program.ts"),
							"import './missing.ts';",
						);
					const tracer = Tracer.make({
						span: (o) => {
							const span = new Tracer.NativeSpan(o);
							spans.push(span);
							return span;
						},
					});
					const result = await Effect.runPromise(
						Effect.result((await load()).build(f.options)).pipe(
							Effect.withTracer(tracer),
							Effect.provide(NodeServices.layer),
						),
					);
					expect(result._tag).toBe(fail ? "Failure" : "Success");
					const phases = spans.filter((s) => ["build.bundle", "build.emit"].includes(s.name));
					expect(phases.some((s) => s.name === "build.bundle")).toBe(true);
					const data = phases.map((s) => ({
						name: s.name,
						attributes: Object.fromEntries(s.attributes),
						status: s.status,
					}));
					const verifyPhases = (rows: typeof data) => {
						const bundles = rows.filter((r) => r.name === "build.bundle");
						const order = ["program", "window", "brain"];
						const expected = fail ? order.slice(0, order.indexOf(phase) + 1) : order;
						expect(
							bundles.map((r) => r.attributes.phase),
							"every attempted bundle keeps its phase",
						).toEqual(expected);
						for (const row of bundles) {
							expect(row.attributes.outcome).toBe(
								fail && row.attributes.phase === phase ? "failure" : "success",
							);
							expect(row.attributes["rolldown.version"]).toBe("1.2.13");
							expect(row.attributes["effect.version"]).toBe("4.1.1");
						}
						if (fail) expect(bundles.at(-1)?.attributes["error.type"]).toBe("BuildError");
					};
					verifyPhases(data);
					// Run both review plants on actual recorded output, not invented span rows.
					for (const omit of ["all", "failed"] as const) {
						if (omit === "failed" && !fail) continue;
						const planted = data.map((row) => ({
							...row,
							attributes: Object.fromEntries(
								Object.entries(row.attributes).filter(
									([key]) =>
										key !== "phase" || (omit === "failed" && row.attributes.outcome !== "failure"),
								),
							),
						}));
						expect(() => verifyPhases(planted), `omit ${omit} phase attributes`).toThrow(
							"keeps its phase",
						);
					}
					if (fail)
						expect(() =>
							verifyPhases(data.filter((row) => row.attributes.outcome !== "failure")),
						).toThrow("keeps its phase");
					for (const row of data) {
						expect(row.status._tag).toBe("Ended");
						if (row.status._tag === "Ended")
							expect(row.status.endTime >= row.status.startTime).toBe(true);
						expect(
							Object.values(row.attributes).some((v) => v === "failure" || v === "success"),
						).toBe(true);
					}
					expect(
						data.some((row) =>
							Object.values(row.attributes).includes(fail ? "failure" : "success"),
						),
					).toBe(true);
					const recorded = JSON.stringify(data.map(({name, attributes}) => ({name, attributes})));
					for (const marker of [ROOT, f.home, readFileSync(f.file, "utf8")]) {
						expect(recorded).not.toContain(marker);
						expect(recorded).not.toContain(JSON.stringify(marker).slice(1, -1));
					}
					expect(recorded).toContain("1.2.13");
					expect(recorded).toContain("4.1.1");
					if (fail) expect(recorded).toContain("error.type");
					else {
						expect(data.some((s) => s.name === "build.emit")).toBe(true);
						expect(recorded).toMatch(/[a-f0-9]{64}/);
						expect(
							data
								.flatMap((row) => Object.entries(row.attributes))
								.some(
									([key, value]) =>
										/bytes|size/.test(key) && typeof value === "number" && value > 0,
								),
						).toBe(true);
					}
				}
			}),
			{...runs, numRuns: 3},
		);
	});
});
