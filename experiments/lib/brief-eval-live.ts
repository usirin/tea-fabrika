// The live Sorter of experiment 163: one case under one brief, on opus through the Claude Agent SDK
// or on GPT sol through this repo's Codex adapter, the way experiment 162 ran them. The brief is
// opus's system prompt, and goes before the case on GPT sol (162 did the same with its SYSTEM).
//
//   opus  the Agent SDK's own login, no tools, no skills, no settings, the answer read by its schema
//   sol   `codexTurn` from lib/triage-codex.ts: gpt-6.1-sol, effort medium, on the ChatGPT plan, a
//         fresh Codex home each turn, removed after
//
// A brief with `code: read` (part 3) gets the code at the commit on main before the ticket was
// filed, as a plain read-only copy (`treePool`): opus with Read, Grep and Glob held by the read-only
// Check, as experiment 136's planner; GPT sol in a Codex box that only reads the folder.
//
// Node at the edge, said out loud: `node:fs` and `node:os` for the work folders, `node:child_process`
// for `git archive`, `tar`, `find` and `chmod` on the code copies, as 136 does.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {type Options, query} from "@anthropic-ai/claude-agent-sdk";
import {jsonSchema, reader} from "@kampus/fabrika-old/agents/claude";
import {agentEnv, guardHook} from "@kampus/fabrika-old/agents/sandbox";
import {Effect, Layer, Option, type Schema, type Scope} from "effect";
import {type Asked, answerOf, type Brief, type Said, Sorter} from "./brief-eval.ts";
import {type Earlier, fenced, type Ticket} from "./sort.ts";
import {codexTurn} from "./triage-codex.ts";

/** What the live Sorter reads a case from: each ticket as filed, and the repo's issue list. */
export interface World {
	readonly tickets: readonly Ticket[];
	readonly all: readonly Earlier[];
	/** What the repo is, in a few lines, per repo. */
	readonly notes: Readonly<Record<string, string>>;
	/**
	 * For a brief that reads code (part 3): the code at the commit on main before the case was filed,
	 * as a plain read-only copy held for the scope. Left out: such a brief cannot run.
	 */
	readonly tree?: (c: Asked) => Effect.Effect<Tree, string, Scope.Scope>;
}

/** A copy of the code at one commit. */
export interface Tree {
	readonly at: string;
	readonly path: string;
}

/**
 * Files added to one case's copy (part 4: the pull requests open when the ticket was filed). The
 * copy is then the case's own: `key` names it beside the commit.
 */
export interface Extra {
	readonly key: string;
	/** Path inside the copy, and its text. */
	readonly files: Readonly<Record<string, string>>;
}

/**
 * Copies of a clone's code, one per commit, made with `git archive` and held while a call reads them.
 * At most `keep` idle copies stay on disk; the oldest idle one goes first. Each copy has no history
 * and no links, and its files are read-only. `left` are paths taken out of every copy. With `extra`,
 * a case gets its own copy, its commit plus the extra files.
 */
export function treePool(o: {
	readonly clone: string;
	readonly root: string;
	readonly atOf: (c: Asked) => string | undefined;
	readonly keep: number;
	readonly left: readonly string[];
	readonly extra?: (c: Asked) => Extra;
}): (c: Asked) => Effect.Effect<Tree, string, Scope.Scope> {
	const held = new Map<string, {users: number; used: number}>();
	const pathOf = (dir: string) => join(o.root, dir, "code");
	const drop = (dir: string) => {
		const path = join(o.root, dir);
		if (existsSync(path)) execFileSync("chmod", ["-R", "u+w", path]);
		rmSync(path, {recursive: true, force: true});
	};
	const make = (dir: string, at: string, extra: Extra | null) => {
		const path = pathOf(dir);
		// A copy made whole by an earlier run is used as it is; a half-made one is made again.
		if (existsSync(join(o.root, dir, ".made"))) return;
		drop(dir);
		mkdirSync(path, {recursive: true});
		const packed = join(o.root, dir, "code.tar");
		execFileSync("git", ["-C", o.clone, "archive", "--format=tar", "-o", packed, at]);
		execFileSync("tar", ["-xf", packed, "-C", path]);
		rmSync(packed);
		for (const p of o.left) rmSync(join(path, p), {recursive: true, force: true});
		for (const [file, text] of Object.entries(extra?.files ?? {})) {
			mkdirSync(join(path, file, ".."), {recursive: true});
			writeFileSync(join(path, file), text);
		}
		// No link (the Check follows none), and nothing writable.
		execFileSync("find", [path, "-type", "l", "-delete"]);
		execFileSync("chmod", ["-R", "a-w", path]);
		writeFileSync(join(o.root, dir, ".made"), at);
	};
	const sweep = () => {
		const idle = [...held.entries()]
			.filter(([, h]) => h.users === 0)
			.toSorted((a, b) => a[1].used - b[1].used);
		for (const [dir] of idle.slice(0, Math.max(0, idle.length - o.keep))) {
			held.delete(dir);
			drop(dir);
		}
	};
	return (c) =>
		Effect.acquireRelease(
			Effect.try({
				try: () => {
					const at = o.atOf(c);
					if (at === undefined) throw new Error(`${c.id} has no commit: run STEP=trees`);
					const extra = o.extra?.(c) ?? null;
					const dir = extra === null ? at : `${at}-${extra.key}`;
					const h = held.get(dir) ?? {users: 0, used: 0};
					if (h.users === 0) make(dir, at, extra);
					held.set(dir, {users: h.users + 1, used: Date.now()});
					return {at, dir, path: realpathSync(pathOf(dir))};
				},
				catch: (e) => String(e),
			}),
			(t) =>
				Effect.sync(() => {
					const h = held.get(t.dir);
					if (h !== undefined) held.set(t.dir, {users: h.users - 1, used: Date.now()});
					sweep();
				}),
		).pipe(Effect.map(({at, path}): Tree => ({at, path})));
}

/** As 92b and 162: the 200 tickets filed just before, by number. */
const WINDOW = 200;

/** The case as the model reads it: the repo, the ticket as filed, the earlier titles. Pure. */
export function casePrompt(world: World, c: Asked): string {
	const t = world.tickets.find((x) => x.n === c.n);
	if (t === undefined) throw new Error(`${c.id} is not in the cache: run STEP=fetch`);
	const earlier = world.all
		.filter((e) => e.n < t.n)
		.toSorted((a, b) => b.n - a.n)
		.slice(0, WINDOW)
		.toReversed();
	return [
		world.notes[c.repo] ?? "",
		"",
		`# The ticket: #${t.n}, filed ${t.createdAt.slice(0, 10)}`,
		"",
		fenced(`# ${t.title}\n\n${t.body}`),
		"",
		`# The ${earlier.length} tickets filed just before it, oldest first`,
		"",
		earlier.length === 0 ? "None." : earlier.map((e) => `#${e.n} ${e.title}`).join("\n"),
	].join("\n");
}

/** A read-code call's cap, in dollars and turns: a ticket's triage reads a few files, not the repo. */
export const READ_USD = 0.6;
const READ_TURNS = 30;
const READ_TOOLS = ["Read", "Grep", "Glob"];

/** The line a read-code call adds after the case: where the code is and at which commit. Pure. */
export const codeLine = (t: Tree) =>
	`# The code\n\nYour working folder holds the project's code at commit ${t.at.slice(0, 12)}, the last commit on main before this ticket was filed. It is a read-only copy with no history.`;

/** What one turn hands back, for an answer of any shape: a Said, with that answer. */
export type Heard<A> = Omit<Said, "answer"> & {readonly answer: A | null};

/**
 * Opus, through the Agent SDK. With no tree: no tools, as in part 2. With a tree: Read, Grep and
 * Glob only, in the tree, held by the read-only Check (as experiment 136's planner), no settings.
 * The brief is the system prompt; `schema` is the answer's shape.
 */
export async function opusOnce<A>(
	brief: Brief,
	schema: Schema.Codec<A, unknown>,
	prompt: string,
	cwd: string,
	tree: Tree | null,
): Promise<Heard<A>> {
	const read = reader(schema);
	const started = Date.now();
	let seen = "";
	let reads = 0;
	let context = 0;
	const tools: Partial<Options> =
		tree === null
			? {tools: [], maxTurns: 3, cwd}
			: {
					tools: [...READ_TOOLS],
					allowedTools: [...READ_TOOLS],
					permissionMode: "dontAsk",
					hooks: {
						PreToolUse: [{hooks: [guardHook({tree: tree.path, alsoWritable: [], readOnly: true})]}],
					},
					maxTurns: READ_TURNS,
					maxBudgetUsd: READ_USD,
					cwd: tree.path,
				};
	for await (const message of query({
		prompt: tree === null ? prompt : `${prompt}\n\n${codeLine(tree)}`,
		options: {
			model: "opus",
			systemPrompt: brief.text,
			skills: [],
			mcpServers: {},
			strictMcpConfig: true,
			settingSources: [],
			persistSession: false,
			env: agentEnv(),
			outputFormat: {type: "json_schema", schema: jsonSchema(schema)},
			...tools,
		},
	})) {
		if (message.type === "system" && message.subtype === "init") seen = message.model;
		if (message.type === "assistant" && message.parent_tool_use_id === null) {
			const u = message.message.usage;
			context =
				u.input_tokens +
				u.output_tokens +
				(u.cache_creation_input_tokens ?? 0) +
				(u.cache_read_input_tokens ?? 0);
			for (const block of message.message.content)
				if (block.type === "tool_use" && READ_TOOLS.includes(block.name)) reads += 1;
		}
		if (message.type === "result") {
			const u = message.usage;
			const answer =
				message.subtype === "success" ? read(message.structured_output) : Option.none();
			return {
				answer: Option.getOrNull(answer),
				modelId: seen,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				tokens: {
					input:
						u.input_tokens +
						(u.cache_creation_input_tokens ?? 0) +
						(u.cache_read_input_tokens ?? 0),
					cached: u.cache_read_input_tokens ?? 0,
					output: u.output_tokens,
				},
				error: Option.isSome(answer) ? null : `${message.subtype}: no answer that fits`,
				...(tree === null ? {} : {code: {at: tree.at, reads, context}}),
			};
		}
	}
	return {
		answer: null,
		modelId: seen,
		usd: null,
		ms: Date.now() - started,
		tokens: {input: 0, cached: 0, output: 0},
		error: "no result",
	};
}

/**
 * GPT sol through Codex. The brief goes before the case, as in part 2. With a tree: Codex works in
 * it, the box makes it read-only, and its commands count as reads.
 */
export async function solOnce<A>(
	brief: Brief,
	schema: Schema.Codec<A, unknown>,
	prompt: string,
	folder: string,
	tree: Tree | null,
): Promise<Heard<A>> {
	const r = await codexTurn(
		tree === null
			? `${brief.text}\n\n${prompt}`
			: `${brief.text}\n\n${prompt}\n\n${codeLine(tree)}`,
		schema,
		tree === null
			? {name: "exp-163", folder, effort: "medium"}
			: {name: "exp-163", folder: tree.path, effort: "medium", reads: "code"},
	);
	return {
		answer: r.answer,
		modelId: r.model,
		usd: null,
		ms: r.ms,
		tokens: r.tokens,
		error: tree === null && r.tools > 0 ? `${r.error ?? ""} ran ${r.tools} tools`.trim() : r.error,
		...(tree === null ? {} : {code: {at: tree.at, reads: r.tools}}),
	};
}

/**
 * The live Sorter, with one empty work folder for its whole life, removed when the layer closes.
 * Refuses a key in the environment: opus runs on the SDK's own login, GPT sol on the ChatGPT plan.
 */
export const liveSorter = (world: World): Layer.Layer<Sorter> =>
	Layer.effect(
		Sorter,
		Effect.gen(function* () {
			for (const key of ["TYPESAFE_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"])
				if (process.env[key] !== undefined) return yield* Effect.die(`${key} is set: unset it`);
			const folder = yield* Effect.acquireRelease(
				Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "exp-163-")))),
				(f) => Effect.sync(() => rmSync(f, {recursive: true, force: true})),
			);
			// A call that throws is an answer with an error, so one bad call does not stop the job.
			const failed = (cause: unknown): Said => ({
				answer: null,
				modelId: "",
				usd: null,
				ms: 0,
				tokens: {input: 0, cached: 0, output: 0},
				error: String(cause).replaceAll(homedir(), "~").slice(0, 400),
			});
			const ask = (brief: Brief, model: string, c: Asked, tree: Tree | null) =>
				Effect.tryPromise({
					try: (): Promise<Said> =>
						model === "opus"
							? opusOnce(brief, answerOf(brief), casePrompt(world, c), folder, tree)
							: solOnce(brief, answerOf(brief), casePrompt(world, c), folder, tree),
					catch: failed,
				});
			return Sorter.of({
				sort: (brief, model, c) =>
					(brief.code === "none"
						? ask(brief, model, c, null)
						: world.tree === undefined
							? Effect.fail(failed(`${brief.id} reads code and this world has no trees`))
							: Effect.scoped(
									world.tree(c).pipe(
										Effect.mapError(failed),
										Effect.flatMap((tree) => ask(brief, model, c, tree)),
									),
								)
					).pipe(Effect.catch((said) => Effect.succeed(said))),
			});
		}),
	);
