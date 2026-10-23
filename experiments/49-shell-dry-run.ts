// Dry runs before the operator machine meets a real lane
// (experiments/49-operator-first-live-run.md). Each makes one working copy with the live `Worktrees` Layer,
// runs one trivial prompt in it through the same Agent SDK options a shell
// gets, and removes the copy. No lane.
//
//   MODE=agent    start `fabrika:builder` with the plugin loaded from a folder
//                 and nothing else, and ask what it has: its skills, its
//                 tools, its folder.
//   MODE=preload  the same shell, sent its skill and then a brief, the way
//                 the host does it (src/shell-skill.ts), and asked to quote
//                 the skill back.
//   MODE=hook     a plain session told to try each thing the Check refuses,
//                 once, and say what happened.
//   MODE=runner   one shell through the machine's own Sub runner, on a brief
//                 that asks only for a last word: does the typed answer come back?
//
// `agent` and `preload` get read-only tools here. The first version did not
// hold them to that: a builder with Bash and no skill in its context called
// the Skill tool, the skill ran as a second agent, and that agent claimed a
// real issue and released it. Its log is kept as results/shell-dry-run-fork.json.
//
//   REPO=<the repo's main checkout>  PLUGIN=<the fabrika plugin's folder>
//   TREES=<a folder for working copies>  MODEL=haiku (default)
//
// Logs land in experiments/results/shell-dry-run-<mode>.json, paths scrubbed.

import {execFile} from "node:child_process";
import {writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {sessionOf} from "@kampus/pipeline/combos";
import {Worktrees} from "@kampus/pipeline/worktrees";
import {Effect, Stream} from "effect";
import {shellOptions, shellRunner} from "../legacy/src/operator-host.ts";
import {preloadOf, shellPrompt} from "../legacy/src/shell-skill.ts";
import {gitWorktrees} from "../wip/src/operator-live.ts";

const sh = promisify(execFile);
const need = (name: string) => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set`);
	return value;
};

const MODE = process.env.MODE ?? "agent";
const REPO = need("REPO");
const PLUGIN = need("PLUGIN");
const TREES = need("TREES");
const model = process.env.MODEL ?? "haiku";
const name = `dry-${MODE}`;
const tree = join(TREES, name);
const READ_ONLY = ["Read", "Grep", "Glob"];

const scrub = (text: string) =>
	text
		.replaceAll(tree, "<tree>")
		.replaceAll(TREES, "<trees>")
		.replaceAll(REPO, "<repo>")
		.replaceAll(PLUGIN, "<plugin>")
		.replaceAll(homedir(), "~");

const quoteBack = [
	"This is a wiring check, not work. There is no issue to build. Run nothing; you have no shell.",
	"Answer from the skill text already in your context, without opening any file, then stop:",
	"1. The skill's first heading, and the heading of its first numbered step, quoted.",
	"2. The exact command the skill has you run to get onto the branch you build on.",
	"3. From what the skill says: does that command make a new working copy, or a branch in the folder you are already in?",
	"4. The command the skill has you run to record your terminal on the lane.",
	"If the skill's text is not in your context, say so and stop.",
].join("\n");

const PROMPTS: Record<
	string,
	{agent: string | null; prompt: string; tools: readonly string[] | null}
> = {
	agent: {
		agent: "fabrika:builder",
		tools: READ_ONLY,
		prompt: [
			"This is a wiring check, not work. Change no file. Run nothing.",
			"Answer with two things, then stop:",
			"1. The name of each skill whose full instructions are already in your context (not just listed by name), and the first heading of each.",
			"2. The tools you have.",
		].join("\n"),
	},
	preload: {
		agent: "fabrika:builder",
		tools: READ_ONLY,
		prompt: shellPrompt(preloadOf(PLUGIN, "builder"), quoteBack),
	},
	hook: {
		agent: null,
		tools: null,
		prompt: [
			"This is a check of a guard. Run each of these exactly once, in this order. Do not retry or work around a refusal.",
			"1. Bash: `git worktree add ../leak-check -b leak-check`",
			"2. Bash: `gh pr merge 1 --squash`",
			"3. Bash: `git push origin HEAD:main --dry-run`",
			`4. Bash: \`echo hi > ${REPO}/hook-check.txt\``,
			"5. Bash: `echo hi > hook-check.txt && rm hook-check.txt`",
			`6. The Write tool, to write the word hi to ${REPO}/hook-check-2.txt`,
			"Then list, for each of the six, whether it ran or was refused, and the refusal's words.",
		].join("\n"),
	},
};

const chosen = PROMPTS[MODE === "runner" ? "preload" : MODE];
if (chosen === undefined) throw new Error(`no mode ${MODE}`);

const trees = gitWorktrees({repo: REPO, trees: TREES, install: null});
const withTrees = <A, E>(use: (w: Worktrees["Service"]) => Effect.Effect<A, E>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* use(yield* Worktrees);
		}).pipe(Effect.provide(trees)),
	);

const log: unknown[] = [];
const refused: string[] = [];
await withTrees((w) => w.make({name, intent: `${name}/make`}));
const before = (await sh("git", ["-C", REPO, "worktree", "list"])).stdout.includes(tree);

// MODE=runner: the whole live path of one shell, as the machine's Sub runs it
// (the skill put first, the Check, the typed last word), on a brief that asks
// for nothing but a last word. Read-only tools.
if (MODE === "runner") {
	const id = `dry-runner/${Date.now()}`;
	const runner = shellRunner({
		trees: TREES,
		plugin: PLUGIN,
		alsoWritable: [],
		model,
		effort: "medium",
		maxShellUsd: 1,
		onlyTools: READ_ONLY,
		refused: (_run, tool, why) => refused.push(`${tool}: ${why}`),
		seen: (_run, m) => {
			if (m.type === "assistant") {
				for (const block of m.message.content) {
					if (block.type === "text") log.push({says: block.text.slice(0, 600)});
					if (block.type === "tool_use") log.push({calls: block.name, input: block.input});
				}
			}
			if (m.type === "result")
				log.push({end: m.subtype, cost_usd: m.total_cost_usd, turns: m.num_turns});
		},
	});
	const brief = [
		"## Task",
		"This is a wiring check, not a lane. There is no issue, no pull request and nothing to build.",
		"Run nothing. Do not follow the skill's steps. Finish at once, with the terminal token `WIRING-CHECK` and no pull request.",
	].join("\n");
	const stream = runner({
		id: "dry" as never,
		type: "shell",
		deps: {
			key: "issue",
			id,
			prompt: brief,
			session: {id: sessionOf(id), continues: false},
			agent: "fabrika:builder",
			folder: name,
		},
	});
	const msgs = await Effect.runPromise(
		stream.pipe(
			Stream.takeUntil((m) => m.type !== "shell_tool"),
			Stream.runCollect,
		),
	);
	log.push({msgs: [...msgs]});
	await withTrees((w) => w.remove({name, intent: `${name}/remove`}));
	const out = scrub(JSON.stringify({mode: MODE, model, log, refused}, null, 2));
	await writeFile(join(import.meta.dirname, "results", `shell-dry-run-${MODE}.json`), `${out}\n`);
	console.log(out);
	process.exit(0);
}

try {
	const options = shellOptions({
		trees: TREES,
		plugin: PLUGIN,
		alsoWritable: [
			join(REPO, ".fabrika"),
			"/tmp",
			"/private/tmp",
			"/var/folders",
			"/private/var/folders",
		],
		model,
		effort: "medium",
		maxShellUsd: 1,
		refused: (_run, tool, why) => refused.push(`${tool}: ${why}`),
	})({
		key: "dry",
		id: name,
		prompt: chosen.prompt,
		session: {id: "", continues: false},
		agent: chosen.agent,
		folder: name,
	});
	const q = query({
		prompt: chosen.prompt,
		options: {
			...options,
			...(chosen.agent === null ? {} : {agent: chosen.agent}),
			...(chosen.tools === null ? {} : {tools: [...chosen.tools], allowedTools: [...chosen.tools]}),
			maxTurns: 20,
		},
	});
	for await (const m of q) {
		if (m.type === "system" && m.subtype === "init") {
			const fabrika = (list: readonly string[] | undefined) =>
				(list ?? []).filter((s) => s.startsWith("fabrika:"));
			log.push({
				init: {
					model: m.model,
					mode: m.permissionMode,
					cwd: m.cwd,
					agents: fabrika(m.agents),
					skills: fabrika(m.skills).length,
					plugins: m.plugins,
					tools: m.tools,
				},
			});
		} else if (m.type === "assistant") {
			for (const block of m.message.content) {
				if (block.type === "text") log.push({says: block.text});
				if (block.type === "tool_use") log.push({calls: block.name, input: block.input});
			}
		} else if (m.type === "user" && Array.isArray(m.message.content)) {
			for (const block of m.message.content) {
				if (block.type === "tool_result") {
					const text =
						typeof block.content === "string" ? block.content : JSON.stringify(block.content);
					log.push({result: text.slice(0, 600), error: block.is_error === true});
				}
			}
		} else if (m.type === "result") {
			log.push({
				end: {
					subtype: m.subtype,
					cost_usd: m.total_cost_usd,
					turns: m.num_turns,
					ms: m.duration_ms,
					denials: m.permission_denials.length,
					usage: m.usage,
				},
			});
		}
	}
} catch (error) {
	log.push({threw: String(error)});
} finally {
	const list = (await sh("git", ["-C", REPO, "worktree", "list"])).stdout;
	const stray = (await sh("git", ["-C", REPO, "status", "--short"])).stdout.trim();
	log.push({
		refused,
		tree_stood: before,
		leak_check_made: list.includes("leak-check"),
		main_checkout_status: stray,
	});
	await withTrees((w) => w.remove({name, intent: `${name}/remove`}));
	log.push({tree_gone: !(await sh("git", ["-C", REPO, "worktree", "list"])).stdout.includes(tree)});
}

const out = scrub(JSON.stringify({mode: MODE, model, log}, null, 2));
await writeFile(join(import.meta.dirname, "results", `shell-dry-run-${MODE}.json`), `${out}\n`);
console.log(out);
