import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

const script = join(import.meta.dirname, "loosening.sh");
const word = fc.stringMatching(/^[a-z]{2,12}$/);
const input = fc.record({
	name: word,
	extra: word,
	title: fc.constantFrom("it", "test"),
	count: fc.integer({min: 20, max: 200}),
	delta: fc.integer({min: 1, max: 8}),
	space: fc.constantFrom(" ", "\n\t"),
});
type Input = {
	name: string;
	extra: string;
	title: string;
	count: number;
	delta: number;
	space: string;
};
const source = (
	v: Input,
	body = "expect(value).toBe(value);",
	modifier = "",
	title = v.name,
	options = "",
) =>
	`${v.title}${modifier}(${JSON.stringify(title)}, () => { fc.assert(fc.property(fc.integer({min: ${-v.count}, max: ${v.count}}), value => { ${body} }), {numRuns: ${v.count}${options}}); });\n`;
const env = {
	...process.env,
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_TERMINAL_PROMPT: "0",
	TYPESAFE_API_KEY: undefined,
};
const compare = (
	before: Record<string, string>,
	after: Record<string, string>,
	mapping?: string,
) => {
	const dir = mkdtempSync(join(tmpdir(), "loosening-"));
	const git = (...args: string[]) => {
		const ran = spawnSync("/usr/bin/git", ["-C", dir, ...args], {
			encoding: "utf8",
			env,
			timeout: 5_000,
		});
		expect(ran.status, ran.stderr).toBe(0);
		return ran.stdout.trim();
	};
	try {
		git("init", "-q", "--initial-branch=main");
		git("config", "user.name", "Fixture");
		git("config", "user.email", "fixture@example.test");
		expect(git("remote")).toBe("");
		// Use the real exam classifier, with generated paths covered by the real list.
		const rows = [{glob: "checks/**/*.test.ts"}, {glob: "checks/**/*.test.tsx"}];
		writeFileSync(join(dir, "exam-paths.json"), JSON.stringify(rows));
		const write = (files: Record<string, string>) => {
			for (const [path, content] of Object.entries(files)) {
				mkdirSync(dirname(join(dir, path)), {recursive: true});
				writeFileSync(join(dir, path), content);
			}
			git("add", ".");
			git("commit", "-qm", "fixture", "--allow-empty");
			return git("rev-parse", "HEAD");
		};
		const base = write(before);
		for (const path of Object.keys(before)) if (!(path in after)) rmSync(join(dir, path));
		const head = write(after);
		const args = [script, base, head];
		if (mapping !== undefined) {
			writeFileSync(join(dir, "mapping.md"), mapping);
			args.push(join(dir, "mapping.md"));
		}
		const got = spawnSync("sh", args, {cwd: dir, encoding: "utf8", env, timeout: 5_000});
		expect(got.error).toBeUndefined();
		expect(got.signal).toBeNull();
		return {code: got.status, text: got.stdout + got.stderr};
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
};
const file = "checks/nested/generated.test.ts";
const flagged = (v: Input, before: string, after: string, kind: string, mapping?: string) => {
	const got = compare({[file]: before}, {[file]: after}, mapping);
	expect(got.code, got.text).toBe(1);
	expect(got.text).toContain(`${file}: ${kind}: ${v.name}`);
};

describe("loosening, today's tooling", () => {
	// Plant: stop reporting a disappeared it/test/fc.property, or trust a mapping with no replacement.
	it("T318 removed laws and properties require an existing named replacement", () => {
		fc.assert(
			fc.property(input, (v) => {
				const original = source(v);
				for (const after of ["", `// ${original}`, original.replace("fc.property", "fc.sample")])
					flagged(v, original, after, "removed law");
				flagged(
					v,
					original,
					"",
					"removed law",
					`| Removed | Replacement |\n| --- | --- |\n| ${v.name} | nonexistent |`,
				);
				const deleted = compare({[file]: original}, {});
				expect(deleted.code).toBe(1);
				expect(deleted.text).toContain(`${file}: removed law: ${v.name}`);
			}),
			{seed: 3181, numRuns: 4},
		);
	});

	// Plants: ignore skip, todo, it.fails, or only, including describe and parameterized tests.
	it("T318 each muting modifier is reported even when the law name survives", () => {
		fc.assert(
			fc.property(input, (v) => {
				for (const modifier of ["skip", "todo", "fails", "only"]) {
					const got = compare({[file]: source(v)}, {[file]: source(v, undefined, `.${modifier}`)});
					expect(got.code, got.text).toBe(1);
					expect(got.text).toContain(`${file}: ${modifier === "fails" ? "it.fails" : modifier}:`);
				}
				for (const modifier of ["skip", "only"]) {
					const got = compare(
						{[file]: `describe('${v.name}', () => {${source(v)}});`},
						{[file]: `describe.${modifier}('${v.name}', () => {${source(v)}});`},
					);
					expect(got.code, got.text).toBe(1);
					expect(got.text).toContain(`: ${modifier}:`);
				}
				flagged(
					v,
					`test.each([1])('${v.name}', () => expect(1).toBe(1));`,
					`test.skip.each([1])('${v.name}', () => expect(1).toBe(1));`,
					"skip",
				);
			}),
			{seed: 3182, numRuns: 4},
		);
	});

	// Plant: ignore a smaller numRuns or either inward bound. Exercise each key alone.
	it("T318 fewer runs and every inward fast-check bound are separate hits", () => {
		fc.assert(
			fc.property(input, (v) => {
				flagged(
					v,
					source(v),
					source(v).replace(`numRuns: ${v.count}`, `numRuns: ${v.count - v.delta}`),
					"fewer numRuns",
				);
				const shared = `const options = {numRuns: ${v.count}};\n${source(v).replace(`{numRuns: ${v.count}}`, "options")}`;
				const got = compare(
					{[file]: shared},
					{[file]: shared.replace(`numRuns: ${v.count}`, `numRuns: ${v.count - v.delta}`)},
				);
				expect(got.code, got.text).toBe(1);
				expect(got.text).toContain(": fewer numRuns:");
				for (const key of ["min", "max", "minLength", "maxLength"]) {
					const start = v.count,
						end = start + (key.startsWith("min") ? v.delta : -v.delta);
					const before = `${v.title}('${v.name}', () => fc.assert(fc.property(fc.array(fc.integer(), {${key}: ${start}}), xs => expect(xs).toBeDefined())));`;
					flagged(
						v,
						before,
						before.replace(`${key}: ${start}`, `${key}: ${end}`),
						"tighter fast-check bound",
					);
				}
			}),
			{seed: 3183, numRuns: 4},
		);
	});

	// Plant: compare expect counts only for the whole file; a new test must not hide an old loss.
	it("T318 removed expects are found per law despite added assertions elsewhere", () => {
		fc.assert(
			fc.property(input, (v) => {
				flagged(
					v,
					source(v),
					source(v, "") + source(v, undefined, "", `${v.name}-added`),
					"removed expect",
				);
				flagged(v, source(v), source(v, "expect(true).toBe(true);"), "removed expect");
			}),
			{seed: 3184, numRuns: 5},
		);
	});

	// Plants: flag all changed files or all renames; accept a missing replacement through any prose mention.
	it("T318 pure additions wrapping wider ranges and mapped renames pass with exact exam counts", () => {
		let accepted = 0;
		fc.assert(
			fc.property(input, (v) => {
				const before = source(v),
					renamed = `${v.name}-${v.extra}`;
				for (const [after, map] of [
					[before + source(v, undefined, "", renamed), undefined],
					[before.replaceAll(" ", v.space), undefined],
					[before.replace("fc.assert(", "fc.integer({min: 0, max: 1}); fc.assert("), undefined],
					[
						before
							.replace(`min: ${-v.count}`, `min: ${-v.count - v.delta}`)
							.replace(`max: ${v.count}`, `max: ${v.count + v.delta}`)
							.replace(`numRuns: ${v.count}`, `numRuns: ${v.count + v.delta}`),
						undefined,
					],
					[
						source(v, undefined, "", renamed),
						`Unrelated text\n\n| replacement | removed |\n| --- | --- |\n| \`${renamed}\` | \`${v.name}\` |\n`,
					],
					[
						source(v, undefined, "", renamed),
						`removed | replacement\n--- | ---\n${v.name} | ${renamed}\n`,
					],
				] as const) {
					const got = compare(
						{[file]: before, "product.ts": before},
						{[file]: after, "product.ts": "it.skip('ignored');"},
						map,
					);
					expect(got.code, got.text).toBe(0);
					expect(got.text.trim()).toBe(
						`loosening: 0 hits in ${after === before ? 0 : 1} exam files`,
					);
					accepted++;
				}
				const moved = compare(
					{[file]: before},
					{"checks/moved.test.tsx": source(v, undefined, "", renamed)},
					`| removed | replacement |\n| --- | --- |\n| ${v.name} | ${renamed} |`,
				);
				expect(moved.code, moved.text).toBe(0);
				expect(moved.text).toContain("0 hits in 2 exam files");
				accepted++;
				const onlyProduct = compare({"product.ts": before}, {"product.ts": "it.only('ignored');"});
				expect(onlyProduct.code).toBe(0);
				expect(onlyProduct.text).toContain("0 hits in 0 exam files");
				accepted++;
				const existing = `describe.skip('${v.name}', () => {${before}});`;
				const shifted = compare(
					{[file]: existing},
					{[file]: `// ${v.extra}\n${existing}\n${source(v, undefined, "", renamed)}`},
				);
				expect(shifted.code, shifted.text).toBe(0);
				accepted++;
			}),
			{seed: 3185, numRuns: 4},
		);
		console.info(
			`T318 loosening: ${accepted} clean diffs accepted, 0 false alarms; history measurement belongs to lead`,
		);
	});

	// Plant: compare the matcher's expected value as though its expect call disappeared.
	it("T318 updating a matcher argument keeps the existing expect", () => {
		fc.assert(
			fc.property(input, (v) => {
				const before = source(v),
					after = before.replace(".toBe(value)", `.toBe(${v.count})`);
				const got = compare({[file]: before}, {[file]: after});
				expect(got.code, got.text).toBe(0);
				expect(got.text.trim()).toBe("loosening: 0 hits in 1 exam files");
			}),
			{seed: 3186, numRuns: 4},
		);
	});
});
