import {chmodSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {delimiter, join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {enrichPromptFor, kindOf, promptFor, resultOf, turn} from "./claude.ts";
import type {Issue} from "./issue.ts";
import {rulingNote} from "./triage.ts";

describe("the process a turn starts", () => {
	it("is handed a short environment: a variable set on this machine does not reach it", async () => {
		// A stand-in for `claude`, first on the path: a real child process that answers with the names of its variables.
		const bin = mkdtempSync(join(tmpdir(), "claude-test-"));
		writeFileSync(
			join(bin, "claude"),
			[
				"#!/usr/bin/env node",
				'const names = Object.keys(process.env).sort().join(" ");',
				'console.log(JSON.stringify([{type: "result", is_error: false, result: names, session_id: "s"}]));',
				"",
			].join("\n"),
		);
		chmodSync(join(bin, "claude"), 0o755);
		vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);
		vi.stubEnv("TEA_FABRIKA_MARKER", "set");
		vi.stubEnv("TYPESAFE_API_KEY", "not-a-key");

		const ran = await turn(
			bin,
			{},
			{prompt: "p", session: null, tools: ["Read"]},
			new AbortController().signal,
		).finally(() => {
			vi.unstubAllEnvs();
			rmSync(bin, {recursive: true, force: true});
		});

		const names = ran.text.split(" ");
		expect(names).toContain("PATH");
		expect(names).toContain("HOME");
		expect(names).not.toContain("TEA_FABRIKA_MARKER");
		expect(names).not.toContain("TYPESAFE_API_KEY");
	});
});

const issue: Issue = {
	id: "1",
	title: "slugify turns a title into a URL slug",
	goal: "slugify turns a title into a URL slug",
	body: "Make slugify(title) return a URL slug.",
	criteria: [
		{
			kind: "example",
			id: "lower",
			rule: "The slug is lower case",
			file: "slugify.js",
			name: "slugify",
			uses: [],
			examples: [{call: `slugify("Hi")`, result: `"hi"`}],
		},
		{
			kind: "unchecked",
			id: "docs",
			rule: "The README shows an example",
			files: ["README.md"],
			about: "doc",
			why: "it is about docs",
		},
	],
	openDecision: null,
};

/** A criterion as the enricher writes it, every field set the way an unused one is. */
const written = {
	id: "docs",
	rule: "The README shows an example",
	check: "unchecked" as Parameters<typeof kindOf>[0]["check"],
	file: "",
	name: "",
	uses: [],
	examples: [],
	snippets: [],
	test: "",
	no_example: "it is about docs" as string | null,
	files: [],
	unchecked_kind: "doc" as const,
};

describe("a criterion the enricher wrote", () => {
	it("keeps the files a rule without examples is about, its file among them, once each, and what it is about", () => {
		expect(
			kindOf({...written, file: "README.md", files: ["README.md", " docs/a.md ", ""]}),
		).toEqual({
			kind: "unchecked",
			id: "docs",
			rule: "The README shows an example",
			files: ["README.md", "docs/a.md"],
			about: "doc",
			why: "it is about docs",
		});
	});

	it("may be about no file at all", () => {
		expect(kindOf(written)).toMatchObject({kind: "unchecked", files: []});
	});

	it("keeps the names an example's calls use", () => {
		const uses = [{name: "defineMachine", file: "src/index.ts"}];
		const criterion = kindOf({
			...written,
			id: "replays",
			file: "src/replay.ts",
			name: "replay",
			uses,
			check: "example",
			examples: [{call: "replay(defineMachine({}), { msgs: [] }).state", result: "0"}],
			no_example: null,
		});

		expect(criterion).toMatchObject({kind: "example", file: "src/replay.ts", name: "replay", uses});
	});

	it("becomes a type criterion importing what its snippets use, the named export among them", () => {
		const snippets = [
			{expect: "compiles" as const, today: "fails" as const, code: "replay(pure(), { msgs: [] });"},
			{
				expect: "rejects" as const,
				today: "holds" as const,
				code: "// @ts-expect-error ctx is required\nreplay(db(), { msgs: [] });",
			},
		];
		const criterion = kindOf({
			...written,
			id: "replay-ctx",
			check: "type",
			file: "src/index.ts",
			name: "replay",
			uses: [{name: "defineMachine", file: "src/index.ts"}],
			snippets,
			files: [" src/runtime-types.ts ", ""],
			no_example: null,
		});

		expect(criterion).toEqual({
			kind: "type",
			id: "replay-ctx",
			rule: "The README shows an example",
			files: ["src/runtime-types.ts"],
			uses: [
				{name: "replay", file: "src/index.ts"},
				{name: "defineMachine", file: "src/index.ts"},
			],
			snippets,
		});
	});

	it("becomes an existing test, its test kept out of the files it is about", () => {
		const criterion = kindOf({
			...written,
			check: "existing_test",
			test: " src/docs/replay.test.ts ",
			files: ["docs/replay.md", "src/docs/replay.test.ts"],
			no_example: null,
		});

		expect(criterion).toEqual({
			kind: "existing_test",
			id: "docs",
			rule: "The README shows an example",
			test: "src/docs/replay.test.ts",
			files: ["docs/replay.md"],
		});
	});

	it("is unchecked when its check has nothing to check by: no snippet, no test", () => {
		expect(kindOf({...written, check: "type", no_example: null})).toMatchObject({
			kind: "unchecked",
			why: "no type was given",
		});
		expect(kindOf({...written, check: "existing_test", no_example: null})).toMatchObject({
			kind: "unchecked",
			why: "no existing test was given",
		});
	});
});

describe("the prompt the enricher gets", () => {
	const raw = {
		id: "1",
		title: "slugs look wrong",
		body: "spaces stay in",
		filedBy: "human",
	} as const;

	it("asks for the call nobody has made on the first turn", () => {
		const prompt = enrichPromptFor({raw, facts: null, note: null, session: null});

		expect(prompt).toContain(raw.body);
		expect(prompt).toContain("open_decision");
	});

	it("asks for examples that use the library as its users do and need no unasked change", () => {
		const prompt = enrichPromptFor({raw, facts: null, note: null, session: null});

		expect(prompt).toContain("build it inline with the library's own constructor");
		expect(prompt).toContain("must need no change the issue does not ask for");
		expect(prompt).toContain("list in files the files it is about");
	});

	it("says each example must fail on today's code, and asks what an unchecked rule is about", () => {
		const prompt = enrichPromptFor({raw, facts: null, note: null, session: null});

		expect(prompt).toContain("its assertion must fail");
		expect(prompt).toContain("unchecked_kind");
		expect(prompt).not.toContain("even when the starting code happens to follow it already");
	});

	it("starts from what code found, when it found anything", () => {
		const facts = {
			names: [
				{
					name: "slugify",
					calledIn: null,
					definitions: [
						{
							file: "slugify.js",
							line: 1,
							exported: true,
							signature: "export function slugify(title)",
							package: "slugify",
							published: [{subpath: ".", tier: null}],
							callers: null,
						},
					],
					more: 0,
					mentionedIn: 2,
				},
			],
			paths: [],
			pages: [],
			refs: [],
		};
		const prompt = enrichPromptFor({raw, facts, note: null, session: null});

		expect(prompt).toContain("What code found in this folder");
		expect(prompt).toContain("export function slugify(title)");
		expect(prompt).not.toContain("checked through its twin");
		expect(enrichPromptFor({raw, facts: null, note: null, session: null})).not.toContain(
			"What code found",
		);
	});

	it("says a doc page with a twin is checked through it, not unchecked doc", () => {
		const facts = {
			names: [],
			paths: [],
			pages: [{page: "docs/use.md", twins: ["src/docs/use.test.ts"], more: 0}],
			refs: [],
		};
		const prompt = enrichPromptFor({raw, facts, note: null, session: null});

		expect(prompt).toContain("`src/docs/use.test.ts`");
		expect(prompt).toContain(
			"make it an existing_test criterion naming the twin, with the page in its files",
		);
	});

	it("prefers a checkable kind, and asks for the ticket's type-level limits as guards", () => {
		const prompt = enrichPromptFor({raw, facts: null, note: null, session: null});

		expect(prompt).toContain(
			"Prefer a checkable one: a rule is unchecked only when no snippet or test can show it",
		);
		expect(prompt).toContain("Write the limits the ticket sets");
		expect(prompt).toMatch(/as guards when they are about types/);
		expect(prompt).toContain("`// @ts-expect-error`");
	});

	it("is only the owner's ruling once the conversation holds the issue", () => {
		const note = rulingNote("Keep accents or drop them?", "Drop them.");
		const prompt = enrichPromptFor({raw, facts: null, note, session: "enricher-1"});

		expect(prompt).toBe(note);
		expect(prompt).toContain("Keep accents or drop them?");
		expect(prompt).toContain("Drop them.");
	});
});

describe("the prompt Claude gets", () => {
	it("carries the whole issue on the first build", () => {
		const prompt = promptFor({issue, feedback: null, session: {id: "abc", continues: false}});

		expect(prompt).toContain(issue.title);
		expect(prompt).toContain(issue.body);
		for (const criterion of issue.criteria) expect(prompt).toContain(criterion.rule);
		// The builder sees each example exactly as its test asserts it.
		expect(prompt).toContain(`slugify("Hi") -> "hi"`);
		// And the files an unchecked rule is about, so it knows they are in scope.
		expect(prompt).toContain("(docs; in README.md)");
	});

	it("tells the builder to answer contradiction rather than change what the issue does not ask for", () => {
		const prompt = promptFor({issue, feedback: null, session: {id: "abc", continues: false}});

		expect(prompt).toMatch(
			/only typecheck, by changing something this issue does not ask for[\s\S]*answer contradiction/,
		);
		expect(prompt).toContain(
			"a change to a published name this issue does not name, or a new export, is sent back",
		);
	});

	it("shows each type snippet as the check has it, guards marked, and says where they are checked", () => {
		const typed: Issue = {
			...issue,
			criteria: [
				{
					kind: "type",
					id: "ctx",
					rule: "replay keeps ctx required for a machine that reads it",
					files: ["src/runtime-types.ts"],
					uses: [{name: "replay", file: "src/index.ts"}],
					snippets: [
						{
							expect: "rejects",
							today: "holds",
							code: "// @ts-expect-error ctx is required\nreplay(db(), { msgs: [] });",
						},
					],
				},
				{
					kind: "existing_test",
					id: "page",
					rule: "The how-to still runs",
					test: "src/docs/replay.test.ts",
					files: ["docs/replay.md"],
				},
			],
		};
		const prompt = promptFor(
			{issue: typed, feedback: null, session: {id: "abc", continues: false}},
			"src/f.test.ts",
			"src/f.test-d.ts",
		);

		expect(prompt).toContain(
			"snippet 1, the marked line must be a type error (it holds today: keep it so):",
		);
		expect(prompt).toContain("      replay(db(), { msgs: [] });");
		expect(prompt).toContain("Every type snippet is a block in src/f.test-d.ts");
		expect(prompt).toContain(
			"(page; the test src/docs/replay.test.ts must pass, about docs/replay.md)",
		);
		expect(
			promptFor({issue, feedback: null, session: {id: "abc", continues: false}}),
		).not.toContain("type snippet");
	});

	it("is only the feedback on a retry, because the conversation holds the rest", () => {
		const prompt = promptFor({
			issue,
			feedback: "Tests failed: dashes",
			session: {id: "abc", continues: true},
		});

		expect(prompt).toContain("Tests failed: dashes");
		expect(prompt).not.toContain(issue.body);
	});

	it("repeats the issue when feedback arrives with no conversation to resume", () => {
		const prompt = promptFor({
			issue,
			feedback: "Tests failed: dashes",
			session: {id: "abc", continues: false},
		});

		expect(prompt).toContain(issue.body);
		expect(prompt).toContain("Tests failed: dashes");
	});
});

describe("what a turn cost", () => {
	it("is read off the result event: dollars, time, turns and tokens", () => {
		const printed = JSON.stringify([
			{type: "system", subtype: "init"},
			{
				type: "result",
				is_error: false,
				result: "ok",
				session_id: "s1",
				total_cost_usd: 0.42,
				duration_ms: 61000,
				num_turns: 7,
				usage: {
					input_tokens: 12,
					output_tokens: 3400,
					cache_read_input_tokens: 90000,
					cache_creation_input_tokens: 15000,
				},
			},
		]);
		expect(resultOf(printed).spend).toEqual({
			session: "s1",
			costUsd: 0.42,
			durationMs: 61000,
			turns: 7,
			inputTokens: 12,
			outputTokens: 3400,
			cacheReadTokens: 90000,
			cacheWriteTokens: 15000,
		});
	});

	it("is null where the result leaves a number out", () => {
		const printed = JSON.stringify([
			{type: "result", is_error: false, result: "ok", session_id: "s2"},
		]);
		expect(resultOf(printed).spend).toEqual({
			session: "s2",
			costUsd: null,
			durationMs: null,
			turns: null,
			inputTokens: null,
			outputTokens: null,
			cacheReadTokens: null,
			cacheWriteTokens: null,
		});
	});
});
