import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {agentEnv} from "@kampus/fabrika/pipeline/env";
import {Effect, Layer} from "effect";
import {z} from "zod";
import {AS_FILED} from "./enrichment.ts";
import {
	type BuildAnswer,
	Builder,
	type BuildRequest,
	Enricher,
	type EnrichRequest,
	Reviewer,
	type ReviewRequest,
} from "./factory-services.ts";
import {factsBrief} from "./facts.ts";
import {type Criterion, Snippet, UncheckedAbout} from "./issue.ts";
import {TESTS_FILE} from "./tests.ts";

export interface ClaudeOptions {
	/** The model to ask for. Left out, the CLI picks its own default. */
	readonly model?: string;
	/** How long one turn may take before it counts as failed. */
	readonly timeoutMs?: number;
	/** Told what each turn that ended cleanly cost. A host keeps it; the machine never sees it. */
	readonly onSpend?: (spend: Spend) => void;
}

/** What one turn cost, as `claude -p`'s result reports it. A field the result leaves out is `null`. */
export interface Spend {
	readonly session: string;
	readonly costUsd: number | null;
	readonly durationMs: number | null;
	readonly turns: number | null;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly cacheReadTokens: number | null;
	readonly cacheWriteTokens: number | null;
}

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * A conversation with a known id. `continues` says whether it should already
 * exist; when the guess is wrong (a build killed before Claude saved anything,
 * or after it had), the turn tries the other way once.
 */
export interface Conversation {
	readonly id: string;
	readonly continues: boolean;
}

/** One turn of Claude Code: what it is asked, in which conversation, with which tools. */
export interface Turn {
	readonly prompt: string;
	/** The conversation to be in, or `null` to start one under a new id. */
	readonly session: Conversation | null;
	readonly tools: readonly string[];
	/** Let it edit files without asking. Left out, it can only read. */
	readonly edits?: boolean;
	/** A JSON Schema the turn's answer must match. */
	readonly schema?: object;
}

export interface TurnResult {
	readonly text: string;
	/** The answer as data, when the turn was given a schema. */
	readonly structured: unknown;
	readonly session: string;
	readonly spend: Spend;
}

/** `claude` exited with an error. `stderr` says why, e.g. a conversation that is not there. */
class ClaudeFailed extends Error {
	readonly stderr: string;

	constructor(code: number | null, stderr: string) {
		super(`claude exited ${code}: ${stderr.trim()}`);
		this.stderr = stderr;
	}
}

/** Run `claude -p` to the end and hand back everything it printed. It is handed an agent's short environment (src/env.ts). */
const runClaude = (dir: string, args: readonly string[], signal: AbortSignal) =>
	new Promise<string>((resolve, reject) => {
		const child = spawn("claude", args, {
			cwd: dir,
			env: agentEnv(),
			signal,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk) => {
			out += chunk;
		});
		child.stderr.on("data", (chunk) => {
			err += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => (code === 0 ? resolve(out) : reject(new ClaudeFailed(code, err))));
	});

/** The flags that put a turn in its conversation. */
const conversationArgs = (session: Conversation | null, continues: boolean) =>
	session === null
		? ["--session-id", randomUUID()]
		: continues
			? ["--resume", session.id]
			: ["--session-id", session.id];

/** The guess about a conversation was wrong, and the other way will work. */
const wrongGuess = (error: unknown, continues: boolean) =>
	error instanceof ClaudeFailed &&
	(continues
		? error.stderr.includes("No conversation found")
		: error.stderr.includes("is already in use"));

/** A number the result holds at `value`, or `null`. */
const numberOr = (value: unknown): number | null => (typeof value === "number" ? value : null);

/** What the result event says the turn cost. */
export function spendOf(session: string, result: Record<string, unknown>): Spend {
	const usage = (
		typeof result.usage === "object" && result.usage !== null ? result.usage : {}
	) as Record<string, unknown>;
	return {
		session,
		costUsd: numberOr(result.total_cost_usd),
		durationMs: numberOr(result.duration_ms),
		turns: numberOr(result.num_turns),
		inputTokens: numberOr(usage.input_tokens),
		outputTokens: numberOr(usage.output_tokens),
		cacheReadTokens: numberOr(usage.cache_read_input_tokens),
		cacheWriteTokens: numberOr(usage.cache_creation_input_tokens),
	};
}

/** Read the last event of `--output-format json`: the turn's result. */
export function resultOf(printed: string): TurnResult {
	const events = JSON.parse(printed) as readonly Record<string, unknown>[];
	const last = events.at(-1);
	if (
		last?.type !== "result" ||
		last.is_error !== false ||
		typeof last.result !== "string" ||
		typeof last.session_id !== "string"
	) {
		throw new Error("claude did not end with a clean result");
	}
	return {
		text: last.result,
		structured: last.structured_output,
		session: last.session_id,
		spend: spendOf(last.session_id, last),
	};
}

/**
 * One turn in `dir`. Your own Claude Code settings, hooks and plugins are left
 * out, so a turn behaves the same anywhere.
 */
export async function turn(
	dir: string,
	options: ClaudeOptions,
	ask: Turn,
	signal: AbortSignal,
): Promise<TurnResult> {
	const once = (continues: boolean) =>
		runClaude(
			dir,
			[
				"-p",
				ask.prompt,
				"--output-format",
				"json",
				...conversationArgs(ask.session, continues),
				"--setting-sources",
				"project",
				"--strict-mcp-config",
				...(ask.edits === true ? ["--permission-mode", "acceptEdits"] : []),
				...(options.model === undefined ? [] : ["--model", options.model]),
				...(ask.schema === undefined ? [] : ["--json-schema", JSON.stringify(ask.schema)]),
				// `--tools` is what takes the other tools away. `--allowedTools` alone only
				// pre-approves: with it the agent kept a shell, and used `git show` to dig
				// files out of history that had been removed from its folder.
				"--tools",
				...ask.tools,
				"--allowedTools",
				...ask.tools,
			],
			AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? FIVE_MINUTES)]),
		);
	const continues = ask.session?.continues ?? false;
	const printed = await once(continues).catch((error: unknown) =>
		ask.session !== null && wrongGuess(error, continues) ? once(!continues) : Promise.reject(error),
	);
	const result = resultOf(printed);
	options.onSpend?.(result.spend);
	return result;
}

/** How the builder ends its turn. Every field is always there; the ones its kind does not use are empty. */
const BuilderReply = z.object({
	kind: z.enum(["done", "contradiction", "blocked", "dispute"]),
	summary: z.string(),
	deviations: z.array(z.object({file: z.string(), why: z.string()})),
	criterion: z.string(),
	call: z.string(),
	finding: z.string(),
	why: z.string(),
});

const builderSchema = {
	type: "object",
	additionalProperties: false,
	required: ["kind", "summary", "deviations", "criterion", "call", "finding", "why"],
	properties: {
		kind: {
			type: "string",
			enum: ["done", "contradiction", "blocked", "dispute"],
			description:
				"done: the change is made. contradiction: an example breaks its own rule, or needs a change the issue does not ask for. blocked: you cannot do the work from here. dispute: a review finding you were sent is wrong",
		},
		finding: {
			type: "string",
			description: "dispute: the finding's id, as the review gave it. Otherwise empty",
		},
		summary: {
			type: "string",
			description: "done: one sentence saying what you changed. Otherwise empty",
		},
		deviations: {
			type: "array",
			description:
				"done: every file you changed that no criterion names, with why. Empty when there is none",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["file", "why"],
				properties: {
					file: {type: "string", description: "The path, relative to the folder"},
					why: {type: "string", description: "Why you changed it, in one sentence"},
				},
			},
		},
		criterion: {type: "string", description: "contradiction: the criterion's id. Otherwise empty"},
		call: {
			type: "string",
			description: "contradiction: the example's call, exactly as written. Otherwise empty",
		},
		why: {
			type: "string",
			description:
				"contradiction, blocked or dispute: why, in one or two sentences. Otherwise empty",
		},
	},
};

/** The builder's reply as the lane's answer. */
function answerOf(reply: z.infer<typeof BuilderReply>): BuildAnswer {
	switch (reply.kind) {
		case "done":
			return {kind: "done", summary: reply.summary, deviations: reply.deviations};
		case "contradiction":
			return {kind: "contradiction", criterion: reply.criterion, call: reply.call, why: reply.why};
		case "blocked":
			return {kind: "blocked", why: reply.why};
		case "dispute":
			return {kind: "dispute", finding: reply.finding, why: reply.why};
	}
}

/** One criterion as the builder reads it: the rule, and what checks it as the checks have it, or the files it is about. */
function describeCriterion(c: Criterion): string {
	const where = (files: readonly string[]) =>
		files.length === 0 ? "" : `; in ${files.join(", ")}`;
	switch (c.kind) {
		case "example":
			return [
				`- ${c.rule} (${c.id})`,
				...c.examples.map((e) => `    ${e.call} -> ${e.result}`),
			].join("\n");
		case "type":
			return [
				`- ${c.rule} (${c.id}${where(c.files)})`,
				...c.snippets.flatMap((s, i) => [
					`    snippet ${i + 1}, ${s.expect === "compiles" ? "must compile" : "the marked line must be a type error"}${s.today === "holds" ? " (it holds today: keep it so)" : ""}:`,
					...s.code.split("\n").map((line) => `      ${line}`),
				]),
			].join("\n");
		case "existing_test":
			return `- ${c.rule} (${c.id}; the test ${c.test} must pass${where(c.files).replace("; in", ", about")})`;
		case "unchecked":
			return `- ${c.rule} (${c.id}${where(c.files)})`;
	}
}

/**
 * What the builder is told. A retry is short: the conversation already holds
 * the issue. `tests` is the file the examples are written to, `snippets` the
 * one the type snippets are.
 */
export function promptFor(
	request: BuildRequest,
	tests: string = TESTS_FILE,
	snippets: string | null = null,
): string {
	if (request.session.continues && request.feedback !== null) {
		return `Your change was sent back.\n\n${request.feedback}\n\nFix it.`;
	}
	const typed = request.issue.criteria.some((c) => c.kind === "type");
	return [
		`Implement this issue by editing the files in the current folder.`,
		`# ${request.issue.title}`,
		request.issue.body,
		`The rules, and what checks them:\n${request.issue.criteria.map(describeCriterion).join("\n")}`,
		`Every example is a test in ${tests}: make them pass. You cannot change that file, and you cannot run commands; the tests are run for you after you finish.`,
		...(typed
			? [
					`Every type snippet is a block in ${snippets ?? "a generated .test-d.ts file"}, typechecked with the tests after you finish: make each one hold. You cannot change that file either.`,
				]
			: []),
		`If an example breaks its own rule, do not write code to match it: answer contradiction, naming the criterion and the call. Do the same if an example can only pass, or only typecheck, by changing something this issue does not ask for, such as a published function's signature, a type it already exports, or unrelated code: answer contradiction, and say in why what the example would need. Never weaken working code to fit a test. If you cannot do the work from here, answer blocked. Otherwise answer done.`,
		`A check compares what the package publishes before and after your change: a change to a published name this issue does not name, or a new export, is sent back.`,
		`The criteria name the files this issue is about. If you change any other file, list it under deviations with why: a change you do not list is sent back.`,
		`After the tests pass, a reviewer reads the change. If it sends back a finding you think is wrong, answer dispute with the finding's id and why, instead of changing code to suit it.`,
		...(request.feedback === null ? [] : [`The last attempt was sent back:\n${request.feedback}`]),
	].join("\n\n");
}

/**
 * Claude Code as the builder, working in `dir`. It may read and edit files and
 * nothing else: running the tests is the machine's job. `tests` is the file
 * the issue's examples are written to, and `snippets` the one its type
 * snippets are, as the workspace's flavour puts them.
 */
export function claudeBuilder(
	dir: string,
	options: ClaudeOptions & {readonly tests?: string; readonly snippets?: string} = {},
) {
	return Layer.succeed(Builder, {
		build: (request) =>
			Effect.tryPromise({
				try: async (signal) => {
					const result = await turn(
						dir,
						options,
						{
							prompt: promptFor(request, options.tests, options.snippets ?? null),
							session: request.session,
							tools: ["Read", "Edit", "Write", "Glob", "Grep"],
							edits: true,
							schema: builderSchema,
						},
						signal,
					);
					return answerOf(BuilderReply.parse(result.structured));
				},
				catch: () => ({_tag: "agent_failed" as const}),
			}),
	});
}

/** How the reviewer ends its turn. */
const ReviewerReply = z.object({
	findings: z.array(
		z.object({file: z.string(), line: z.number(), quote: z.string(), problem: z.string()}),
	),
	rechecks: z.array(z.object({id: z.string(), fixed: z.boolean()})),
});

const reviewerSchema = {
	type: "object",
	additionalProperties: false,
	required: ["findings", "rechecks"],
	properties: {
		findings: {
			type: "array",
			description: "New problems in the change. Empty when there is none",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["file", "line", "quote", "problem"],
				properties: {
					file: {type: "string", description: "The path, relative to the folder"},
					line: {
						type: "integer",
						description: "The line number in the file as it is now, starting at 1",
					},
					quote: {type: "string", description: "The code on that line, copied exactly"},
					problem: {type: "string", description: "What is wrong, in one or two plain sentences"},
				},
			},
		},
		rechecks: {
			type: "array",
			description: "One entry per earlier finding you were given",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "fixed"],
				properties: {id: {type: "string"}, fixed: {type: "boolean"}},
			},
		},
	},
};

/**
 * What the reviewer is told. The things to look for are fabrika's code rubric,
 * cut to what a toy can show; what tests and CI already answer is left out.
 */
export function reviewPromptFor(request: ReviewRequest): string {
	return [
		`You are reviewing a change to the code in the current folder. You find problems; you do not decide whether the change passes, and you change nothing.`,
		`# ${request.issue.title}`,
		request.issue.body,
		`The change, as a diff against where it started:\n\`\`\`diff\n${request.diff}\n\`\`\``,
		[
			`The tests already pass, so do not re-check what an example shows. Look for what tests cannot see:`,
			`- Silent failures: an input the code accepts and quietly gets wrong, or an error swallowed.`,
			`- Behavior claims: a comment or name that says the code does something it does not.`,
			`- Comments that restate the code, narrate obvious steps, or are now stale.`,
			`- Anything the change does beyond what the issue asks.`,
		].join("\n"),
		`Every finding names one line of a file as it is now, and quotes that line exactly. A finding whose quote is not on that line is thrown away. If you find nothing, return no findings: an empty review is a fine answer.`,
		...(request.open.length === 0
			? []
			: [
					`Earlier findings the builder was asked to fix. Say of each whether the code now fixes it:\n${request.open.map((f) => `- [${f.id}] ${f.file}:${f.line} \`${f.quote}\`: ${f.problem}`).join("\n")}`,
				]),
		...(request.decided.length === 0
			? []
			: [
					`A person already decided these points, so do not raise them again, in any words: filed means it is real but not this ticket's, withdrawn means it was judged wrong.\n${request.decided.map((f) => `- [${f.id}, ${f.decision}] ${f.problem}`).join("\n")}`,
				]),
	].join("\n\n");
}

/**
 * Claude Code as the reviewer, reading `dir`. It can read and search and
 * nothing else, and every review starts a fresh conversation, so it reads
 * each round cold.
 */
export function claudeReviewer(dir: string, options: ClaudeOptions = {}) {
	return Layer.succeed(Reviewer, {
		review: (request) =>
			Effect.tryPromise({
				try: async (signal) => {
					const result = await turn(
						dir,
						options,
						{
							prompt: reviewPromptFor(request),
							session: null,
							tools: ["Read", "Glob", "Grep"],
							schema: reviewerSchema,
						},
						signal,
					);
					return ReviewerReply.parse(result.structured);
				},
				catch: () => ({_tag: "agent_failed" as const}),
			}),
	});
}

/** A criterion as the enricher writes it, before code sorts it into a kind. */
const Written = z.object({
	id: z.string(),
	rule: z.string(),
	check: z.enum(["example", "type", "existing_test", "unchecked"]),
	file: z.string(),
	name: z.string(),
	uses: z.array(z.object({name: z.string(), file: z.string()})),
	examples: z.array(z.object({call: z.string(), result: z.string()})),
	snippets: z.array(Snippet),
	test: z.string(),
	no_example: z.string().nullable(),
	files: z.array(z.string()),
	unchecked_kind: UncheckedAbout,
});

/** What the enricher must end its turn with. */
const Enriched = z.object({
	title: z.string(),
	goal: z.string(),
	summary: z.string(),
	details: z.string(),
	criteria: z.tuple([Written], Written),
	open_decision: z.string().nullable(),
});

const enrichedSchema = {
	type: "object",
	additionalProperties: false,
	required: ["title", "goal", "summary", "details", "criteria", "open_decision"],
	properties: {
		title: {type: "string", description: "A short title that says what is wrong or wanted"},
		goal: {
			type: "string",
			description:
				"One sentence saying what the code does once this issue is done, as a plain fact about its purpose. Not what is wrong today.",
		},
		summary: {
			type: "string",
			description: "Two or three everyday sentences: what is wrong, who it hurts, what we would do",
		},
		details: {
			type: "string",
			description: "What you found in the code, with real file and function names",
		},
		criteria: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"id",
					"rule",
					"check",
					"file",
					"name",
					"uses",
					"examples",
					"snippets",
					"test",
					"no_example",
					"files",
					"unchecked_kind",
				],
				properties: {
					id: {type: "string", description: "A short kebab-case name"},
					rule: {type: "string", description: "The rule in one plain sentence, one claim"},
					check: {
						type: "string",
						enum: ["example", "type", "existing_test", "unchecked"],
						description:
							"What shows the rule. example: calls and their results. type: TypeScript snippets the compiler checks. existing_test: a test file in the repo that must pass. unchecked: nothing can",
					},
					file: {
						type: "string",
						description:
							"The file the calls import name from, relative to the folder, e.g. price.js. Empty for a rule without examples",
					},
					name: {
						type: "string",
						description:
							"The exported function the calls test, e.g. formatPrice. Empty for a rule without examples",
					},
					uses: {
						type: "array",
						description:
							"Every other exported value the calls use, such as the library's own constructor for a value a call takes, with the file it is exported from; for type, every name the snippets import. Empty when the calls use only name",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["name", "file"],
							properties: {
								name: {type: "string", description: "The exported name, e.g. defineMachine"},
								file: {
									type: "string",
									description: "The file it is exported from, relative to the folder",
								},
							},
						},
					},
					examples: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["call", "result"],
							properties: {
								call: {
									type: "string",
									description: "One JavaScript expression, e.g. formatPrice(3.5)",
								},
								result: {
									type: "string",
									description: 'The exact value as a JavaScript literal, e.g. "3.50"',
								},
							},
						},
					},
					snippets: {
						type: "array",
						description: "type: the snippets that show the rule. Empty otherwise",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["expect", "today", "code"],
							properties: {
								expect: {
									type: "string",
									enum: ["compiles", "rejects"],
									description:
										"compiles: the code must typecheck. rejects: the line under each `// @ts-expect-error` must be a type error",
								},
								today: {
									type: "string",
									enum: ["holds", "fails"],
									description:
										"holds: today's code already does this, a limit the change must keep. fails: it shows the change",
								},
								code: {
									type: "string",
									description:
										"A few TypeScript statements, no imports: they use only names in uses, and use every name they declare",
								},
							},
						},
					},
					test: {
						type: "string",
						description:
							"existing_test: the test file that must pass, relative to the folder, such as a doc page's twin. Empty otherwise",
					},
					no_example: {
						type: ["string", "null"],
						description: "unchecked: why nothing can show the rule. null otherwise",
					},
					files: {
						type: "array",
						items: {type: "string"},
						description:
							"Without examples: every file the rule is about, relative to the folder, such as the file that declares a type or a doc page it changes. Empty when it is about no one file, and empty for a rule with examples",
					},
					unchecked_kind: {
						type: "string",
						enum: ["type", "doc", "other"],
						description:
							"unchecked: what the rule is about. type: a type or a signature. doc: a doc page. other: anything else. For any other check: other",
					},
				},
			},
		},
		open_decision: {
			type: ["string", "null"],
			description:
				"A product or design call the issue rests on that nobody has made yet, as one question for the owner. null when the code and the issue settle everything.",
		},
	},
};

/**
 * A criterion as code checks it. A rule with examples becomes an example
 * criterion; a type rule with snippets a type criterion, importing `uses`
 * (and `name` from `file`, if given); one that names a test an existing-test
 * criterion. Any other is unchecked, with the reason given, the files it is
 * about and what it is about: a check with nothing to check by is no check. A
 * `file` set on a rule without examples is one of its files too.
 */
export function kindOf(written: z.infer<typeof Written>): Criterion {
	const {id, rule, file, name, uses} = written;
	const [first, ...rest] = written.examples;
	if (written.check === "example" && first !== undefined) {
		return {kind: "example", id, rule, file, name, uses, examples: [first, ...rest]};
	}
	const clean = (paths: readonly string[]) => [
		...new Set(paths.map((f) => f.trim()).filter((f) => f !== "")),
	];
	const files = clean([file, ...written.files]);
	const [snippet, ...more] = written.snippets;
	if (written.check === "type" && snippet !== undefined) {
		const imports = name.trim() === "" || file.trim() === "" ? uses : [{name, file}, ...uses];
		return {
			kind: "type",
			id,
			rule,
			files: clean(written.files),
			uses: imports,
			snippets: [snippet, ...more],
		};
	}
	const test = written.test.trim();
	if (written.check === "existing_test" && test !== "") {
		return {kind: "existing_test", id, rule, test, files: files.filter((f) => f !== test)};
	}
	return {
		kind: "unchecked",
		id,
		rule,
		files,
		about: written.unchecked_kind,
		why:
			written.no_example ??
			`no ${written.check === "unchecked" ? "check" : written.check.replace("_", " ")} was given`,
	};
}

/**
 * How a criterion gets used, so the enricher writes ones that survive it. It is
 * the brief experiment 19 measured (see experiments/19-data-criteria.md), with
 * the file and the function named so code can write the import, and the vetting
 * every draft now goes through before it is kept
 * (experiments/41-enrichment-in-small-steps.md).
 */
const DATA_BRIEF = [
	`How your criteria will be used: each criterion is data, a rule and the examples that prove it. An example is one JavaScript call and the exact value it returns, such as call \`formatPrice(3.5)\` and result \`"3.50"\`. Code turns every example into a one-line test that the call's value deep-equals the result exactly, such as \`expect(<call>).toStrictEqual(<result>)\`, imports \`name\` and every name in \`uses\` from the files you give, typechecks it with the repo's own settings when the repo is typed, and runs it against the finished code, with no person or model in between. So the call must be one expression that runs exactly as written, and the result must be exactly right.`,
	`Before anyone builds, your draft is checked by code: every file a criterion names must exist, and every example is run on today's code, before the change. It must load, typecheck and run, and its assertion must fail, since the change is not made yet. An example that already passes today shows nothing the change does, and is sent back; so is one that does not run, with its error. Whatever is sent back comes to you in this conversation, to fix.`,
	`- One claim per rule. A sentence that says two things becomes two criteria.`,
	`- Give each rule one example, or more only when one cannot show it. Pick an input that the rule decides: a test of "upper case becomes lower case" needs an upper-case letter in it.`,
	`- Say what the finished code does. A rule today's code already follows gets no example: if it is a limit on types, write it as a type guard (below); otherwise leave it out.`,
	`- Use the code the way its own users and tests do. When a call takes a value the library builds, build it inline with the library's own constructor, such as a real machine made with the library's constructor, and put that constructor in uses. A plain object standing in for one may run, but its types can fail where the real value's would not.`,
	`- An example must typecheck against today's code and against the code as this issue leaves it, and must need no change the issue does not ask for: no widened signature, no loosened type, no new export, no cast. If you cannot write such a call, the rule gets no example.`,
	`Three more checks, for rules no call can show. Prefer a checkable one: a rule is unchecked only when no snippet or test can show it.`,
	`- type, for a rule about types or signatures, such as a bug that lives only in the types: one or more TypeScript snippets, a few statements each, no imports (put every name they import in uses). Each either compiles, or rejects: then put \`// @ts-expect-error\` on the line above the one that must be a type error, and the rest must compile. Say for each whether today's code already holds it (a guard: a limit the change must keep) or fails it (it shows the change). Vetting typechecks each on today's code and sends back any that does not stand as you say. Write the limits the ticket sets (what the change must not widen or break, from its no-gos and rabbit holes too) as guards when they are about types, such as a call that must stay rejected. Use every name you declare: an unused one is a type error here.`,
	`- existing_test: a test file in the repo that must pass once the change is made, such as a doc page's twin. Name it in test. It is run on today's code too; passing or failing today are both fine.`,
	`- unchecked: nothing can show it (timing, files, side effects). Say why in no_example, list in files the files it is about, and say in unchecked_kind what it is about: type, doc or other.`,
].join("\n");

/** The facts as the enricher's first turn gives them. */
const factsSection = (facts: EnrichRequest["facts"]): string[] =>
	facts === null
		? []
		: [
				[
					`What code found in this folder about the names and paths the issue mentions, at HEAD. These are exact: start from them, and read the code only for what they do not settle. A name nothing declares may be a stale report; a path not at HEAD may have moved.`,
					factsBrief(facts),
					...(facts.pages.some((p) => p.twins.length > 0)
						? [
								`A doc page with a twin is checked through its twin: the repo's tests run or typecheck the page's code there. For a rule about such a page, make it an existing_test criterion naming the twin, with the page in its files, and do not call the rule unchecked doc.`,
							]
						: []),
				].join("\n\n"),
			];

/**
 * What the enricher is told. The rules are fabrika's triage skill, cut to fit
 * a toy. A later turn in the same conversation is only the note: it already
 * holds the issue.
 */
export function enrichPromptFor(request: EnrichRequest): string {
	if (request.session !== null && request.note !== null) return request.note;
	return [
		`You are triaging one raw issue for the code in the current folder. Turn it into an issue a builder can pick up cold. You write no code, and you cannot run anything.`,
		`# ${request.raw.title}`,
		request.raw.body,
		...factsSection(request.facts),
		[
			`Rules:`,
			`- Never work from the title alone. Check what the issue claims against the code first: against the facts above, and the code itself where they say nothing.`,
			`- No invention. Write only what you found or what the issue says. Keep the uncertainty the issue had.`,
			`- The first criterion states the user's job as an outcome someone could observe.`,
			`- Write one criterion for each rule you found, most important first.`,
			`- If the issue rests on a product or design call nobody has made, a real choice between behaviours that neither the code nor the issue settles, ask it in open_decision as one question for the owner, and write criteria only for what is settled. Not for something more reading would answer: read instead. Otherwise open_decision is null.`,
		].join("\n"),
		DATA_BRIEF,
		...(request.note === null ? [] : [request.note]),
	].join("\n\n");
}

/**
 * Claude Code as the enricher, reading `dir`. It can read and search and
 * nothing else, and its turn must end in the typed rewrite.
 */
export function claudeEnricher(dir: string, options: ClaudeOptions = {}) {
	return Layer.succeed(Enricher, {
		enrich: (request) =>
			Effect.tryPromise({
				try: async (signal) => {
					const result = await turn(
						dir,
						options,
						{
							prompt: enrichPromptFor(request),
							session: request.session === null ? null : {id: request.session, continues: true},
							tools: ["Read", "Glob", "Grep"],
							schema: enrichedSchema,
						},
						signal,
					);
					const enriched = Enriched.parse(result.structured);
					return {
						issue: {
							id: request.raw.id,
							title: enriched.title,
							goal: enriched.goal,
							// The rewrite goes on top and the original stays beneath it.
							body: [
								`## In plain words\n\n${enriched.summary}`,
								enriched.details,
								`${AS_FILED}\n\n${request.raw.body}`,
							].join("\n\n"),
							criteria: [kindOf(enriched.criteria[0]), ...enriched.criteria.slice(1).map(kindOf)],
							// A blank question asks nothing, so it is no open call.
							openDecision: enriched.open_decision?.trim() || null,
						},
						session: result.session,
					};
				},
				catch: () => ({_tag: "agent_failed" as const}),
			}),
	});
}
