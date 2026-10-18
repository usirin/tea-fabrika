import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import type {Open} from "../../draft";
import {initOf, resultOf, scriptedOpen} from "../../draft-scripted";
import {carryOnOf, draftLive, promptOf} from "./builder";
import {builderRefusal} from "./check";
import type {BuildBrief} from "./form";
import {lockOf} from "./guarded";

// The builder's own rule, its prompt, and what it hands the SDK. No agent runs here.

const TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];

const TREE = "/work/trees/1";
const TEMP = ["/private/tmp"];
const refused = (tool: string, input: Record<string, unknown>) =>
	builderRefusal(TREE, TEMP, tool, input);

describe("the builder's rule", () => {
	it("reads stay in the working copy and the temp folder", () => {
		expect(refused("Read", {file_path: `${TREE}/src/a.ts`})).toBeNull();
		expect(refused("Read", {file_path: "src/a.ts"})).toBeNull();
		expect(refused("Grep", {path: "/private/tmp/out"})).toBeNull();
		expect(refused("Read", {file_path: "/srv/elsewhere/.config/gh/hosts.yml"})).toContain(
			"outside your working copy",
		);
		expect(refused("Glob", {path: "../../.ssh"})).toContain("outside your working copy");
	});

	it.each([
		"gh pr create",
		"git push origin HEAD",
		"cd x && git fetch",
		"curl https://example.com",
		"pnpm publish",
		"git remote add up https://github.com/kamp-us/demlik",
		"git config credential.helper store",
	])("a command that talks to the network or GitHub is refused: %s", (command) => {
		expect(refused("Bash", {command})).toContain("no network");
	});

	it("a command that asks to leave the sandbox is refused; plain checks are not", () => {
		expect(refused("Bash", {command: "ls", dangerouslyDisableSandbox: true})).toContain("sandbox");
		expect(refused("Bash", {command: "nice -n 19 pnpm --filter @demlik/tea test"})).toBeNull();
		expect(refused("Bash", {command: "git diff --stat"})).toBeNull();
	});
});

describe("the builder's prompt", () => {
	const brief: BuildBrief = {
		ticket: "https://github.com/kamp-us/tea-fabrika-sandbox/issues/1",
		number: 1,
		title: "stop() hangs",
		body: "the body",
		criteria: [{n: 1, text: "it ends", checked: false, evidence: null}],
		round: 2,
		open: [
			{
				n: 1,
				text: "it ends",
				says: "no test proves it",
				where: ["src/a.ts:3"],
				wants: ["a test that fails at the base"],
			},
		],
		tree: TREE,
		branch: "build/1",
		session: "00000000-0000-4000-8000-000000000001",
	};

	it("a later round is told what the last review left open, in the review's words", () => {
		const text = promptOf(brief);
		expect(text).toContain("no test proves it");
		expect(text).toContain("a test that fails at the base");
		expect(text).toContain("src/a.ts:3");
	});

	it("a first round is told nothing is open", () => {
		expect(promptOf({...brief, round: 1, open: []})).not.toContain("no test proves it");
	});
});

describe("the builder started again", () => {
	const brief: BuildBrief = {
		ticket: "https://github.com/kamp-us/tea-fabrika-sandbox/issues/1",
		number: 1,
		title: "stop() hangs",
		body: "the body",
		criteria: [{n: 1, text: "it ends", checked: false, evidence: null}],
		round: 1,
		open: [],
		tree: TREE,
		branch: "build/1",
		session: "00000000-0000-4000-8000-000000000002",
	};
	const FORM = {summary: "done", deviations: [], ran: [], left: []};

	/** One scripted run, told whether a conversation is kept. Answers what the SDK was handed. */
	const runWith = async (kept: boolean) => {
		const query = scriptedOpen([initOf([...TOOLS, "StructuredOutput"]), resultOf(FORM)]);
		const prompts: string[] = [];
		const open: Open = (params) => {
			prompts.push(params.prompt);
			return query.open(params);
		};
		const drafted = await Effect.runPromise(
			draftLive({open, kept: () => Effect.succeed(kept)}, brief, {
				model: "opus",
				effort: "medium",
				budget: 1,
			}),
		);
		return {drafted, prompt: prompts[0] ?? "", options: query.asked[0]};
	};

	it("the first run starts the round's conversation under its name, with the whole brief", async () => {
		const {drafted, prompt, options} = await runWith(false);
		expect(drafted.answer).toBe("built");
		expect(options?.sessionId).toBe(brief.session);
		expect(options?.resume).toBeUndefined();
		expect(options?.persistSession).toBe(true);
		expect(prompt).toBe(promptOf(brief));
	});

	it("a run started again carries the kept conversation on, and is told to look before it goes on", async () => {
		const {prompt, options} = await runWith(true);
		expect(options?.resume).toBe(brief.session);
		expect(options?.sessionId).toBeUndefined();
		expect(prompt).toBe(carryOnOf(brief));
		expect(prompt).toContain("git status");
		expect(prompt).not.toContain("the body");
	});

	it("claude is started under its guard, with the copy's lock beside the copy", async () => {
		const {options} = await runWith(false);
		expect(options?.spawnClaudeCodeProcess).toBeTypeOf("function");
		expect(lockOf(`${TREE}/`)).toBe("/work/trees/1.lock");
	});
});
