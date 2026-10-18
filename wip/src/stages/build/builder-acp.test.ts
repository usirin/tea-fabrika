import {execFileSync, spawn, spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {memoryTracing} from "@tea-fabrika/tsh/trace/otel";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import type {PendingAsk} from "../../agents/acp/client.ts";
import {harnessOf} from "../../agents/acp/harness.ts";
import {FABRIKA_VIEWING} from "../../trace/viewing.ts";
import {
	ALLOWED,
	answer,
	builderHarness,
	checkedOf,
	checksOf,
	hookSettings,
	runTurn,
	sdkResultOf,
	type TurnAsk,
	underGuard,
	verdictOf,
} from "./builder-acp.ts";
import {builderCheck, TOOLS} from "./check.ts";
import {REPORT_TOOL, reportServer} from "./report.ts";

// The builder over ACP, short of a model: how an ask is answered, the fence
// handed to the adapter, the check hook as the CLI runs it, the form's MCP
// tool, and whole turns on the fake agent (src/agents/acp/fake-agent.ts),
// under the guard too.

const HOOK = fileURLToPath(new URL("./check-hook.ts", import.meta.url));

const ACP_PARENT = fileURLToPath(
	new URL("../../../../fixtures/builder-stop/acp-parent.ts", import.meta.url),
);

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "builder-acp-")));

const alive = (pid: number) => {
	// biome-ignore lint/plugin: signal 0 throws for a process that is gone; that is the answer
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const until = async (ok: () => boolean, ms: number) => {
	for (const end = Date.now() + ms; Date.now() < end; ) {
		if (ok()) return true;
		await new Promise((r) => setTimeout(r, 100));
	}
	return ok();
};

/** Every process under `pid`, by the process table. */
const descendantsOf = (pid: number): number[] => {
	const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid="], {encoding: "utf8"})
		.trim()
		.split("\n")
		.map((line) => line.trim().split(/\s+/).map(Number) as [number, number]);
	const under: number[] = [];
	const walk = (p: number) => {
		for (const [child, parent] of rows)
			if (parent === p) {
				under.push(child);
				walk(child);
			}
	};
	walk(pid);
	return under;
};

const ask = (name: string | undefined, rawInput?: unknown): acp.RequestPermissionRequest => ({
	sessionId: "s",
	toolCall: {
		toolCallId: "t1",
		...(name === undefined ? {} : {name}),
		...(rawInput === undefined ? {} : {rawInput}),
	},
	options: [
		{optionId: "yes", name: "Allow once", kind: "allow_once"},
		{optionId: "always", name: "Always allow", kind: "allow_always"},
		{optionId: "no", name: "Reject", kind: "reject_once"},
	],
});

describe("an ask, as the builder answers it", () => {
	const tree = "/work/trees/1";
	const verdict = verdictOf(builderCheck(tree, []));

	it("a write in the copy is allowed; one outside, a read outside, a push, and leaving the sandbox are refused with the check's reason", () => {
		expect(verdict(ask("Write", {file_path: `${tree}/a.ts`, content: ""}))).toEqual({
			allow: true,
			tool: "Write",
		});
		for (const [tool, input] of [
			["Write", {file_path: "/etc/passwd", content: ""}],
			["Read", {file_path: "/home/someone/.ssh/id_ed25519"}],
			["Bash", {command: "git push origin HEAD"}],
			["Bash", {command: "ls", dangerouslyDisableSandbox: true}],
			["Bash", {command: "curl https://example.com"}],
		] as const) {
			const v = verdict(ask(tool, input));
			expect(v.allow, `${tool} ${JSON.stringify(input)}`).toBe(false);
			expect(v.allow === false && v.why.length > 0).toBe(true);
		}
	});

	it("fails closed: an ask that names no tool, and a tool the builder does not have, are refused", () => {
		expect(verdict(ask(undefined)).allow).toBe(false);
		expect(verdict(ask("WebFetch", {url: "https://example.com"})).allow).toBe(false);
		expect(verdict(ask("mcp__other__tool", {})).allow).toBe(false);
		expect(ALLOWED).toEqual([...TOOLS, REPORT_TOOL]);
		expect(verdict(ask(REPORT_TOOL, {summary: "x"})).allow).toBe(true);
	});

	it("answers allow once or refuse once, never an always", () => {
		const picked: acp.RequestPermissionResponse[] = [];
		const pending = (): PendingAsk => ({
			id: "a1",
			request: ask("Read", {}),
			answer: (r) => {
				picked.push(r);
			},
		});
		answer(pending(), true);
		answer(pending(), false);
		expect(picked).toEqual([
			{outcome: {outcome: "selected", optionId: "yes"}},
			{outcome: {outcome: "selected", optionId: "no"}},
		]);
	});
});

describe("the SDK result, as the adapter forwards it raw", () => {
	it("reads the numbers out of a result message and nothing out of any other", () => {
		expect(
			sdkResultOf({
				message: {
					type: "result",
					subtype: "success",
					num_turns: 7,
					total_cost_usd: 0.42,
					duration_ms: 1234,
					structured_output: {a: 1},
				},
			}),
		).toEqual({subtype: "success", turns: 7, costUsd: 0.42, ms: 1234, structured: {a: 1}});
		expect(sdkResultOf({message: {type: "assistant"}})).toBeNull();
		expect(sdkResultOf(null)).toBeNull();
	});
});

describe("the fence handed to the adapter", () => {
	it("the check hook on every tool, Bash asking too, the sandbox and settings of experiment 76 kept, the raw result asked for", () => {
		const {meta} = builderHarness("/work/trees/1", 2, false);
		const claudeCode = (meta as {claudeCode: Record<string, unknown>}).claudeCode;
		const options = claudeCode.options as {
			settingSources: unknown;
			tools: unknown;
			maxBudgetUsd: unknown;
			sandbox: Record<string, unknown>;
			settings: Record<string, unknown>;
		};
		expect(options.settingSources).toEqual([]);
		expect(options.tools).toEqual([...TOOLS]);
		expect(options.maxBudgetUsd).toBe(2);
		expect(options.sandbox).toMatchObject({
			enabled: true,
			failIfUnavailable: true,
			allowUnsandboxedCommands: false,
			autoAllowBashIfSandboxed: false,
		});
		expect(options.settings).toMatchObject({
			disableClaudeAiConnectors: true,
			...hookSettings("/work/trees/1"),
		});
		expect(claudeCode.emitRawSDKMessages).toEqual([{type: "result"}]);
	});

	it("under the guard: the guard starts the adapter, with the copy's lock and the lifeline", () => {
		const {harness} = builderHarness("/work/trees/1", 2, true);
		expect(harness.lifeline).toBe(true);
		expect(harness.args).toContain("/work/trees/1.lock");
		expect(harness.args.some((a) => a.endsWith("guard.ts"))).toBe(true);
		expect(harness.args.at(-1)).toMatch(/claude-agent-acp\/dist\/index\.js$/);
	});
});

describe("the check hook, as the CLI runs it", () => {
	/** Run the hook's command line from the settings, as the CLI does: through `sh`, the call on stdin. */
	const hook = (tree: string, call: string) => {
		const command = hookSettings(tree).hooks.PreToolUse[0]?.hooks[0]?.command ?? "false";
		return spawnSync("sh", ["-c", command], {input: call, encoding: "utf8"});
	};

	it("refuses what the SDK path's hooks refuse, with their reason, and logs each decision without the input", () => {
		const root = scratch();
		const tree = join(root, "a tree's copy");
		execFileSync("mkdir", ["-p", tree]);
		const calls = [
			{tool_name: "Read", tool_input: {file_path: "a.ts"}},
			{tool_name: "Bash", tool_input: {command: "git push origin HEAD"}},
			{tool_name: "Write", tool_input: {file_path: "/etc/hosts", content: "SECRET-CONTENT"}},
		];
		const outs = calls.map((call) => hook(tree, JSON.stringify(call)));
		expect(outs.map((o) => o.status)).toEqual([0, 0, 0]);
		expect(outs[0]?.stdout).toBe("");
		for (const o of outs.slice(1))
			expect(JSON.parse(o.stdout).hookSpecificOutput).toMatchObject({
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
			});
		const why = builderCheck(tree, [])("Bash", {command: "git push origin HEAD"});
		expect(JSON.parse(outs[1]?.stdout ?? "").hookSpecificOutput.permissionDecisionReason).toBe(why);
		const log = readFileSync(checksOf(tree), "utf8");
		expect(log).not.toContain("SECRET-CONTENT");
		expect(checkedOf(log).map((c) => [c.tool, c.why === null])).toEqual([
			["Read", true],
			["Bash", false],
			["Write", false],
		]);
	});

	it("fails closed: a call it cannot read, or a log it cannot write, exits 2, which the CLI takes as a refusal", () => {
		const tree = scratch();
		expect(hook(tree, "not json").status).toBe(2);
		const badLog = spawnSync(
			process.execPath,
			["--disable-warning=ExperimentalWarning", HOOK, tree, join(tree, "no", "such", "log")],
			{input: JSON.stringify({tool_name: "Read", tool_input: {}}), encoding: "utf8"},
		);
		expect(badLog.status).toBe(2);
		const noArgs = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", HOOK], {
			input: "{}",
			encoding: "utf8",
		});
		expect(noArgs.status).toBe(2);
	});
});

/** One MCP call to the report server, as the CLI makes it: JSON-RPC over HTTP. */
const mcp = async (
	url: string,
	session: string | null,
	id: number,
	method: string,
	params: unknown,
) => {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(session === null ? {} : {"mcp-session-id": session}),
			"mcp-protocol-version": "2025-06-18",
		},
		body: JSON.stringify({jsonrpc: "2.0", id, method, params}),
	});
	const text = await response.text();
	const json = text.startsWith("{")
		? text
		: (text
				.split("\n")
				.find((l) => l.startsWith("data:"))
				?.slice(5) ?? "{}");
	return {session: response.headers.get("mcp-session-id") ?? session, body: JSON.parse(json)};
};

describe("the form's tool", () => {
	const form = {
		summary: "It ends.",
		deviations: [],
		ran: [{command: "pnpm test", passed: true}],
		left: [],
	};

	/** The CLI's calls, in order: start a session, list the tools, hand in a form that does not fit, then one that does. */
	const calls = async (url: string) => {
		const init = await mcp(url, null, 1, "initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: {name: "test", version: "0"},
		});
		const listed = await mcp(url, init.session, 2, "tools/list", {});
		const bad = await mcp(url, init.session, 3, "tools/call", {
			name: "report_build",
			arguments: {summary: 3},
		});
		const good = await mcp(url, init.session, 4, "tools/call", {
			name: "report_build",
			arguments: form,
		});
		return {listed: listed.body, bad: bad.body, good: good.body};
	};

	it("lists report_build with the form's shape, keeps a form that fits, refuses one that does not, and draws no span", async () => {
		const tracing = memoryTracing({viewing: FABRIKA_VIEWING});
		await Effect.runPromise(
			Effect.gen(function* () {
				const report = yield* reportServer();
				const url = (report.server as {url: string}).url;
				expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f-]{36}$/);
				const result = yield* Effect.tryPromise({
					try: () => calls(url),
					catch: (cause) => new Error(`the MCP calls failed: ${String(cause)}`),
				});
				const tools = result.listed.result.tools as {
					name: string;
					inputSchema: {required: string[]};
				}[];
				expect(tools.map((t) => t.name)).toEqual(["report_build"]);
				expect(tools[0]?.inputSchema.required).toEqual(
					expect.arrayContaining(["summary", "deviations", "ran", "left"]),
				);
				expect(result.bad.error ?? result.bad.result?.isError).toBeTruthy();
				expect(JSON.stringify(result.good.result)).toContain("Taken");
				expect(report.form()).toEqual(form);
			}).pipe(Effect.scoped, Effect.provide(tracing.layer)),
		);
		expect(tracing.spans.map((s) => s.name)).toEqual([]);
	});
});

describe("whole turns on the fake agent", () => {
	const turn = (folder: string, more: Partial<TurnAsk> & Pick<TurnAsk, "verdict" | "prompt">) => {
		const fake = harnessOf("fake", folder, null);
		return Effect.runPromise(
			runTurn({harness: fake, folder, meta: undefined, model: null, effort: null, ...more}).pipe(
				Effect.scoped,
				Effect.provide(nodeServices),
			),
		);
	};

	it("a write the check allows: the ask is answered allow once and the file is written", async () => {
		const folder = scratch();
		const t = await turn(folder, {prompt: "write", verdict: verdictOf(builderCheck(folder, []))});
		expect(t.mode).toBe("default");
		expect(t.asks).toBe(1);
		expect(t.calls).toMatchObject([
			{tool: "Write", asked: true, refused: null, status: "completed"},
		]);
		expect(existsSync(join(folder, "written.txt"))).toBe(true);
	});

	it("a write outside the copy: our check refuses the ask, the reason is kept, and nothing is written", async () => {
		const folder = scratch();
		const elsewhere = scratch();
		const t = await turn(folder, {
			prompt: "write",
			verdict: verdictOf(builderCheck(elsewhere, [])),
		});
		expect(t.calls).toHaveLength(1);
		expect(t.calls[0]).toMatchObject({tool: "Write", asked: true, status: "failed"});
		expect(t.calls[0]?.refused).toContain("written.txt");
		expect(existsSync(join(folder, "written.txt"))).toBe(false);
	});

	it("under the guard: a second harness on a held copy is refused, and the turn says so", async () => {
		const folder = scratch();
		const lock = join(folder, "copy.lock");
		writeFileSync(lock, "");
		// Hold the lock from another process for the length of the test: as a live builder would.
		const holder = spawn(
			"perl",
			["-MFcntl=:flock", "-e", 'open(F, ">>", shift) or die; flock(F, LOCK_EX); sleep 30', lock],
			{stdio: "ignore"},
		);
		// The holder is stopped whatever the test found.
		try {
			await new Promise((r) => setTimeout(r, 300));
			const fake = harnessOf("fake", folder, null);
			const failed = await Effect.runPromise(
				runTurn({
					harness: underGuard(fake, lock, 1),
					folder,
					meta: undefined,
					model: null,
					effort: null,
					prompt: "hello",
					verdict: () => ({allow: false, tool: "x", why: "x"}),
				}).pipe(Effect.scoped, Effect.flip, Effect.provide(nodeServices)),
			);
			expect(failed.method).toBe("initialize");
			expect(failed.message).toContain("held: the working copy is held by another live builder");
		} finally {
			holder.kill("SIGKILL");
		}
	}, 15_000);

	it("under the guard: kill -9 of the run's process mid turn stops the guard and the agent, and frees the copy", async () => {
		const folder = scratch();
		const lock = join(folder, "copy.lock");
		const parent = spawn(
			process.execPath,
			["--disable-warning=ExperimentalWarning", ACP_PARENT, folder, lock],
			{stdio: "ignore"},
		);
		const log = join(folder, ".fake-acp", "log");
		expect(
			await until(() => existsSync(log) && readFileSync(log, "utf8").includes("prompt"), 8_000),
		).toBe(true);
		const under = descendantsOf(parent.pid ?? -1);
		expect(under.length).toBeGreaterThanOrEqual(2);
		expect(under.every(alive)).toBe(true);
		parent.kill("SIGKILL");
		expect(await until(() => !under.some(alive), 8_000)).toBe(true);
		// The copy is free: a guard takes the lock at once.
		const fake = harnessOf("fake", folder, null);
		const t = await Effect.runPromise(
			runTurn({
				harness: underGuard(fake, lock, 1),
				folder,
				meta: undefined,
				model: null,
				effort: null,
				prompt: "hello",
				verdict: () => ({allow: false, tool: "x", why: "x"}),
			}).pipe(Effect.scoped, Effect.provide(nodeServices)),
		);
		expect(t.stop).toBe("end_turn");
	}, 20_000);

	it("under the guard, with the copy free: the turn runs as without it", async () => {
		const folder = scratch();
		const fake = harnessOf("fake", folder, null);
		const t = await Effect.runPromise(
			runTurn({
				harness: underGuard(fake, join(folder, "copy.lock"), 1),
				folder,
				meta: undefined,
				model: null,
				effort: null,
				prompt: "write",
				verdict: verdictOf(builderCheck(folder, [])),
			}).pipe(Effect.scoped, Effect.provide(nodeServices)),
		);
		expect(t.stop).toBe("end_turn");
		expect(existsSync(join(folder, "written.txt"))).toBe(true);
	});
});
