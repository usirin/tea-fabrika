import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import {Effect} from "effect";
import {afterAll, describe, expect, it} from "vitest";
import {noSpend} from "../../draft.ts";
import {initOf, resultOf, scriptedOpen, turnOf} from "../../draft-scripted.ts";
import {criteriaIn} from "./pack.ts";
import {liveReviewer, promptOf, Reviewer, reviewerDraft, reviewerOptions} from "./reviewer.ts";
import {briefOf, recorded, WHOLE} from "./scripted.ts";

// The reviewer, as far as it goes with no agent: what it is sent, what it is
// allowed, and how a run ends on a scripted query. No test here starts an
// agent, so none needs a key or the network. A live run is `run.ts`, and what
// the three real ones showed is in `docs/review-machine.md`.

const BRIEF = briefOf(WHOLE);

describe("what the reviewer is sent", () => {
	const prompt = promptOf(BRIEF);

	it("tells it, on purpose, to read and think freely first and to fill the form only at the very end", () => {
		expect(prompt).toContain("Read and think freely first.");
		expect(prompt).toContain(
			"Do not think about the form while you do this, and do not fill it in as you go.",
		);
		expect(prompt).toContain(
			"Fill the form only at the very end, once, when you know what you think.",
		);
		// The way of working comes before anything it could start grading.
		expect(prompt.indexOf("# How to work")).toBeLessThan(
			prompt.indexOf("# The ticket's acceptance criteria"),
		);
		expect(prompt.indexOf("# The form")).toBeGreaterThan(prompt.indexOf("# The diff"));
	});

	it("tells it, on purpose, that the rows are not the whole job", () => {
		expect(prompt).toContain("The rows are not the whole job.");
		expect(prompt).toContain("you must also look for what the criteria do not name");
		expect(prompt).toContain("Each rubric below has standing checks");
		expect(prompt).toContain("report what you find as findings");
	});

	it("holds every part of the brief: the criteria by number, the files with their kind, the rubrics, the checks, the diff", () => {
		expect(prompt).toContain("1. [ ] it works");
		expect(prompt).toContain("2. [ ] it is written down");
		expect(prompt).toContain("- src/a.ts (review-code)");
		expect(prompt).toContain("- docs/a.md (review-doc)");
		expect(prompt).toContain("## review-code (code.md)");
		expect(prompt).toContain("the doc rubric");
		expect(prompt).toContain("green (build: green)");
		expect(prompt).toContain("diff --git a/src/a.ts b/src/a.ts");
		expect(prompt).toContain("The builder says there are none.");
	});

	it("shows an evidence mark beside its criterion, and says what to do when its proof was not given", () => {
		const criteria = criteriaIn(recorded("tickets/623.md"));
		const text = promptOf(briefOf({...WHOLE, criteria}));
		expect(text).toContain(
			'Evidence mark: its proof is said to live in: a "Fixture run" section in the PR body',
		);
		expect(text).toContain("`unseen` is not a fail and not a pass.");
		expect(text).toContain("Never grade a row `fail` because you could not look.");
	});

	it("says plainly what it cannot do, and asks for no id, severity or verdict", () => {
		expect(prompt).toContain("You have no shell");
		expect(prompt).toContain("You post nothing.");
		expect(prompt).toContain("Give no ids, no severity and no verdict");
	});

	it("fences the diff and the deviations so nothing inside them can close the fence", () => {
		const diff = "+ a line\n+```ts\n+const x = 1;\n+````\n+ after";
		const text = promptOf(
			briefOf({...WHOLE, diff, deviations: {state: "listed", text: "- one ``` two"}}),
		);
		expect(text).toContain(`\`\`\`\`\`diff\n${diff}\n\`\`\`\`\`\n`);
		expect(text).toContain("````\n- one ``` two\n````");
	});

	it("is the same text for the same brief", () => {
		expect(promptOf(BRIEF)).toBe(prompt);
	});

	it("takes the real pack's size without trouble: a real diff and a real ticket", () => {
		const text = promptOf(
			briefOf({
				...WHOLE,
				criteria: criteriaIn(recorded("tickets/625.md")),
				diff: recorded("compare-final.diff"),
			}),
		);
		expect(text).toContain("5. [ ] A changeset for `@demlik/code-graph` covers the new exit code");
		expect(text.length).toBeGreaterThan(recorded("compare-final.diff").length);
	});
});

describe("what the reviewer is allowed", () => {
	const TREE = "/tmp/review-1/code";
	const refused: string[] = [];
	const options = reviewerOptions(
		{repo: "/clones/repo", model: "opus", effort: "medium", maxUsd: 2},
		TREE,
		(tool, why) => refused.push(`${tool}: ${why}`),
	);

	it("has three tools, all of them reads, and no other", () => {
		expect(options.tools).toEqual(["Read", "Grep", "Glob"]);
		expect(options.allowedTools).toEqual(["Read", "Grep", "Glob"]);
		expect(options.permissionMode).toBe("dontAsk");
	});

	it("works in the copy of the code, loads no settings, keeps no session, and has a limit in dollars", () => {
		expect(options.cwd).toBe(TREE);
		expect(options.settingSources).toEqual([]);
		expect(options.persistSession).toBe(false);
		expect(options.maxBudgetUsd).toBe(2);
		expect(options.model).toBe("opus");
		expect(options.effort).toBe("medium");
		// Nothing that would hand it more: no plugin, no named agent, no server of tools.
		expect(options.plugins).toBeUndefined();
		expect(options.mcpServers).toBeUndefined();
		expect(options.agent).toBeUndefined();
	});

	it("is offered no server of tools: none a file names, and none of the signed-in account's connectors", () => {
		expect(options.strictMcpConfig).toBe(true);
		expect(options.settings).toEqual({disableClaudeAiConnectors: true});
	});

	it("runs the repo's own check before each tool call, with its read-only rule on", async () => {
		const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
		if (hook === undefined) throw new Error("no hook");
		const call = (tool_name: string, tool_input: Record<string, unknown>) =>
			hook({hook_event_name: "PreToolUse", tool_name, tool_input} as never, undefined, {
				signal: new AbortController().signal,
			});

		expect(await call("Read", {file_path: `${TREE}/src/a.ts`})).toEqual({});
		expect(await call("Grep", {pattern: "exit 3"})).toEqual({});
		expect(await call("Bash", {command: "gh pr comment 1 --body PASS"})).toMatchObject({
			hookSpecificOutput: {permissionDecision: "deny"},
		});
		expect(await call("Write", {file_path: `${TREE}/src/a.ts`, content: ""})).toMatchObject({
			hookSpecificOutput: {permissionDecision: "deny"},
		});
		expect(await call("Read", {file_path: "/clones/repo/.env"})).toMatchObject({
			hookSpecificOutput: {permissionDecision: "deny"},
		});
		expect(refused).toHaveLength(3);
	});
});

describe("a live reviewer whose query is scripted", () => {
	const dirs: string[] = [];
	afterAll(() => {
		for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
	});

	/** A clone with one commit, and that commit's id. */
	function clone() {
		const repo = mkdtempSync(join(tmpdir(), "reviewer-test-"));
		dirs.push(repo);
		const git = (...args: string[]) =>
			execFileSync(
				"git",
				["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
				{cwd: repo, encoding: "utf8"},
			).trim();
		git("init", "-q");
		writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
		git("add", "-A");
		git("commit", "-q", "-m", "one");
		return {repo, head: git("rev-parse", "HEAD")};
	}

	const FORM = {rows: [], findings: [], skipped: []};

	function draftOn(messages: readonly SDKMessage[]) {
		const {repo, head} = clone();
		const query = scriptedOpen(messages);
		const drafted = Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* Reviewer).draft(briefOf({...WHOLE, head}));
			}).pipe(
				Effect.provide(
					liveReviewer({repo, model: "opus", effort: "medium", maxUsd: 2, open: query.open}),
				),
			),
		);
		return {drafted, seen: query.seen};
	}

	it("hands back the form when the SDK lists the three reads and its own answer tool", async () => {
		const {drafted, seen} = draftOn([
			initOf(["Glob", "Grep", "Read", "StructuredOutput"]),
			turnOf("Read"),
			resultOf(FORM),
		]);

		expect(await drafted).toMatchObject({answer: "form", form: FORM, tools: ["Read"]});
		expect(seen.read).toBe(3);
	});

	it("is a broken run when the SDK lists a tool it was not given, and nothing after the list is read", async () => {
		const {drafted, seen} = draftOn([
			initOf(["Glob", "Grep", "Read", "StructuredOutput", "mcp__one__read", "mcp__one__send"]),
			turnOf("Read"),
			resultOf(FORM),
		]);

		expect(await drafted).toEqual({
			answer: "broke",
			error:
				"the SDK listed 2 tools the run's options do not name, so the run was ended at its start",
			spend: noSpend,
			tools: [],
			refused: [],
		});
		expect(seen.read).toBe(1);
		expect(seen.closed).toBeGreaterThan(0);
	});
});

describe("the reviewer's answer", () => {
	it("is asked for as the form's schema, closed", () => {
		expect(reviewerDraft.name).toBe("reviewer");
		expect(reviewerDraft.schema).toMatchObject({
			type: "object",
			required: ["rows", "findings", "skipped"],
			additionalProperties: false,
		});
	});
});
