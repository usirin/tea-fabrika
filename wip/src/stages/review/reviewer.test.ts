import {execFileSync} from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, sep} from "node:path";
import type {SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import {Effect, Stream} from "effect";
import {afterAll, describe, expect, it, vi} from "vitest";
import {noSpend, type Open} from "../../draft.ts";
import {initOf, resultOf, scriptedOpen, turnOf} from "../../draft-scripted.ts";
import {refusal} from "../../shell-guard.ts";
import {criteriaIn} from "./pack.ts";
import {
	liveReviewer,
	openedTools,
	promptOf,
	Reviewer,
	removeLinks,
	reviewerDraft,
	reviewerOptions,
	reviewStream,
	type Said,
	type Settings,
} from "./reviewer.ts";
import {briefOf, recorded, WHOLE} from "./scripted.ts";
import type {Heard, Note, Tools} from "./tools.ts";

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

const SETTINGS: Settings = {model: "opus", effort: "medium", budget: 2};
const NOTE: Note = {title: "An old doc is stale", body: "It names a flag that is gone.", at: null};

/** Call a served tool the way the SDK would: with whatever the agent wrote. Its own input type is the SDK's zod shape, which says nothing here. */
const callTool = (served: ReturnType<typeof openedTools>[number] | undefined, args: unknown) =>
	served === undefined
		? Promise.reject(new Error("no tool"))
		: served.handler(args as never, undefined);

/** Doors that keep each call and answer `heard`. */
function doors(heard: Heard = "taken") {
	const calls: Note[] = [];
	const tools: Tools = {
		file_note: (note) =>
			Effect.sync(() => {
				calls.push(note);
				return heard;
			}),
	};
	return {tools, calls};
}

describe("what the reviewer is allowed", () => {
	const TREE = "/tmp/review-1/code";
	const refused: string[] = [];
	const options = reviewerOptions(
		SETTINGS,
		TREE,
		(tool, why) => refused.push(`${tool}: ${why}`),
		doors().tools,
	);

	it("has three built-in tools, all of them reads, and the one tool its machine opened", () => {
		expect(options.tools).toEqual(["Read", "Grep", "Glob"]);
		expect(options.allowedTools).toEqual(["Read", "Grep", "Glob", "mcp__review__file_note"]);
		expect(options.permissionMode).toBe("dontAsk");
	});

	it("works in the copy of the code, loads no settings, keeps no session, and has a limit in dollars", () => {
		expect(options.cwd).toBe(TREE);
		expect(options.settingSources).toEqual([]);
		expect(options.persistSession).toBe(false);
		expect(options.maxBudgetUsd).toBe(2);
		expect(options.model).toBe("opus");
		expect(options.effort).toBe("medium");
		// Nothing that would hand it more: no plugin, no named agent.
		expect(options.plugins).toBeUndefined();
		expect(options.agent).toBeUndefined();
	});

	it("is offered one server of tools, the in-process one its machine opened: none a file names, and none of the signed-in account's connectors", () => {
		expect(Object.keys(options.mcpServers ?? {})).toEqual(["review"]);
		expect(options.mcpServers?.review).toMatchObject({type: "sdk", name: "review"});
		expect(options.strictMcpConfig).toBe(true);
		expect(options.settings).toEqual({disableClaudeAiConnectors: true});
	});

	it("serves exactly the opened tools, each taking the shape its Effect schema says", () => {
		const served = openedTools(doors().tools);
		expect(served.map((t) => t.name)).toEqual(["file_note"]);
		expect(Object.keys(served[0]?.inputSchema ?? {}).sort()).toEqual(["at", "body", "title"]);
	});

	it("hands a call through its door when it fits, says what the door heard, and refuses one that does not fit", async () => {
		const taking = doors("taken");
		const [fileNote] = openedTools(taking.tools);
		expect(await callTool(fileNote, NOTE)).toMatchObject({
			content: [{type: "text", text: "Taken. It is kept apart from your review."}],
		});
		expect(await callTool(fileNote, {title: 3})).toMatchObject({isError: true});
		expect(taking.calls).toEqual([NOTE]);

		const [closed] = openedTools(doors("refused").tools);
		expect(await callTool(closed, NOTE)).toMatchObject({isError: true});
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
		// The opened tool is let through as it is: its call changes nothing itself.
		expect(await call("mcp__review__file_note", NOTE)).toEqual({});
		expect(await call("mcp__other__file_note", NOTE)).toMatchObject({
			hookSpecificOutput: {permissionDecision: "deny"},
		});
		expect(refused).toHaveLength(4);
	});

	it("is handed a short environment: what it needs to run and log in, and no other variable of this machine", () => {
		vi.stubEnv("TEA_FABRIKA_MARKER", "set");
		vi.stubEnv("TYPESAFE_API_KEY", "not-a-key");
		vi.stubEnv("SSH_AUTH_SOCK", "/tmp/someone/agent.sock");
		const env = reviewerOptions(SETTINGS, TREE, () => {}, doors().tools).env ?? {};
		vi.unstubAllEnvs();

		expect(Object.keys(env)).toContain("PATH");
		expect(env).not.toHaveProperty("TEA_FABRIKA_MARKER");
		expect(env).not.toHaveProperty("TYPESAFE_API_KEY");
		// It pushes nothing, so it is not told where an ssh agent is either.
		expect(env).not.toHaveProperty("SSH_AUTH_SOCK");
	});
});

describe("a live reviewer whose query is scripted", () => {
	const dirs: string[] = [];
	afterAll(() => {
		for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
	});

	/** A clone with one commit, and that commit's id. `more` adds to the commit. */
	function clone(more: (repo: string) => void = () => {}) {
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
		more(repo);
		git("add", "-A");
		git("commit", "-q", "-m", "one");
		return {repo, head: git("rev-parse", "HEAD")};
	}

	const FORM = {rows: [], findings: [], skipped: []};

	/** `looks` is shown the reviewer's folder at the moment its query opens: the folder is gone once the run ends. */
	function draftOn(
		messages: readonly SDKMessage[],
		more: (repo: string) => void = () => {},
		looks: (tree: string) => void = () => {},
	) {
		const {repo, head} = clone(more);
		const query = scriptedOpen(messages);
		const open: Open = (params) => {
			looks(params.options.cwd ?? "");
			return query.open(params);
		};
		const said = Effect.runPromise(
			Effect.gen(function* () {
				const reviewer = yield* Reviewer;
				return [
					...(yield* Stream.runCollect(reviewer.review(briefOf({...WHOLE, head}), SETTINGS))),
				];
			}).pipe(Effect.provide(liveReviewer({repo, open}))),
		);
		/** How the run ended: the last thing it said, and the only `ended`. */
		const drafted = said.then((all) => {
			const ends = all.filter((s) => s.kind === "ended");
			if (ends.length !== 1 || all.at(-1)?.kind !== "ended") throw new Error("not one end, last");
			return (ends[0] as Extract<Said, {kind: "ended"}>).drafted;
		});
		return {drafted, said, seen: query.seen};
	}

	it("hands back the form when the SDK lists the three reads, its own answer tool and the opened one", async () => {
		const {drafted, said, seen} = draftOn([
			initOf(["Glob", "Grep", "Read", "StructuredOutput", "mcp__review__file_note"]),
			turnOf("Read"),
			resultOf(FORM),
		]);

		expect(await drafted).toMatchObject({answer: "form", form: FORM, tools: ["Read"]});
		expect(await said).toHaveLength(1);
		expect(seen.read).toBe(3);
	});

	it("stops at its limit in dollars as a run over budget, not a broken one", async () => {
		const {drafted} = draftOn([
			initOf(["Glob", "Grep", "Read", "StructuredOutput"]),
			turnOf("Read"),
			{...resultOf(FORM), subtype: "error_max_budget_usd", is_error: true} as SDKMessage,
		]);
		expect(await drafted).toMatchObject({answer: "over_budget", tools: ["Read"]});
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
			links: 0,
		});
		expect(seen.read).toBe(1);
		expect(seen.closed).toBeGreaterThan(0);
	});

	it("starts on a copy with no symbolic link in it when the commit holds some, and says how many were taken out", async () => {
		const outside = outsideFolder();
		dirs.push(outside);
		const found: {links: string[]; files: string[]}[] = [];
		const {drafted} = draftOn(
			[initOf(["Glob", "Grep", "Read", "StructuredOutput"]), resultOf(FORM)],
			(repo) => linkInto(repo, outside),
			(tree) => found.push({links: linksIn(tree), files: readdirSync(tree)}),
		);

		expect(await drafted).toMatchObject({answer: "form", links: 3});
		expect(found).toEqual([{links: [], files: ["a.ts", "src"]}]);
		// What the links pointed at outside the copy was never touched.
		expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("not for a reviewer\n");
	});
});

describe("one run as a stream", () => {
	const RAN = {spend: noSpend, tools: [], refused: [], links: 0};

	it("says each call of an opened tool as it is made, through the server's own handler, and then its end, once, last", async () => {
		const said = await Effect.runPromise(
			Stream.runCollect(
				reviewStream((tools) =>
					Effect.gen(function* () {
						const [fileNote] = openedTools(tools);
						const call = (args: unknown) =>
							Effect.orDie(Effect.tryPromise({try: () => callTool(fileNote, args), catch: String}));
						yield* call(NOTE);
						yield* call({...NOTE, title: "A second one"});
						return {answer: "misfit" as const, ...RAN};
					}),
				),
			),
		);
		expect([...said]).toEqual([
			{kind: "note", note: NOTE},
			{kind: "note", note: {...NOTE, title: "A second one"}},
			{kind: "ended", drafted: {answer: "misfit", ...RAN}},
		]);
	});

	it("cuts the run when whoever reads the stream stops reading", async () => {
		let cut = false;
		const said = await Effect.runPromise(
			Stream.runCollect(
				reviewStream((tools) =>
					Effect.gen(function* () {
						yield* tools.file_note(NOTE);
						return yield* Effect.never;
					}).pipe(Effect.onInterrupt(() => Effect.sync(() => (cut = true)))),
				).pipe(Stream.take(1)),
			),
		);
		expect([...said]).toEqual([{kind: "note", note: NOTE}]);
		expect(cut).toBe(true);
	});
});

/** A folder that is not part of any code under review: a file, a folder with a file, and a link of its own. */
function outsideFolder(): string {
	const outside = realpathSync(mkdtempSync(join(tmpdir(), "reviewer-outside-")));
	writeFileSync(join(outside, "secret.txt"), "not for a reviewer\n");
	mkdirSync(join(outside, "more"));
	writeFileSync(join(outside, "more", "other.txt"), "nor this\n");
	symlinkSync("secret.txt", join(outside, "own-link"));
	return outside;
}

/** Three links in a tree: to a file outside it, to a folder outside it, and a harmless one to a file inside it. */
function linkInto(tree: string, outside: string) {
	mkdirSync(join(tree, "src", "deep"), {recursive: true});
	writeFileSync(join(tree, "src", "b.ts"), "export const b = 2;\n");
	symlinkSync(join(outside, "secret.txt"), join(tree, "leak.txt"));
	symlinkSync(outside, join(tree, "src", "deep", "vendor"));
	symlinkSync("b.ts", join(tree, "src", "alias.ts"));
}

/** Every symbolic link under a folder, at any depth, as a path from it. A link to a folder is not gone into. */
const linksIn = (folder: string, from = folder): string[] =>
	readdirSync(folder, {withFileTypes: true})
		.flatMap((entry) => {
			const path = join(folder, entry.name);
			if (entry.isSymbolicLink()) return [relative(from, path)];
			return entry.isDirectory() ? linksIn(path, from) : [];
		})
		.sort();

describe("the links in the reviewer's copy of the code", () => {
	const dirs: string[] = [];
	afterAll(() => {
		for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
	});

	/** A tree with the three links, as `git archive` would unpack it, and the folder outside it. */
	function linked() {
		const outside = outsideFolder();
		const tree = realpathSync(mkdtempSync(join(tmpdir(), "reviewer-links-")));
		dirs.push(outside, tree);
		writeFileSync(join(tree, "a.ts"), "export const a = 1;\n");
		linkInto(tree, outside);
		return {tree, outside};
	}

	/** The paths a read could be asked for that went through one of the three links: a file, a folder, a file below a folder. */
	const THROUGH = [
		"leak.txt",
		"src/deep/vendor",
		"src/deep/vendor/secret.txt",
		"src/deep/vendor/more/other.txt",
		"src/alias.ts",
	];

	it("are all taken out, at any depth, and counted: to a file outside, to a folder outside, and a harmless one inside", async () => {
		const {tree} = linked();
		expect(linksIn(tree)).toEqual(["leak.txt", "src/alias.ts", "src/deep/vendor"]);

		expect(await removeLinks(tree)).toBe(3);

		expect(linksIn(tree)).toEqual([]);
		// Every plain file is still there, the one the harmless link pointed at among them.
		expect(readFileSync(join(tree, "a.ts"), "utf8")).toBe("export const a = 1;\n");
		expect(readFileSync(join(tree, "src", "b.ts"), "utf8")).toBe("export const b = 2;\n");
		expect(await removeLinks(tree)).toBe(0);
	});

	it("leave only the link behind: what one pointed at outside is not walked into, opened or changed", async () => {
		const {tree, outside} = linked();

		await removeLinks(tree);

		expect(readdirSync(outside).sort()).toEqual(["more", "own-link", "secret.txt"]);
		expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("not for a reviewer\n");
		expect(readFileSync(join(outside, "more", "other.txt"), "utf8")).toBe("nor this\n");
		expect(linksIn(outside)).toEqual(["own-link"]);
	});

	it("so a path the Check lets through as written is a file of the copy, for Read, Grep and Glob alike", async () => {
		const {tree} = linked();
		const rules = {tree, alsoWritable: [], readOnly: true};
		// With the links in, each of these paths is written inside the copy and is not a file of it.
		const realOf = (path: string) => realpathSync(join(tree, path));
		expect(THROUGH.filter((path) => !realOf(path).startsWith(`${tree}${sep}`))).toEqual(
			THROUGH.filter((path) => path !== "src/alias.ts"),
		);

		await removeLinks(tree);

		for (const path of THROUGH) {
			// The Check still judges each as written, and lets it through: it is inside the copy.
			expect(refusal(rules, "Read", {file_path: path})).toBeNull();
			expect(refusal(rules, "Grep", {pattern: "x", path})).toBeNull();
			expect(refusal(rules, "Glob", {pattern: `${path}/**`})).toBeNull();
			// And nothing is there to read, search or list.
			expect(existsSync(join(tree, path))).toBe(false);
		}
		// Whatever a search walks from the top of the copy, it stays in the copy.
		const walked = readdirSync(tree, {recursive: true}).map((entry) => realOf(String(entry)));
		expect(walked.length).toBeGreaterThan(0);
		expect(walked.every((path) => path.startsWith(`${tree}${sep}`))).toBe(true);
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
