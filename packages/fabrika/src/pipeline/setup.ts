import {Effect, FileSystem, Path} from "effect";
import type {Rules} from "./code-host-github.ts";
import {AGENT_STEPS, type AgentStep, type EFFORTS, type Settings} from "./settings.ts";

// What one run of fabrika works by in one repository, picked once at the edge
// from three places, and printed, one line per pick, before anything runs:
//
//   fabrika.toml   the repository's own picks (./settings.ts)
//   tsh.toml       this machine's: the model, effort and budget an agent step
//                  falls back to, and a rubrics folder (./tsh/config.ts)
//   the repository what it holds at the commit fabrika.toml was read at: its
//                  lockfile, CODEOWNERS, .fabrika.jsonc, CLAUDE.md, AGENTS.md,
//                  a workflow folder (`Holds`, read by ./settings-source.ts)
//
// A key left out of both files gets a named default, and the line says so and
// why. A pick that will stop the run later (approval asked of a CODEOWNERS
// file that is not there; checks counted on GitHub where no workflow runs)
// is said at the start, in a line that names the key that changes it.
//
// Pure: `setupOf` and `setupLines` read nothing. The edge reads, and hands
// each part its values when it is made: no machine reads a file.

/** The paths asked about at the commit: each is there, or it is not. */
export const ASKED = [
	"CLAUDE.md",
	"AGENTS.md",
	".github/CODEOWNERS",
	"CODEOWNERS",
	"docs/CODEOWNERS",
	".fabrika.jsonc",
	".github/workflows",
	"pnpm-lock.yaml",
	"package-lock.json",
	"yarn.lock",
	"bun.lock",
] as const;

/** The rubric files a folder of rubrics holds. */
export const RUBRIC_FILES = ["code.md", "doc.md", "skill.md"] as const;

/** What the repository holds at the commit fabrika.toml was read at. */
export interface Holds {
	/** Each path of `ASKED` that is there. */
	readonly files: ReadonlySet<string>;
	/** `[review] rubrics`: the texts of the rubric files its folder holds, by file name. Empty: none, or no folder named. */
	readonly rubrics: Readonly<Partial<Record<(typeof RUBRIC_FILES)[number], string>>>;
}

/** Nothing there: a folder with no repository, or a test. */
export const HOLDS_NOTHING: Holds = {files: new Set(), rubrics: {}};

/** This machine's fallbacks, from tsh.toml. `null`: the file leaves it out. */
export interface Local {
	readonly model: string | null;
	readonly effort: (typeof EFFORTS)[number] | null;
	readonly budget: number | null;
	readonly rubrics: string | null;
}

/** The code's own fallbacks for an agent step, when neither file names one. */
export const AGENT_DEFAULT = {model: "opus", effort: "medium", budget: 2} as const;

/** Where a pick came from. `repo`: worked out from what the repository holds. */
export type From = "fabrika.toml" | "tsh.toml" | "repo" | "default";

export interface Picked<A> {
	readonly value: A;
	readonly from: From;
}

export interface AgentPick {
	readonly model: Picked<string>;
	readonly effort: Picked<(typeof EFFORTS)[number]>;
	readonly budget: Picked<number>;
}

/** What lets a ticket be built: its plan approved on the ledger, or a label on it. */
export type Go = {readonly by: "plan"} | {readonly by: "label"; readonly label: string};

/** A command fabrika runs itself at each head, in a copy of it. */
export interface RunCheck {
	readonly name: string;
	readonly run: readonly [string, ...string[]];
}

export interface Setup {
	readonly agents: {readonly [S in AgentStep]: AgentPick};
	readonly go: Picked<Go>;
	/** Run once in a fresh copy, before the builder. `[]`: nothing. */
	readonly install: Picked<readonly string[]>;
	/** The commands the builder is told to run. `[]`: it is told to find them in the repository. */
	readonly told: Picked<readonly (readonly string[])[]>;
	/** The folder the reviewer's rubrics are read from, on this machine. */
	readonly rubrics: Picked<string>;
	/** The review rules where a change's base or head has no `.fabrika.jsonc`. */
	readonly kinds: Picked<Rules>;
	/** Which of GitHub's checks count. */
	readonly github: Picked<"every" | "required" | "none">;
	readonly run: Picked<readonly RunCheck[]>;
	readonly approval: Picked<"codeowners" | "none">;
	readonly ledger: Picked<"local" | "sqlite">;
}

/**
 * Where the rubrics are, on this machine: fabrika's own, and the folder the
 * edge writes the repository's rubric texts into. Only fabrika.toml's
 * `[review] rubrics` says whether the repository's are read: a folder handed
 * in here never stands in for that pick.
 */
export interface RubricPlaces {
	readonly shipped: string;
	readonly repo: string;
}

const LOCKS: readonly (readonly [string, readonly string[]])[] = [
	["pnpm-lock.yaml", ["pnpm", "install", "--frozen-lockfile"]],
	["package-lock.json", ["npm", "ci"]],
	["yarn.lock", ["yarn", "install", "--frozen-lockfile"]],
	["bun.lock", ["bun", "install", "--frozen-lockfile"]],
];

const pick = <A>(
	first: A | undefined,
	firstFrom: From,
	second: A | null | undefined,
	secondFrom: From,
	last: A,
): Picked<A> =>
	first !== undefined
		? {value: first, from: firstFrom}
		: second !== undefined && second !== null
			? {value: second, from: secondFrom}
			: {value: last, from: "default"};

/** The picks of one run. Pure. */
export function setupOf(
	settings: Settings,
	holds: Holds,
	local: Local,
	rubrics: RubricPlaces,
): Setup {
	const agentOf = (step: AgentStep): AgentPick => {
		const own = settings.agents?.[step];
		return {
			model: pick(own?.model, "fabrika.toml", local.model, "tsh.toml", AGENT_DEFAULT.model),
			effort: pick(own?.effort, "fabrika.toml", local.effort, "tsh.toml", AGENT_DEFAULT.effort),
			budget: pick(own?.usd, "fabrika.toml", local.budget, "tsh.toml", AGENT_DEFAULT.budget),
		};
	};
	const build = settings.build;
	const lock = LOCKS.find(([file]) => holds.files.has(file));
	const run = (settings.checks?.run ?? []).map((check) => ({
		name: check.name,
		run: check.run,
	}));
	return {
		agents: Object.fromEntries(AGENT_STEPS.map((step) => [step, agentOf(step)])) as Setup["agents"],
		go:
			build?.go === "label"
				? {value: {by: "label", label: build.label ?? "ready-for:agent"}, from: "fabrika.toml"}
				: {value: {by: "plan"}, from: build?.go === undefined ? "default" : "fabrika.toml"},
		install:
			build?.install !== undefined
				? {value: build.install, from: "fabrika.toml"}
				: {value: lock?.[1] ?? [], from: "repo"},
		told:
			build?.checks !== undefined
				? {value: build.checks, from: "fabrika.toml"}
				: run.length > 0
					? {value: run.map((check) => check.run), from: "fabrika.toml"}
					: {value: [], from: "default"},
		rubrics:
			local.rubrics !== null
				? {value: local.rubrics, from: "tsh.toml"}
				: settings.review?.rubrics !== undefined
					? {value: rubrics.repo, from: "fabrika.toml"}
					: {value: rubrics.shipped, from: "default"},
		kinds:
			settings.review?.governed !== undefined || settings.review?.ui !== undefined
				? {
						value: {governed: settings.review.governed ?? [], ui: settings.review.ui ?? []},
						from: "fabrika.toml",
					}
				: {value: {governed: [], ui: []}, from: "default"},
		github: pick(settings.checks?.github, "fabrika.toml", null, "default", "every"),
		run: {value: run, from: run.length > 0 ? "fabrika.toml" : "default"},
		approval: pick(settings.ship?.approval, "fabrika.toml", null, "default", "codeowners"),
		ledger: pick(settings.ledger?.at, "fabrika.toml", null, "default", "local"),
	};
}

const said = (from: From) =>
	from === "default" ? "default" : from === "repo" ? "from the repository" : `from ${from}`;
const words = (command: readonly string[]) => (command.length === 0 ? "none" : command.join(" "));

/**
 * The picks as lines, each with where it came from, and a line for each
 * thing the repository lacks that a step reads. Pure.
 */
export function setupLines(setup: Setup, holds: Holds, settings: Settings): readonly string[] {
	const has = (file: string) => holds.files.has(file);
	const agents = AGENT_STEPS.map((step) => {
		const a = setup.agents[step];
		return `agents.${step}: ${a.model.value} (${said(a.model.from)}), effort ${a.effort.value} (${said(a.effort.from)}), at most $${a.budget.value} a run (${said(a.budget.from)})`;
	});
	const go =
		setup.go.value.by === "plan"
			? `build.go: plan (${said(setup.go.from)}): a ticket is built only once the owner approved its plan on the ledger; labels are not read`
			: `build.go: label (${said(setup.go.from)}): a ticket is built when it carries ${setup.go.value.label}`;
	const lock = LOCKS.find(([file]) => has(file));
	const locks = LOCKS.filter(([file]) => has(file)).map(([file]) => file);
	const install =
		setup.install.from === "fabrika.toml"
			? `build.install: ${words(setup.install.value)} (from fabrika.toml)`
			: lock === undefined
				? "build.install: none (default: no lockfile at main)"
				: `build.install: ${words(setup.install.value)} (default: ${lock[0]} at main${locks.length > 1 ? `; also ${locks.slice(1).join(", ")}, not read` : ""})`;
	const told =
		setup.told.value.length === 0
			? `build.checks: none named (${said(setup.told.from)}): the builder is told to find the repository's checks itself`
			: `build.checks: ${setup.told.value.map(words).join("; ")} (${setup.told.from === "fabrika.toml" && settings.build?.checks === undefined ? "default: the [[checks.run]] commands" : said(setup.told.from)})`;
	const rules = ["CLAUDE.md", "AGENTS.md"].map(
		(file) =>
			`rules: ${file} ${has(file) ? "at main, read from main by the builder and the reviewer" : "none at main: agents are told the repository has none"}`,
	);
	const rubrics = `review.rubrics: ${setup.rubrics.value} (${setup.rubrics.from === "default" ? "default: the rubrics fabrika ships" : said(setup.rubrics.from)})`;
	const missingRubrics =
		setup.rubrics.from === "fabrika.toml"
			? RUBRIC_FILES.filter((file) => holds.rubrics[file] === undefined).map(
					(file) =>
						`review.rubrics: ${file} is not in the repository's folder: a change of that kind stops at rubric_unknown`,
				)
			: [];
	const kinds = has(".fabrika.jsonc")
		? "review kinds: .fabrika.jsonc at main, read at each change's base and head"
		: `review kinds: no .fabrika.jsonc at main, so governed [${setup.kinds.value.governed.join(", ")}] and ui [${setup.kinds.value.ui.join(", ")}] (${said(setup.kinds.from)})${setup.kinds.value.governed.length === 0 && setup.kinds.value.ui.length === 0 ? ": text reviews only" : ""}`;
	const github =
		setup.github.value === "none"
			? `checks.github: none (${said(setup.github.from)}): GitHub's checks do not count`
			: `checks.github: ${setup.github.value} (${said(setup.github.from)})${!has(".github/workflows") && setup.run.value.length === 0 ? ": no .github/workflows at main and no [[checks.run]], so unless another service reports a check, checks wait for ever: add a [[checks.run]]" : ""}`;
	const run =
		setup.run.value.length === 0
			? "checks.run: none (default)"
			: `checks.run: ${setup.run.value.map((c) => `${c.name} = ${words(c.run)}`).join("; ")} (from fabrika.toml): run by fabrika at each head, in a copy of it, with no login in reach`;
	const owners = has(".github/CODEOWNERS");
	const elsewhere = ["CODEOWNERS", "docs/CODEOWNERS"].filter(has);
	const approval =
		setup.approval.value === "none"
			? `ship.approval: none (from fabrika.toml): no approval is asked for, unless a .github/CODEOWNERS at a change's base names an owner, which still binds`
			: owners
				? `ship.approval: codeowners (${said(setup.approval.from)}): .github/CODEOWNERS at main says whose approval a change needs`
				: `ship.approval: codeowners (${said(setup.approval.from)}), but no .github/CODEOWNERS at main${elsewhere.length > 0 ? ` (${elsewhere.join(", ")} is not read)` : ""}: ship stops at approval_unknown. Say [ship] approval = "none" when no approval is needed`;
	const ledger = `ledger.at: ${setup.ledger.value} (${said(setup.ledger.from)})`;
	return [
		...agents,
		go,
		install,
		told,
		...rules,
		rubrics,
		...missingRubrics,
		kinds,
		github,
		run,
		approval,
		ledger,
	];
}

/**
 * The rubrics fabrika ships: `rubrics/` at the root of the package, beside
 * `src/` and `dist/`. Found from this file, which sits two folders below the
 * root in both.
 */
export const shippedRubrics = (): Effect.Effect<string, never, Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const here = yield* path.fromFileUrl(new URL(".", import.meta.url)).pipe(Effect.orDie);
		return path.resolve(here, "..", "..", "rubrics");
	});

/** Write the repository's rubric texts into `folder`, for the reviewer to read. */
export const writeRubrics = (
	folder: string,
	texts: Holds["rubrics"],
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		yield* fs.makeDirectory(folder, {recursive: true}).pipe(Effect.orDie);
		for (const [file, text] of Object.entries(texts))
			if (text !== undefined)
				yield* fs.writeFileString(path.join(folder, file), text).pipe(Effect.orDie);
		return folder;
	});
