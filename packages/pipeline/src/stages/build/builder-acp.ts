import {fileURLToPath} from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import type {AgentSpans} from "@demlik/tea/otel";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {
	type AcpEvents,
	type AcpFailed,
	acpEvents,
	claudeOptions,
	connect,
	type Heard,
	harnessOf,
	type Opened,
	type PendingAsk,
	type Spawnable,
	seenOf,
} from "@kampus/fabrika/agents/acp";
import {noSpend} from "@kampus/fabrika/agents/claude";
import {TOOLS, temps} from "@kampus/fabrika/agents/sandbox";
import {agentTrace} from "@kampus/fabrika/agents/trace";
import {Clock, Context, Deferred, Effect, FileSystem, Layer, Queue, type Scope} from "effect";
import {ChildProcessSpawner} from "effect/process";
import type {Refused} from "../review/reviewer.ts";
import {promptOf} from "./builder.ts";
import {builderCheck, type Checked} from "./check.ts";
import {type BuildBrief, type BuildDrafted, Builder, type Ran, type Settings} from "./form.ts";
import {lockOf, WAIT_SECONDS} from "./guarded.ts";
import {REPORT_TOOL, reportServer} from "./report.ts";

// The builder over ACP (experiment 77): the same job as ./builder.ts, run
// through our ACP client (src/agents/acp/client.ts) and the official Claude
// adapter instead of the Agent SDK directly. The SDK path stays the default;
// this one is picked by `build --harness acp`.
//
//   const drafted = yield* draftAcp({}, brief, settings)   // the same BuildDrafted the SDK path answers
//
// What it carries, each the SDK path's own:
//
//   - the fence, `builderCheck` (./check.ts), the function the SDK path's
//     hooks are made of, twice over:
//       1. as a command hook before every tool call (./check-hook.ts,
//          `hookSettings`). A hook function cannot cross `_meta`; a command
//          line can. It sees the calls the CLI never asks about (experiment
//          77: sandboxed Bash, reads inside the copy), and the model reads
//          its reason, as on the SDK path.
//       2. on every permission ask. The adapter runs in `default` mode and a
//          sandboxed Bash command asks too, so the CLI asks before an edit,
//          a read outside the copy, or any command; the ask comes to us as
//          `session/request_permission`, and is answered allow once or
//          refuse once, with the SDK path's tool list. This one holds where
//          the hook cannot start: the CLI lets a call through when a hook
//          fails to run at all.
//   - the sandbox and the environment: experiment 76's `claudeOptions`
//     through `_meta.claudeCode.options`, and `agentEnv()` as the adapter's
//     whole environment.
//   - the dollar cap: `maxBudgetUsd` in the same options.
//   - model and effort: `session/set_config_option`.
//   - the form: an MCP tool, `report_build`, served by this process on
//     loopback and lent to the session in `mcpServers` (./report.ts).
//   - the guard: the adapter itself is started under experiment 71's guard
//     (./guard.ts), with the lifeline on fd 3. One builder per working copy,
//     either path, and it stops with this process.
//
// What it does not carry: carrying a conversation on after a restart. The
// adapter picks the session id; `BuildBrief.session` cannot name it. A run
// started again starts over from the brief, on the copy as it was left.
//
// Node at the edge: `node:url` to find the guard's script.

const GUARD = fileURLToPath(new URL("./guard.ts", import.meta.url));
const CHECK_HOOK = fileURLToPath(new URL("./check-hook.ts", import.meta.url));

/** The tools a builder over ACP may use: the SDK path's list, and the form's tool. Anything else is refused, as `dontAsk` refuses it there. */
export const ALLOWED: readonly string[] = [...TOOLS, REPORT_TOOL];

/** One ask, as our check answered it. */
export type Verdict =
	| {readonly allow: true; readonly tool: string}
	| {readonly allow: false; readonly tool: string; readonly why: string};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * How the builder answers one permission ask. Pure. A tool not in `ALLOWED`
 * is refused, and so is an ask that names no tool: the answer fails closed.
 */
export const verdictOf =
	(check: (tool: string, input: Readonly<Record<string, unknown>>) => string | null) =>
	(request: acp.RequestPermissionRequest): Verdict => {
		const tool = request.toolCall.name ?? null;
		if (tool === null)
			return {allow: false, tool: "unknown", why: "The ask names no tool, so it is refused."};
		if (!ALLOWED.includes(tool))
			return {
				allow: false,
				tool,
				why: `${tool} is not one of your tools. Use ${TOOLS.join(", ")}.`,
			};
		const why = check(tool, isRecord(request.toolCall.rawInput) ? request.toolCall.rawInput : {});
		return why === null ? {allow: true, tool} : {allow: false, tool, why};
	};

/** Answer an ask: its allow-once option, or its refuse-once one. Never an always-allow. */
export const answer = (ask: PendingAsk, allow: boolean): void => {
	const option =
		ask.request.options.find((o) => allow && o.kind === "allow_once") ??
		ask.request.options.find((o) => o.kind === "reject_once");
	ask.answer(
		option === undefined
			? {outcome: {outcome: "cancelled"}}
			: {outcome: {outcome: "selected", optionId: option.optionId}},
	);
};

// ---------------------------------------------------------------- one turn

/** A tool call the harness reported, with what our side did about it. */
export interface Call {
	readonly id: string;
	readonly tool: string;
	readonly status: string;
	/** An ask came for it. */
	readonly asked: boolean;
	/** Our check refused its ask: why. */
	readonly refused: string | null;
}

/** The SDK's own result message, as the Claude adapter forwards it raw (`_claude/sdkMessage`). Only its numbers. */
export interface SdkResult {
	readonly subtype: string;
	readonly turns: number;
	readonly costUsd: number;
	readonly ms: number;
	readonly structured: unknown;
}

/** One prompt turn, run to its end. */
export interface Turn {
	readonly stop: acp.StopReason | null;
	/** Why the prompt failed, when it did. */
	readonly error: string | null;
	readonly usage: acp.Usage | null;
	/** The session's cost so far, from `usage_update`. */
	readonly cost: number | null;
	/** The context window used at the last `usage_update`. */
	readonly context: number | null;
	readonly calls: readonly Call[];
	readonly asks: number;
	readonly mode: string | null;
	readonly result: SdkResult | null;
	readonly ms: number;
}

export interface TurnAsk {
	readonly harness: Spawnable;
	readonly folder: string;
	readonly meta: Readonly<Record<string, unknown>> | undefined;
	readonly servers?: readonly acp.McpServer[];
	readonly model: string | null;
	readonly effort: string | null;
	readonly prompt: string;
	/** How each ask is answered. */
	readonly verdict: (request: acp.RequestPermissionRequest) => Verdict;
	/** Every update and ask as it comes, for a probe. */
	readonly heard?: (heard: Heard) => void;
	/** The turn drawn as agent spans (src/agents/acp/spans.ts), where tracing is on. */
	readonly trace?: {readonly events: AcpEvents; readonly spans: AgentSpans<null> | null};
}

const numberAt = (value: unknown, key: string): number =>
	isRecord(value) && typeof value[key] === "number" ? (value[key] as number) : 0;

/** The SDK result inside a `_claude/sdkMessage`, or `null` for any other message. */
export const sdkResultOf = (params: unknown): SdkResult | null => {
	const message = isRecord(params) ? params.message : null;
	if (!isRecord(message) || message.type !== "result") return null;
	return {
		subtype: typeof message.subtype === "string" ? message.subtype : "unknown",
		turns: numberAt(message, "num_turns"),
		costUsd: numberAt(message, "total_cost_usd"),
		ms: numberAt(message, "duration_ms"),
		structured: message.structured_output ?? null,
	};
};

const currentOf = (opened: Opened, category: string): string | null => {
	const option = opened.config.find((o) => o.category === category);
	return option?.type === "select" ? option.currentValue : null;
};

/**
 * Set the option asked for. A value the harness does not offer fails the
 * turn: it never runs on another model or effort than asked. Only an option
 * the harness has none of at all is left alone, where `optional` says so (a
 * model with no effort setting).
 */
const setAsked = (
	c: Effect.Success<ReturnType<typeof connect>>,
	opened: Opened,
	category: string,
	value: string | null,
	optional: boolean,
) =>
	value === null || (optional && !opened.config.some((o) => o.category === category))
		? Effect.succeed(opened)
		: c.configure(opened, category, value);

type Item =
	| Heard
	| {readonly kind: "ext"; readonly params: unknown}
	| {readonly kind: "sync"; readonly done: Deferred.Deferred<void>};

/**
 * One session, one prompt, in the harness's `default` mode, every ask
 * answered by `verdict`. Fails only when the harness cannot be started or
 * the session cannot be opened in `default` mode: a prompt that fails is a
 * turn with its `error`.
 */
export const runTurn = (
	ask: TurnAsk,
): Effect.Effect<Turn, AcpFailed, Scope.Scope | ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function* () {
		const items = yield* Queue.unbounded<Item>();
		const calls = new Map<string, Call>();
		let asks = 0;
		let cost: number | null = null;
		let context: number | null = null;
		let result: SdkResult | null = null;

		const c = yield* connect(
			ask.harness,
			ask.folder,
			(heard) => {
				Queue.offerUnsafe(items, heard);
			},
			{
				methods: ["_claude/sdkMessage"],
				heard: (_, params) => {
					Queue.offerUnsafe(items, {kind: "ext", params});
				},
			},
		);

		const seen = (update: acp.SessionUpdate, at: number) => {
			if (update.sessionUpdate === "usage_update") {
				cost = update.cost?.amount ?? cost;
				context = update.used;
			}
			if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
				const old = calls.get(update.toolCallId);
				calls.set(update.toolCallId, {
					id: update.toolCallId,
					tool: update.name ?? old?.tool ?? "unknown",
					status: update.status ?? old?.status ?? "pending",
					asked: old?.asked ?? false,
					refused: old?.refused ?? null,
				});
			}
			if (ask.trace !== undefined)
				for (const event of ask.trace.events.seen(seenOf(update), at))
					ask.trace.spans?.onEvent(event);
		};

		const pump = Effect.gen(function* () {
			const batch = yield* Queue.takeAll(items);
			const now = yield* Clock.currentTimeMillis;
			for (const item of batch) {
				ask.heard?.(item as Heard);
				switch (item.kind) {
					case "update":
						seen(item.update, now);
						break;
					case "ask": {
						asks += 1;
						const verdict = ask.verdict(item.ask.request);
						const id = item.ask.request.toolCall.toolCallId;
						const old = calls.get(id);
						calls.set(id, {
							id,
							tool: verdict.tool,
							status: old?.status ?? "pending",
							asked: true,
							refused: verdict.allow ? null : verdict.why,
						});
						answer(item.ask, verdict.allow);
						break;
					}
					case "ext":
						result = sdkResultOf(item.params) ?? result;
						break;
					case "sync":
						yield* Deferred.succeed(item.done, undefined);
						break;
				}
			}
		});
		yield* Effect.forkScoped(Effect.forever(pump));
		const sync = Effect.gen(function* () {
			const done = yield* Deferred.make<void>();
			yield* Queue.offer(items, {kind: "sync", done});
			yield* Deferred.await(done);
		});

		let opened = yield* c.open("new", null, ask.folder, ask.meta, ask.servers ?? []);
		opened = yield* setAsked(c, opened, "model", ask.model, false);
		opened = yield* setAsked(c, opened, "thought_level", ask.effort, true);
		// `default`: the mode that asks. Set at every start; the adapter's own default is the owner's setting.
		opened = yield* c.configure(opened, "mode", "default");
		const mode = currentOf(opened, "mode") ?? opened.mode;
		if (mode !== "default")
			return yield* Effect.fail<AcpFailed>({
				_tag: "acp_failed",
				method: "session/set_config_option",
				message: `the session is in ${mode ?? "no"} mode, not default: nothing would ask`,
			});

		const t0 = yield* Clock.currentTimeMillis;
		if (ask.trace !== undefined)
			for (const event of ask.trace.events.start(t0, currentOf(opened, "model")))
				ask.trace.spans?.onEvent(event);
		const response = yield* c.prompt(opened.id, ask.prompt).pipe(Effect.result);
		yield* sync;
		const t1 = yield* Clock.currentTimeMillis;
		const ok = response._tag === "Success" ? response.success : null;
		if (ask.trace !== undefined) {
			const ended = {
				n: 1,
				stop: ok?.stopReason ?? "refusal",
				usage:
					ok?.usage === undefined || ok.usage === null
						? null
						: {
								input: ok.usage.inputTokens,
								output: ok.usage.outputTokens,
								cached: ok.usage.cachedReadTokens ?? 0,
								total: ok.usage.totalTokens,
							},
			};
			for (const event of ask.trace.events.end(ended, t1)) ask.trace.spans?.onEvent(event);
			ask.trace.spans?.end();
		}
		return {
			stop: ok?.stopReason ?? null,
			error:
				response._tag === "Failure"
					? `${response.failure.message}${c.stderr() === "" ? "" : `\n${c.stderr().slice(-1_000)}`}`
					: null,
			usage: ok?.usage ?? null,
			cost,
			context,
			calls: [...calls.values()],
			asks,
			mode,
			result,
			ms: t1 - t0,
		};
	});

// ---------------------------------------------------------------- the builder

/** What the form's tool is to be told, after the brief: ACP has no typed answer of its own. */
export const HAND_IN = [
	"",
	"# How to hand the form in",
	"",
	`Call the \`report_build\` tool (\`${REPORT_TOOL}\`) once, at the very end, with the four fields above. Then end your turn. A tool call that breaks the rules above is refused, and the refusal does not say which rule: read the rules again and work inside them.`,
].join("\n");

export interface AcpBuilderConfig {
	/** Start the adapter under experiment 71's guard. Default true. */
	readonly guard?: boolean;
	/** Every update and ask, for a log. */
	readonly heard?: (heard: Heard) => void;
}

/** A word for `sh`, whatever it holds. */
const quoted = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

/** Where a builder's check hook logs its decisions: beside the copy, where neither the agent's tools nor its sandbox may write. */
export const checksOf = (tree: string) => `${tree}.checks`;

/**
 * The settings that put the builder's check in front of every tool call:
 * `builderCheck` as a PreToolUse command hook (./check-hook.ts), on every
 * tool. Plain data, so it crosses `_meta`.
 */
export const hookSettings = (tree: string, log: string = checksOf(tree)) => ({
	hooks: {
		PreToolUse: [
			{
				matcher: "*",
				hooks: [
					{
						type: "command",
						command: [
							process.execPath,
							"--disable-warning=ExperimentalWarning",
							CHECK_HOOK,
							tree,
							log,
						]
							.map(quoted)
							.join(" "),
					},
				],
			},
		],
	},
});

/**
 * The Claude adapter as a builder's harness: contained as experiment 76's
 * `acp --agent claude`, under the guard, with the builder's fence:
 *
 *   - the check hook (`hookSettings`) before every tool call. It refuses what
 *     the SDK path's hooks refuse, with the same reason, the calls the CLI
 *     never asks about too.
 *   - a sandboxed Bash command asks as well (`autoAllowBashIfSandboxed: off`),
 *     so where the hook cannot start, which the CLI treats as an allow, a
 *     command still meets the check through its ask.
 */
export const builderHarness = (
	tree: string,
	budget: number,
	guard: boolean,
): {readonly harness: Spawnable; readonly meta: Readonly<Record<string, unknown>> | undefined} => {
	const base = harnessOf("claude", tree, budget);
	const options = claudeOptions(tree, budget);
	const plain = {
		...base,
		meta: {
			claudeCode: {
				options: {
					...options,
					settings: {...options.settings, ...hookSettings(tree)},
					sandbox: {...options.sandbox, autoAllowBashIfSandboxed: false},
				},
				// The SDK's own result message, forwarded raw: its turn count and cost, as the SDK path reads them.
				emitRawSDKMessages: [{type: "result"}],
			},
		},
	};
	return {
		harness: guard ? underGuard(plain, lockOf(tree), WAIT_SECONDS) : plain,
		meta: plain.meta,
	};
};

/**
 * A harness started under experiment 71's guard (./guard.ts): no second one
 * starts while `lock` is held (it waits `wait` seconds, then gives up), and it
 * stops with this process, a `kill -9` too, through the lifeline on fd 3.
 */
export const underGuard = (harness: Spawnable, lock: string, wait: number): Spawnable => ({
	command: process.execPath,
	args: [
		"--disable-warning=ExperimentalWarning",
		GUARD,
		lock,
		String(wait),
		"--",
		harness.command,
		...harness.args,
	],
	env: harness.env,
	lifeline: true,
});

/** Spend in the SDK path's words. Tokens: every token the turn billed, as ACP sums them. */
const spendOf = (turn: Turn): Ran["spend"] => ({
	costUsd: turn.result?.costUsd ?? turn.cost ?? 0,
	tokens: turn.usage?.totalTokens ?? 0,
	context: turn.context ?? 0,
	turns: turn.result?.turns ?? 0,
	minutes: turn.ms / 60_000,
});

/** Why a failed prompt failed, in the SDK path's words for a budget stop. */
const overBudget = (turn: Turn) =>
	turn.result?.subtype === "error_max_budget_usd" ||
	(turn.error ?? "").includes("error_max_budget_usd");

/** The check hook's log, line by line. A line that is not one is skipped: the log is written only by the hook. */
export const checkedOf = (text: string): readonly Checked[] =>
	text.split("\n").flatMap((line) => {
		if (line.trim() === "") return [];
		const parsed: unknown = JSON.parse(line);
		return isRecord(parsed) &&
			typeof parsed.tool === "string" &&
			(parsed.why === null || typeof parsed.why === "string")
			? [{tool: parsed.tool, why: parsed.why}]
			: [];
	});

/** The hook's log of this run: read once, then removed, so the next run starts with none. */
const takeChecks = (tree: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const text = yield* fs.readFileString(checksOf(tree)).pipe(Effect.orElseSucceed(() => ""));
		yield* fs.remove(checksOf(tree), {force: true}).pipe(Effect.ignore);
		return yield* Effect.try(() => checkedOf(text)).pipe(Effect.orElseSucceed(() => []));
	});

/** One builder run over ACP, to its end. Never a failure: a broken run is `broke`. */
export const draftAcp = (
	config: AcpBuilderConfig,
	brief: BuildBrief,
	settings: Settings,
): Effect.Effect<
	BuildDrafted,
	never,
	ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
	Effect.gen(function* () {
		// A log a run before left behind is not this run's.
		yield* takeChecks(brief.tree);
		const report = yield* reportServer();
		const {harness, meta} = builderHarness(brief.tree, settings.budget, config.guard ?? true);
		const stamp = yield* Clock.currentTimeMillis;
		const spans = yield* agentTrace<null>("builder");
		const turn = yield* runTurn({
			harness,
			folder: brief.tree,
			meta,
			servers: [report.server],
			model: settings.model,
			effort: settings.effort,
			// Pasted: the adapter is handed `settingSources: []` (../../../../fabrika/src/agents/acp/harness.ts).
			prompt: `${promptOf(brief, [], "pasted")}\n${HAND_IN}`,
			verdict: verdictOf(builderCheck(brief.tree, temps())),
			...(config.heard === undefined ? {} : {heard: config.heard}),
			trace: {events: acpEvents(`${brief.ticket}#${brief.round}#${stamp}`), spans},
		});
		// Refused by the hook, then by an ask: one call meets one or the other, never a refusal from both.
		const checks = yield* takeChecks(brief.tree);
		const refused: Refused[] = [
			...checks.flatMap((c) => (c.why === null ? [] : [{tool: c.tool, why: c.why}])),
			...turn.calls.flatMap((c) => (c.refused === null ? [] : [{tool: c.tool, why: c.refused}])),
		];
		// Counts only: how the fence met this run's calls.
		yield* Effect.annotateCurrentSpan({
			"builder.calls": turn.calls.length,
			"builder.checked": checks.length,
			"builder.refused_by_check": checks.filter((c) => c.why !== null).length,
			"builder.asks": turn.asks,
			"builder.refused_by_ask": turn.calls.filter((c) => c.refused !== null).length,
		});
		const ran: Ran = {
			spend: spendOf(turn),
			tools: turn.calls.map((c) => c.tool),
			refused,
			links: 0,
		};
		if (overBudget(turn)) return {answer: "over_budget", ...ran} satisfies BuildDrafted;
		if (turn.error !== null || turn.stop !== "end_turn")
			return {
				answer: "broke",
				error: turn.error ?? `the turn stopped: ${turn.stop ?? "no reason"}`,
				...ran,
			} satisfies BuildDrafted;
		const form = report.form();
		return (
			form === null ? {answer: "misfit", ...ran} : {answer: "built", built: form, ...ran}
		) satisfies BuildDrafted;
	}).pipe(
		Effect.scoped,
		Effect.catch((e: AcpFailed) =>
			Effect.succeed<BuildDrafted>({
				answer: "broke",
				error: `${e.method}: ${e.message}`,
				spend: noSpend,
				tools: [],
				refused: [],
				links: 0,
			}),
		),
		Effect.withSpan("builder acp"),
	);

/**
 * The builder over ACP, as a service of its own. The build program asks for
 * it only when it is started with `--harness acp`, and then stands it in
 * for `Builder`. Its default answers `broke`, so a run that was never given
 * one fails loudly and spends nothing.
 */
interface AcpBuilderShape {
	readonly build: (brief: BuildBrief, settings: Settings) => Effect.Effect<BuildDrafted>;
}
export const AcpBuilder = Context.Reference<AcpBuilderShape>("BuildStageAcpBuilder", {
	defaultValue: () => ({
		build: () =>
			Effect.succeed<BuildDrafted>({
				answer: "broke",
				error: "this run was given no ACP builder",
				spend: noSpend,
				tools: [],
				refused: [],
				links: 0,
			}),
	}),
});

/** The live builder over ACP: the Claude adapter, Node's process spawner. */
export const liveAcpBuilder = (config: AcpBuilderConfig = {}) =>
	Layer.effect(
		AcpBuilder,
		Effect.gen(function* () {
			// The two services alone, on top of the caller's context: a whole captured context would
			// put back the layer's own, and the run's span would lose the program it belongs to.
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const fs = yield* FileSystem.FileSystem;
			return {
				build: (brief: BuildBrief, settings: Settings) =>
					draftAcp(config, brief, settings).pipe(
						Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
						Effect.provideService(FileSystem.FileSystem, fs),
					),
			};
		}),
	).pipe(Layer.provide(nodeServices));

/** How the build program may run its builder. */
export const HARNESSES = ["sdk", "acp"] as const;

/** `Builder`, answered by the ACP builder: for a run started with `--harness acp`. */
export const viaAcp = Effect.gen(function* () {
	const acpBuilder = yield* AcpBuilder;
	return Builder.of({build: acpBuilder.build});
});
