// P16, next/. CSS spelling changes must keep the same imported rules.
// Builder contract: `node/css.ts` exports `inlineStylesheet(file)`, an Effect of the stylesheet
// with its local imports inlined, needing FileSystem and Path. A refusal is BuildError with
// `reason: "bundle"` and a message that names what is broken, never a raw parser exception.
import assert from "node:assert/strict";
import {
	existsSync,
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
import {Effect, type FileSystem, type Path, Tracer} from "effect";
import * as fc from "fast-check";
import {bundle, bundleAsync, type Rule, transform} from "lightningcss";
import {afterEach, describe, expect, it, vi} from "vitest";

type Inline = (file: string) => Effect.Effect<string, unknown, FileSystem.FileSystem | Path.Path>;

type Build = {
	readonly build: (options: {
		readonly root: string;
		readonly out: string;
		readonly entry: string;
		readonly programs: readonly {
			readonly name: string;
			readonly package: string;
			readonly export: string;
		}[];
		readonly files: readonly string[];
		readonly ledger: readonly unknown[];
		readonly chaos: boolean;
	}) => Effect.Effect<unknown, unknown, FileSystem.FileSystem | Path.Path>;
};

const product = async <A>(file: string, what: string) => {
	const path = join(import.meta.dirname, file);
	assert(existsSync(path), `P16 not built: ${what} absent`);
	return vi.importActual<A>(pathToFileURL(path).href);
};

const inlineStylesheet = (file: string) =>
	// oxlint-disable-next-line fabrika/no-effect-promise -- a missing product module dies with its "not built" message instead of passing as a typed refusal
	Effect.promise(() =>
		product<{readonly inlineStylesheet: Inline}>("css.ts", "window CSS bundling (node/css.ts)"),
	).pipe(
		Effect.flatMap((m) => m.inlineStylesheet(file)),
		Effect.provide(NodeServices.layer),
	);

const build: Build["build"] = (options) =>
	// oxlint-disable-next-line fabrika/no-effect-promise -- a missing product module dies with its "not built" message instead of passing as a typed refusal
	Effect.promise(() => product<Build>("../build.ts", "libfabrika/build")).pipe(
		Effect.flatMap((m) => m.build(options)),
	);

const runs = {seed: 119120, numRuns: 30};
const ids = fc.integer({min: 0, max: 10000});
const homes: string[] = [];

// Inspect the parsed rules before printing can merge or normalize them. Only locations differ.
const cssRules = (css: string) => {
	let rules: Rule[] = [];
	transform({
		filename: "law.css",
		code: Buffer.from(css),
		visitor: {
			StyleSheet: (sheet) => {
				rules = sheet.rules;
			},
		},
	});
	return rules;
};

const meaning = (rules: readonly Rule[]): unknown =>
	JSON.parse(JSON.stringify(rules, (key, value) => (key === "loc" ? undefined : value)));

const fixture = (id: number) => {
	const home = mkdtempSync("/tmp/p16css.");
	homes.push(home);
	const body = `.child${id} { color: red; }`;
	writeFileSync(join(home, `child${id}.css`), body);
	return {
		home,
		body,
		read: (css: string) => {
			const file = join(home, "root.css");
			writeFileSync(file, css);
			return inlineStylesheet(file);
		},
	};
};

// Every refusal is the build's typed bundle failure. A thrown parser error rejects instead.
const failure = async (stylesheet: Effect.Effect<string, unknown>) => {
	const result = await Effect.runPromise(Effect.result(stylesheet));

	if (result._tag !== "Failure") {
		throw new Error("expected stylesheet failure");
	}

	expect(result.failure).toMatchObject({_tag: "BuildError", reason: "bundle"});
	return result.failure;
};

// The remote sheets are disk fixtures too. Only the oracle resolves their URLs, never the product.
const cssGraphs = fc.record({
	id: ids,
	order: fc.shuffledSubarray([0, 1, 2, 3], {minLength: 4, maxLength: 4}),
	before: fc.boolean(),
	between: fc.boolean(),
	named: fc.boolean(),
});

type CssGraph = typeof cssGraphs extends fc.Arbitrary<infer A> ? A : never;

const graphFixture = (graph: CssGraph, mixed: boolean) => {
	const f = fixture(graph.id),
		order = mixed ? graph.order : graph.order.filter((n) => n < 2),
		statement = "@layer a, b;",
		body = (n: number) => {
			const rule = (layer: string) =>
				`.same.source${n}${layer} { --winner: source${n}-${graph.id}; }`;
			return mixed ? rule("") : `@layer b {${rule("b")}} @layer a {${rule("a")}}`;
		},
		wrapped = (n: number) =>
			graph.named ? `@layer ${n % 2 === 0 ? "a" : "b"} {${body(n)}}` : body(n),
		remote = new Map<string, string>();

	for (const n of order) {
		const file = join(f.home, `source${n}.css`);
		writeFileSync(file, body(n));

		if (mixed && n >= 2) {
			remote.set(`https://test.invalid/source${n}.css`, file);
		}
	}

	const render = (expanded: boolean, sources = order, late = false) => {
		const parts = sources.flatMap((n, i) => [
			...(i === 0 && graph.before && !late ? [statement] : []),
			...(i === 1 && graph.between && !late ? [statement] : []),
			expanded
				? wrapped(n)
				: `@import "${mixed && n >= 2 ? `https://test.invalid/source${n}.css` : `./source${n}.css`}"${graph.named ? ` layer(${n % 2 === 0 ? "a" : "b"})` : ""};`,
		]);

		if (late && (graph.before || graph.between)) {
			parts.push(statement);
		}

		return parts.join("\n");
	};
	const file = join(f.home, "root.css");
	writeFileSync(file, render(false));
	const oracle = async (path: string) =>
		(
			await bundleAsync({
				filename: path,
				resolver: {
					resolve: (url, from) => remote.get(url) ?? resolve(dirname(from), url),
					read: (path) => readFileSync(path, "utf8"),
				},
			})
		).code.toString();
	const expanded = (css: string) => {
		const path = join(f.home, "expanded.css");
		writeFileSync(path, css);
		return bundle({filename: path}).code.toString();
	};
	return {...f, file, order, render, oracle, expanded};
};

// A parser refusal is acceptable only if the real build returns its typed bundle failure.
// A tiny program/window drives the production CSS plugin; no test catches and retags its error.
const refusedBuild = async (home: string) => {
	const pkg = join(home, "node_modules/@p16/css");
	mkdirSync(pkg, {recursive: true});

	for (const name of ["effect", "@demlik", "@kampus"]) {
		symlinkSync(
			resolve(import.meta.dirname, "../../../../apps/fabrika/node_modules", name),
			join(home, "node_modules", name),
			"dir",
		);
	}

	writeFileSync(join(home, "package.json"), '{"type":"module"}');
	writeFileSync(
		join(pkg, "package.json"),
		JSON.stringify({type: "module", exports: {".": "./program.ts", "./window": "./window.js"}}),
	);
	writeFileSync(join(pkg, "program.ts"), 'export {counter as program} from "@kampus/counter";');
	writeFileSync(join(pkg, "window.js"), `import ${JSON.stringify(join(home, "root.css"))};`);
	writeFileSync(join(home, "brain.ts"), "export const ready = true;");
	const attempt = build({
		root: home,
		out: join(home, "dist"),
		entry: join(home, "brain.ts"),
		programs: [{name: "css", package: "@p16/css", export: "program"}],
		files: [],
		ledger: [],
		chaos: false,
	}).pipe(Effect.result, Effect.provide(NodeServices.layer));
	const file = join(home, "root.css"),
		original = readFileSync(file, "utf8");

	try {
		writeFileSync(file, ".baseline { color: red; }");
		expect(
			await Effect.runPromise(attempt),
			"the same build succeeds with supported CSS",
		).toMatchObject({_tag: "Success"});
	} finally {
		writeFileSync(file, original);
	}

	return Effect.runPromise(attempt);
};

afterEach(() => {
	for (const home of homes.splice(0)) {
		rmSync(home, {recursive: true, force: true});
	}
});

describe("P16 CSS tokens", () => {
	it("CSS refusals keep their exact reason and named span in root and imported files", async () => {
		vi.resetModules();
		const read = inlineStylesheet;
		await fc.assert(
			fc.asyncProperty(
				ids,
				fc.boolean(),
				fc.constantFrom("file", "layer", "supports", "missing"),
				async (id, nested, kind) => {
					const f = fixture(id),
						spans: Tracer.Span[] = [],
						tracer = Tracer.make({
							span(options) {
								const span = new Tracer.NativeSpan(options);
								spans.push(span);
								return span;
							},
						}),
						css =
							kind === "file"
								? `.root${id} { background: url(./image${id}.png); }`
								: kind === "missing"
									? `@import "./stylesheet ${id}:missing.css";`
									: `@import "child${id}.css" ${kind === "layer" ? "layer(theme)" : "supports(display: grid)"};`,
						reason =
							kind === "file"
								? "stylesheet references a file"
								: kind === "missing"
									? expect.stringMatching(/^stylesheet has a broken @import:/)
									: "unsupported @import condition";

					if (nested) {
						writeFileSync(join(f.home, `child${id}.css`), css);
					}

					const file = join(f.home, "root.css");
					writeFileSync(file, nested ? `@import "child${id}.css";` : css);
					expect(await failure(read(file).pipe(Effect.withTracer(tracer)))).toMatchObject({
						message: reason,
					});
					expect(spans.map((span) => span.name)).toContain("build.css");
					expect(spans.find((span) => span.name === "build.css")?.status._tag).toBe("Ended");
				},
			),
			runs,
		);
	});

	// First layer appearance and source order decide the cascade, including imported sheets.
	// https://www.w3.org/TR/css-cascade-5/#layer-order
	// https://www.w3.org/TR/css-cascade-5/#at-import
	for (const kind of ["before", "between", "named", "mixed"] as const) {
		it(`CSS graph cascade: ${kind} imports keep layer priority and source rule order or refuse with BuildError`, async () => {
			await fc.assert(
				fc.asyncProperty(cssGraphs, async (generated) => {
					const graph = {
						...generated,
						before: kind === "before" || generated.before,
						between: kind === "between" || (kind !== "before" && generated.between),
						named: kind === "named",
					};
					const f = graphFixture(graph, kind === "mixed");
					// 1.33.0 rejects a statement between imports, although Cascade 5 allows it.
					// For that parser gap, bundle the fixture's literal expansion in source order.
					const expected = graph.between ? f.expanded(f.render(true)) : await f.oracle(f.file);
					const verify = (css: string) =>
						expect(meaning(cssRules(css)), "cascade layer priority and source rule order").toEqual(
							meaning(cssRules(expected)),
						);
					// Plants: lose a source; reverse rules that compete in the same layer; move declarations.
					expect(() => verify(f.expanded(f.render(true, f.order.slice(0, -1))))).toThrow(
						"cascade layer priority",
					);

					if (!graph.named) {
						expect(() => verify(f.expanded(f.render(true, [...f.order].reverse())))).toThrow(
							"cascade layer priority",
						);
					}

					const remoteAfterLocal =
						kind === "mixed" &&
						f.order.some((n, i) => n >= 2 && f.order.slice(0, i).some((previous) => previous < 2));

					if (remoteAfterLocal) {
						const hoisted = [...f.order.filter((n) => n >= 2), ...f.order.filter((n) => n < 2)];
						expect(() => verify(f.expanded(f.render(true, hoisted)))).toThrow("source rule order");
					}

					if (kind === "before") {
						expect(() => verify(f.expanded(f.render(true, f.order, true)))).toThrow(
							"cascade layer priority",
						);
					}

					const output = await Effect.runPromise(Effect.result(inlineStylesheet(f.file)));

					if (output._tag === "Failure") {
						expect(
							graph.named || graph.between || remoteAfterLocal,
							"a supported graph must bundle",
						).toBe(true);
						expect(output.failure).toMatchObject({_tag: "BuildError", reason: "bundle"});
						expect(await refusedBuild(f.home)).toMatchObject({
							_tag: "Failure",
							failure: {_tag: "BuildError", reason: "bundle"},
						});
						return;
					}

					const file = join(f.home, "actual.css");
					writeFileSync(file, output.success);
					verify(await f.oracle(file));
				}),
				{
					seed: runs.seed,
					numRuns: 8,
					examples: [
						[{id: 0, order: [0, 2, 1, 3], before: kind === "before", between: false, named: false}],
					],
					// Pinned round-4 bugs: parent layer priority and a later remote import overtaking a local.
					endOnFailure: true,
				},
			);
		});
	}

	// The expected rule comes from the file, never from decoding the generated import spelling.
	const verifyImport = (css: string, id: number) => {
		expect(
			meaning(cssRules(css)),
			"the imported rule must appear once, with its declarations",
		).toEqual(meaning(cssRules(`.child${id} { color: red; }`)));
	};
	const imported = (css: string, id: number) => {
		verifyImport(css, id);

		// Drop or repeat the actual child output. Both must fail the same semantic check.
		for (const plant of ["", `${css}\n${css}`]) {
			expect(() => verifyImport(plant, id)).toThrow("imported rule");
		}
	};
	it("escaped at-keywords import the same file as their unescaped spelling", async () => {
		await fc.assert(
			fc.asyncProperty(
				ids,
				fc.constantFrom("im\\70ort", "\\69mport", "\\000069mport", "i\\mport"),
				async (id, keyword) => {
					const f = fixture(id),
						css = `@${keyword} "./child${id}.css";`;
					// Plant the review bug: leave the import in the served text without its child.
					expect(() => verifyImport(css, id)).toThrow("imported rule");
					imported(await Effect.runPromise(f.read(css)), id);
				},
			),
			{...runs, examples: [[0, "im\\70ort"]]}, // Pinned round-3 escaped @import bug.
		);
	});
	it("escaped url functions import the same file as their unescaped spelling", async () => {
		await fc.assert(
			fc.asyncProperty(
				ids,
				fc.constantFrom("u\\72l", "\\75rl", "\\000075rl", "u\\rl"),
				fc.constantFrom('"', "'", ""),
				async (id, url, quote) => {
					const f = fixture(id),
						css = `@import ${url}(${quote}./child${id}.css${quote});`;
					expect(() => verifyImport(css, id)).toThrow("imported rule");
					imported(await Effect.runPromise(f.read(css)), id);
				},
			),
			{...runs, examples: [[0, "u\\72l", '"']]}, // Pinned round-3 escaped url() bug.
		);
	});

	// CSS Syntax 3 normalizes CRLF, CR and form feed to LF before consuming strings.
	// https://www.w3.org/TR/css-syntax-3/#input-preprocessing
	for (const [ending, newline] of [
		["LF", "\n"],
		["CRLF", "\r\n"],
		["CR", "\r"],
		["form feed", "\f"],
	]) {
		it(`${ending} string continuations import the same disk name after CSS input preprocessing`, async () => {
			await fc.assert(
				fc.asyncProperty(ids, fc.constantFrom('"', "'"), async (id, quote) => {
					const f = fixture(id),
						css = `@import ${quote}./chi\\${newline}ld${id}.css${quote};`;
					expect(() => verifyImport(css, id)).toThrow("imported rule");
					imported(await Effect.runPromise(f.read(css)), id);
				}),
				runs,
			);
		});
	}

	it("comments and whitespace around a quoted import URL keep every imported rule", async () => {
		await fc.assert(
			fc.asyncProperty(
				ids,
				fc.constantFrom(" ", "\t", "\n", "\r", "\f", "/**/", " /*first*/\t/*second*/ "),
				fc.constantFrom('"', "'"),
				async (id, gap, quote) => {
					expect.hasAssertions();
					const f = fixture(id);
					// A quoted url() allows whitespace before its quote, but no comment there.
					// https://www.w3.org/TR/css-syntax-3/#consume-ident-like-token
					const space = gap.includes("/*") ? " " : gap;
					imported(
						await Effect.runPromise(
							f.read(`@import${gap}url(${space}${quote}./child${id}.css${quote}${gap});`),
						),
						id,
					);

					if (gap.includes("/*")) {
						expect(
							await failure(
								f.read(`@import${gap}url(${gap}${quote}./child${id}.css${quote}${gap});`),
							),
						).toMatchObject({message: expect.stringContaining("stylesheet has a broken url()")});
					}
				},
			),
			runs,
		);
	});

	it("hex escapes consume only their digits and optional whitespace, including CRLF", async () => {
		await fc.assert(
			fc.asyncProperty(
				ids,
				fc.constantFrom("", " ", "\t", "\n", "\r", "\f", "\r\n"),
				async (id, gap) => {
					const f = fixture(id);
					imported(await Effect.runPromise(f.read(`@import "\\63${gap}hild${id}.css";`)), id);
				},
			),
			runs,
		);
	});

	it("an asterisk inside a quoted filename does not start a comment", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom('"', "'"), async (id, quote) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `*child${id}.css`), f.body);
				imported(
					await Effect.runPromise(f.read(`@import url(${quote}*child${id}.css${quote});`)),
					id,
				);
			}),
			runs,
		);
	});

	it("whitespace ends an unquoted URL only when the closing parenthesis follows", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom(" ", "\t", "\n", "\r", "\f"), async (id, gap) => {
				const f = fixture(id);
				imported(await Effect.runPromise(f.read(`@import url(./child${id}.css${gap});`)), id);
				expect(
					await failure(f.read(`a { background: url(https://test.invalid/a${gap}b); }`)),
				).toMatchObject({
					message: expect.stringContaining("stylesheet has a broken url()"),
				});
			}),
			runs,
		);
	});

	it("zero, surrogate and out-of-range hex escapes name the replacement character", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom("0", "d800", "dfff", "110000"), async (id, hex) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `child�${id}.css`), f.body);
				imported(await Effect.runPromise(f.read(`@import "child\\${hex} ${id}.css";`)), id);
			}),
			runs,
		);
	});

	it("a hex escape ends after six digits even when the filename continues with hex digits", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom("af", "face", "00"), async (id, suffix) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `c${suffix}${id}.css`), f.body);
				imported(await Effect.runPromise(f.read(`@import "\\000063${suffix}${id}.css";`)), id);
			}),
			runs,
		);
	});

	it("a newline in a quoted reference fails instead of accepting a different disk name", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom('"', "'"), async (id, quote) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `child\n${id}.css`), f.body);
				expect(await failure(f.read(`@import ${quote}child\n${id}.css${quote};`))).toMatchObject({
					message: expect.stringContaining("stylesheet has a broken string"),
				});
			}),
			runs,
		);
	});

	it("a string token ending at the end of the file still imports its stylesheet", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom('"', "'"), async (id, quote) => {
				const f = fixture(id);
				imported(await Effect.runPromise(f.read(`@import ${quote}child${id}.css`)), id);
			}),
			runs,
		);
	});

	it("media comments become whitespace and do not hide the following root rule", async () => {
		await fc.assert(
			fc.asyncProperty(
				ids,
				fc.constantFrom("", "note", "* longer *", "line\nnext"),
				async (id, note) => {
					const f = fixture(id),
						last = `.root${id} { color: blue; }`;
					const rules = cssRules(
						await Effect.runPromise(
							f.read(`@import "child${id}.css" print/*${note}*/and/*${note}*/(color);${last}`),
						),
					);
					const verify = (actual: readonly Rule[]) =>
						expect(meaning(actual), "imported rules keep their order and media condition").toEqual(
							meaning(cssRules(`@media print and (color) {${f.body}}${last}`)),
						);
					verify(rules);
					const media = rules[0]!;
					expect(media.type).toBe("media");

					if (media.type !== "media") {
						throw new Error("imported media rule missing");
					}

					for (const plant of [
						rules.slice(1),
						[media, ...rules],
						[...rules].reverse(),
						[...media.value.rules, ...rules.slice(1)],
					]) {
						expect(() => verify(plant)).toThrow("imported rules");
					}
				},
			),
			runs,
		);
	});

	it("layer and supports imports fail before their rules can become a media query", async () => {
		// 1.33.0 reports layer:null for both bare layer and no layer, and dependencies omit it.
		// Keep the refusal: flattening an anonymous layer changes the cascade. Raw CSS retains it.
		await fc.assert(
			fc.asyncProperty(
				ids,
				fc.constantFrom("layer", "layer(theme)", "supports(display: grid)", "LAYER(theme)"),
				async (id, condition) => {
					const f = fixture(id);
					expect(await failure(f.read(`@import "child${id}.css" ${condition};`))).toMatchObject({
						message: expect.stringContaining("unsupported @import condition"),
					});
				},
			),
			{...runs, examples: [[0, "layer"]]}, // Pinned 1.33.0 anonymous-layer loss.
		);
	});

	it("a bare layer on a later import is refused after ordinary imports and line breaks", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom(" ", "\n", "\r\n", "\r", "\f"), async (id, gap) => {
				const f = fixture(id),
					first = `@import "child${id}.css";${gap}`,
					last = `.root${id} { color: blue; }`;
				const verify = async (condition: string) =>
					expect(
						await failure(f.read(`${first}@import "child${id}.css" ${condition};${gap}${last}`)),
					).toMatchObject({message: expect.stringContaining("unsupported @import condition")});
				await verify("layer");
				// Removing the unsupported condition must make this refusal check fail.
				await expect(verify("")).rejects.toThrow("expected stylesheet failure");
			}),
			runs,
		);
	});

	it("nested stylesheets keep remote imports with their media conditions before local rules", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom("print", "screen and (color)"), async (id, media) => {
				const f = fixture(id),
					remote = `@import url("https://test.invalid/theme${id}.css") ${media};`,
					last = `.root${id} { color: blue; }`;
				writeFileSync(join(f.home, `child${id}.css`), `${remote}\n${f.body}`);
				const verify = (css: string) =>
					expect(
						meaning(cssRules(css)),
						"nested imports keep their URLs, order and conditions",
					).toEqual(meaning(cssRules(`${remote}\n${f.body}\n${last}`)));
				verify(await Effect.runPromise(f.read(`@import "child${id}.css";\n${last}`)));

				for (const plant of [
					`${f.body}\n${last}`,
					`@import url("https://test.invalid/theme${id}.css");\n${f.body}\n${last}`,
				]) {
					expect(() => verify(plant)).toThrow("nested imports");
				}
			}),
			runs,
		);
	});

	it("broken CSS reports a BuildError that names the broken token", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom("string", "url()", "@import"), async (id, token) => {
				const f = fixture(id);
				const css =
					token === "string"
						? `@import "child\n${id}.css";`
						: token === "url()"
							? `a { background: url(https://test.invalid/a ${id}); }`
							: `@import ("child${id}.css");`;
				const error = await failure(f.read(css));
				const verify = (actual: unknown) => {
					expect(actual).toMatchObject({
						_tag: "BuildError",
						reason: "bundle",
						message: expect.stringContaining(`stylesheet has a broken ${token}`),
					});
				};
				verify(error);

				for (const plant of [undefined, new Error("wrong reason")]) {
					expect(() => verify(plant)).toThrow();
				}
			}),
			runs,
		);
	});

	it("CSS multiplication does not hide a later local file reference", async () => {
		await fc.assert(
			fc.asyncProperty(ids, async (id) => {
				const f = fixture(id);
				expect(
					await failure(
						f.read(`.root { width: calc(1*${id}px); background: url(./image${id}.png); }`),
					),
				).toMatchObject({message: expect.stringContaining("stylesheet references a file")});
			}),
			runs,
		);
	});

	it("unquoted remote URLs reject quote and parenthesis characters", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom('"', "'", "("), async (id, char) => {
				const f = fixture(id);
				expect(
					await failure(f.read(`a { background: url(https://test.invalid/a${char}${id}); }`)),
				).toMatchObject({
					message: expect.stringContaining("stylesheet has a broken url()"),
				});
			}),
			runs,
		);
	});

	it("a scheme-like word inside a relative path still names a local file", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom("https", "data", "custom+3"), async (id, scheme) => {
				const f = fixture(id);
				expect(
					await failure(f.read(`a { background: url(./folder/${scheme}:${id}.png); }`)),
				).toMatchObject({
					message: expect.stringContaining("stylesheet references a file"),
				});
			}),
			runs,
		);
	});

	it("an escaped identifier ending in url is not a URL function", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom("61", "000061", "62", "000062"), async (id, hex) => {
				const f = fixture(id),
					css = `a { --value: \\${hex}url(./file${id}.png); }`;
				const expected = cssRules(
					`a { --value: ${hex.endsWith("61") ? "a" : "b"}url(./file${id}.png); }`,
				);
				const verify = (rules: readonly Rule[]) =>
					expect(meaning(rules), "the escaped function and its argument must remain").toEqual(
						meaning(expected),
					);
				const rules = cssRules(await Effect.runPromise(f.read(css)));
				verify(rules);

				for (const plant of [
					[],
					[...rules, ...rules],
					cssRules(`a { --value: url(./file${id}.png); }`),
				]) {
					expect(() => verify(plant)).toThrow("escaped function");
				}
			}),
			runs,
		);
	});

	it("parentheses without the URL keyword are a broken import", async () => {
		await fc.assert(
			fc.asyncProperty(ids, fc.constantFrom('"', "'"), async (id, quote) => {
				const f = fixture(id);
				expect(await failure(f.read(`@import (${quote}child${id}.css${quote});`))).toMatchObject({
					message: expect.stringContaining("stylesheet has a broken @import"),
				});
			}),
			runs,
		);
	});

	it("an imported file cannot hide an import cycle behind another relative path", async () => {
		await fc.assert(
			fc.asyncProperty(ids, async (id) => {
				const f = fixture(id);
				writeFileSync(join(f.home, `child${id}.css`), '@import "./root.css";');
				expect(await failure(f.read(`@import "./child${id}.css";`))).toMatchObject({
					message: expect.stringContaining("stylesheet imports itself"),
				});
			}),
			runs,
		);
	});
});
