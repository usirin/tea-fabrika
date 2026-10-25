// Experiment 140: can Cloudflare's extraction model Clairic pull out the code
// names, files and error messages a ticket mentions, well enough to hand the
// plan agent a short starting list? And does it beat `mentionsOf`?
//
// The six closed kamp-us/demlik tickets of experiment 86b, each read as 86b's
// planner got it: the title and the report as filed, at the fix PR's base
// commit. Three arms:
//   A  code: `mentionsOf` (legacy/src/facts.ts), then the facts pack 86b built
//      from it (`localFacts`, with code-graph off) and its `factsBrief`
//   B  Clairic: one call a ticket with three list fields, the same pack built
//      from what it returned
//   C  A and B together, one pack from both lists
// Each is scored against two kinds of truth: the files the 86b plan's
// `pointers` cite, and the files the fix PR changed that were there at the
// base commit (from replay/issues/<n>.json).
//
// Run with
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... STEP=call RUN=1 ONLY=367 \
//     node experiments/140-clairic-ticket-mentions.ts
//
//   STEP=call   one Clairic call a ticket for run RUN (1 to 3); a run already
//               kept is not called again. DRY=1 prints the estimated tokens
//               and dollars and calls nothing.
//   STEP=score  (no key, no network) build the packs, score all arms, print
//
// DEMLIK=<a local clone of kamp-us/demlik> (default runs/exp-140-cache/demlik).
// Scratch checkouts go to runs/exp-140-cache/clones, never committed. Nothing
// is written to GitHub. The token and the account id are read from the
// environment only, and are never printed or saved: any text saved from an
// error has both removed first.
//
// Node at the edge, said out loud: `node:fs` for the result file and
// `node:child_process` for `git`, as 86b does; `fetch` for the one HTTP call.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {type Published, userNames} from "@kampus/pipeline/stages/plan/names";
import {Effect} from "effect";
import {localFacts} from "../legacy/src/code-facts.ts";
import {Facts} from "../legacy/src/factory-services.ts";
import {type FactsPack, factsBrief, type Mentions, mentionsOf} from "../legacy/src/facts.ts";

const here = import.meta.dirname;
const CACHE = join(here, "..", "runs", "exp-140-cache");
const DEMLIK = process.env.DEMLIK ?? join(CACHE, "demlik");
const STEP = process.env.STEP ?? "score";
const RESULTS = join(here, "results", "140-clairic-ticket-mentions.json");
const PLANS = join(here, "results", "86b-plans.json");
const TICKETS = [367, 393, 490, 504, 565, 579] as const;
const PRICE_PER_TOKEN = 0.1 / 1_000_000;

if (process.env.TYPESAFE_API_KEY !== undefined)
	throw new Error("TYPESAFE_API_KEY is set: run with it unset, this experiment makes no Jev call");

// ---------------------------------------------------------------- the tickets

interface Replay {
	readonly number: number;
	readonly title: string;
	readonly rawReport: string;
	readonly pr: {readonly number: number; readonly baseSha: string};
	readonly filesChanged: readonly {readonly path: string}[];
}

const replayOf = (n: number): Replay =>
	JSON.parse(readFileSync(join(here, "..", "replay", "issues", `${n}.json`), "utf8"));

/** The text 86b's planner and `mentionsOf` read: the title, then the report as filed. */
const textOf = (r: Replay) =>
	`${r.title}\n\n${r.rawReport.replace(/\n---\n<sub>[\s\S]*$/, "").trim()}`;

// ---------------------------------------------------------------- Clairic

/** The three fields, written once before any answer was seen, and kept fixed. */
const FIELDS = {
	code_names: {
		type: "list",
		items: "text",
		instructions:
			"Every name of code the ticket mentions: functions, methods, types, classes, variables, constants, config keys, CLI flags and package names. Write each exactly as in the text, one per item. Not file paths and not plain English words.",
	},
	file_paths: {
		type: "list",
		items: "text",
		instructions:
			"Every file or folder path the ticket mentions, such as src/a/b.ts or packages/x/README.md, exactly as written. Not URLs and not code names.",
	},
	error_messages: {
		type: "list",
		items: "text",
		instructions:
			"Every error message, failing assertion or compiler or test output the ticket quotes, exactly as written.",
	},
} as const;
type Field = keyof typeof FIELDS;
const FIELD_NAMES = Object.keys(FIELDS) as Field[];

interface ListAnswer {
	readonly value: readonly string[] | null;
	readonly spans?: readonly (readonly number[])[];
	readonly confidence?: number;
	readonly p_null?: number;
}

interface Usage {
	readonly state_tokens?: number;
	readonly schema_tokens?: number;
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly passes?: number;
}

interface Call {
	readonly at: string;
	readonly ms: number;
	readonly ok: boolean;
	readonly status: number;
	readonly answers?: Record<Field, ListAnswer>;
	readonly truncated?: boolean;
	/** Whether the text Clairic says its spans index into is the text sent. */
	readonly stateTextSame?: boolean;
	readonly usage?: Usage;
	readonly costUsd?: number;
	readonly error?: string;
}

interface Results {
	fields: typeof FIELDS;
	calls: Record<string, Record<string, Call>>;
	scores?: unknown;
}

/**
 * One ticket names a private company. The answers as Clairic gave them stay
 * in RAW, under the ignored `runs/`; the committed copy has the word
 * replaced, and is never read back.
 */
const RAW = join(CACHE, "calls.json");
// The name itself is in no committed file, in any form. It is read from
// `private-words.txt` beside RAW, one word a line, under the ignored `runs/`.
// Without that file no results are written, so a fresh clone cannot leak it.
const PRIVATE_WORDS = join(CACHE, "private-words.txt");
const COMPANY = "[a company]";
const privateWords = (): RegExp => {
	const words = existsSync(PRIVATE_WORDS)
		? readFileSync(PRIVATE_WORDS, "utf8")
				.split("\n")
				.map((word) => word.trim())
				.filter((word) => word !== "")
		: [];
	if (words.length === 0)
		throw new Error(`${PRIVATE_WORDS} is missing or empty: no results are written without it`);
	return new RegExp(
		words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
		"gi",
	);
};
/** An item as the committed files and the labels write it. */
const shown = (text: string) => text.replace(privateWords(), COMPANY);

const load = (): Results =>
	existsSync(RAW) ? JSON.parse(readFileSync(RAW, "utf8")) : {fields: FIELDS, calls: {}};
function save(data: Results) {
	const text = `${JSON.stringify(data, null, "\t")}\n`;
	mkdirSync(CACHE, {recursive: true});
	writeFileSync(RAW, text);
	writeFileSync(RESULTS, shown(text));
}

/** Any text that may be saved or printed, with the token and the account id taken out. */
function scrub(text: string): string {
	let out = text;
	for (const secret of [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID])
		if (secret !== undefined && secret !== "") out = out.split(secret).join("[removed]");
	return out;
}

async function callClairic(state: string): Promise<Call> {
	const token = process.env.CLOUDFLARE_API_TOKEN;
	const account = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (token === undefined || account === undefined || token === "" || account === "")
		throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed for STEP=call");
	const started = performance.now();
	const at = new Date().toISOString();
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/clairic`,
		{
			method: "POST",
			headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
			body: JSON.stringify({
				model: "clairic",
				state,
				fields: FIELDS,
				options: {return_state_text: true},
			}),
		},
	);
	const raw = await response.text();
	const ms = Math.round(performance.now() - started);
	if (!response.ok) return {at, ms, ok: false, status: response.status, error: scrub(raw)};
	const body = JSON.parse(raw);
	// Workers AI wraps the model's answer in `result`; the docs show the bare answer.
	const out = body.result ?? body;
	const usage = out.usage as Usage;
	return {
		at,
		ms,
		ok: true,
		status: response.status,
		answers: out.answers,
		truncated: out.truncated,
		stateTextSame: out.state_text === undefined ? undefined : out.state_text === state,
		usage,
		costUsd: usage.input_tokens * PRICE_PER_TOKEN,
	};
}

async function call(only: readonly number[], run: number) {
	const results = load();
	results.fields = FIELDS;
	const schemaChars = JSON.stringify(FIELDS).length;
	if (process.env.DRY === "1") {
		let tokens = 0;
		for (const n of only) {
			// About 4 characters a token, plus a guess at the model's own framing.
			const t = Math.ceil((textOf(replayOf(n)).length + schemaChars) / 4) + 300;
			tokens += t;
			console.log(`#${n}: about ${t} input tokens`);
		}
		console.log(
			`run ${run}: about ${tokens} tokens, $${(tokens * PRICE_PER_TOKEN).toFixed(5)}; three runs $${(3 * tokens * PRICE_PER_TOKEN).toFixed(5)}`,
		);
		return;
	}
	for (const n of only) {
		const kept = results.calls[n] ?? {};
		results.calls[n] = kept;
		if (kept[run]?.ok === true) {
			console.log(`#${n} run ${run}: kept already`);
			continue;
		}
		const c = await callClairic(textOf(replayOf(n)));
		kept[run] = c;
		save(results);
		console.log(
			c.ok
				? `#${n} run ${run}: ${c.usage?.input_tokens} in, ${c.usage?.output_tokens} out, ${c.usage?.passes} passes, $${c.costUsd?.toFixed(6)}, ${c.ms} ms`
				: `#${n} run ${run}: failed, ${c.status}: ${c.error?.slice(0, 300)}`,
		);
	}
}

// ---------------------------------------------------------------- the code at the base commit

function git(dir: string, ...args: string[]): string {
	return execFileSync("git", ["-C", dir, ...args], {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	});
}

/** A scratch checkout at `sha`, shared with the local clone, read-only to it. */
function checkoutAt(sha: string): string {
	const dir = join(CACHE, "clones", sha);
	if (!existsSync(join(dir, ".git"))) {
		mkdirSync(join(CACHE, "clones"), {recursive: true});
		execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", DEMLIK, dir]);
		git(dir, "checkout", "-q", "--detach", sha);
	}
	return dir;
}

/** Every published package under `packages/`, as 86b reads them: manifest, README, docs folder. */
function publishedAt(files: readonly string[], dir: string): Published[] {
	const read = (f: string) => readFileSync(join(dir, f), "utf8");
	return files
		.filter((f) => /^packages\/[^/]+\/package\.json$/.test(f))
		.map((manifest) => {
			const root = manifest.slice(0, -"package.json".length);
			const docs = files.filter(
				(f) => f === `${root}README.md` || (f.startsWith(`${root}docs/`) && f.endsWith(".md")),
			);
			return {manifest: JSON.parse(read(manifest)), docs: docs.map(read)};
		});
}

interface Base {
	readonly dir: string;
	readonly files: ReadonlySet<string>;
	readonly fileList: readonly string[];
	/** The names a user of the published packages meets (86b's `names`). */
	readonly user: ReadonlySet<string>;
}

function baseOf(sha: string): Base {
	const dir = checkoutAt(sha);
	const fileList = git(dir, "ls-files")
		.split("\n")
		.filter((f) => f !== "");
	return {
		dir,
		files: new Set(fileList),
		fileList,
		user: new Set(userNames(publishedAt(fileList, dir))),
	};
}

const bareOf = (path: string) => path.replace(/:\d+(?:[-:]\d+)*$/, "").replace(/^\.\//, "");

/** The files at the base a path names: itself, or every file it is the tail of. A folder names none. */
function filesOfPath(base: Base, path: string): readonly string[] {
	const bare = bareOf(path);
	if (bare === "" || bare.endsWith("/")) return [];
	if (base.files.has(bare)) return [bare];
	return base.fileList.filter((f) => f.endsWith(`/${bare}`));
}

/** Whether a path is a folder at the base, written with or without its last slash. */
function isFolder(base: Base, path: string): boolean {
	const bare = bareOf(path).replace(/\/$/, "");
	if (bare === "" || !bare.includes("/")) return false;
	return base.fileList.some((f) => f.startsWith(`${bare}/`) || f.includes(`/${bare}/`));
}

// ---------------------------------------------------------------- the truths

/** File paths a pointer's `at` holds, as it writes them, line numbers dropped. */
const pathsIn = (text: string): string[] =>
	[
		...text.matchAll(
			/(?:^|[\s`(,])((?:\.?[\w@-]+\/)+[\w@.-]*\.[a-z]+|(?:\.?[\w@-]+\/)+)(?=$|[\s`):,;])/g,
		),
	].map((m) => (m[1] ?? "").replace(/:\d+.*$/, ""));

interface Truth {
	/** Files the plan's pointers cite that exist at the base. */
	readonly plan: readonly string[];
	/** What the pointers cite that is no file at the base: a folder, or a package outside the repo. */
	readonly planDropped: readonly string[];
	/** Files the fix PR changed that exist at the base. */
	readonly pr: readonly string[];
	/** Files the fix PR added: no ticket could name them. */
	readonly prNew: readonly string[];
}

function truthOf(n: number, base: Base): Truth {
	const plans = JSON.parse(readFileSync(PLANS, "utf8"));
	const pointers: {at: string}[] = plans[n]?.plan?.pointers ?? [];
	const cited = [...new Set(pointers.flatMap((p) => pathsIn(p.at)))];
	const changed = replayOf(n).filesChanged.map((f) => f.path);
	return {
		plan: cited.filter((p) => base.files.has(p)),
		planDropped: cited.filter((p) => !base.files.has(p)),
		pr: changed.filter((p) => base.files.has(p)),
		prNew: changed.filter((p) => !base.files.has(p)),
	};
}

// ---------------------------------------------------------------- the hand labels

/**
 * Each item either arm gave, labelled by hand against the ticket's text after
 * the runs: `code` when the ticket writes it as code (a name, a path, a flag,
 * a command, a package, a test's name, a quoted output), `prose` when it is
 * an everyday word or phrase, `cut` when it is a piece cut out of something
 * longer that names nothing as written. One reader; see the write-up.
 */
type Label = "code" | "prose" | "cut";
const LABELS: Record<number, Record<string, Label>> = {
	367: {
		"packages/tea/src/otel/otel.test.ts": "code",
		"pnpm test": "code",
		"pnpm typecheck": "code",
		"pnpm typecheck:test": "code",
		"pnpm lint": "code",
		"origin/main": "code",
		otel: "prose",
		full: "prose",
		"tea package": "prose",
		"OpenTelemetry suite": "prose",
		main: "prose",
		open: "prose",
		builder: "prose",
		feat: "prose",
		OpenTelemetry: "prose",
		span: "prose",
		tea: "prose",
		packages: "cut",
		"times each span by the transitions that opened and closed it": "code",
	},
	393: {
		lib: "code",
		"src/access-gates/rules/x.ts": "code",
		"src/ratchet/scope-count.ts": "code",
		"code-graph": "code",
		"--": "cut",
		boundaries: "prose",
		"@demlik/code-graph": "code",
		"--boundaries": "code",
		"[a company]-rooted": "prose",
		"monorepo-55": "prose",
		"[a company]": "prose",
		"#6194": "prose",
		"access-gates": "code",
		"--ci": "code",
		"packages/code-graph/src/boundaries": "code",
		"--collapse": "code",
		"[a company] #619": "cut",
		Bin: "cut",
	},
	490: {
		SplitCandidate: "code",
		cohesion: "code",
		precision: "code",
		scoreCoChange: "code",
		predictedPairs: "code",
		active: "code",
		maxFiles: "code",
		"packages/structure-sweep/src/": "code",
		"packages/structure-sweep/src/propose/refine.ts": "code",
		"packages/structure-sweep/src/score/score.ts": "code",
		"packages/structure-sweep/README.md": "code",
		"doc comment": "prose",
		"refine cohesion": "prose",
		doc: "prose",
		"structure-sweep": "code",
		"propose refine": "code",
		README: "prose",
		"README-only": "prose",
		packages: "cut",
		"export interface": "cut",
		scoreCo: "cut",
	},
	504: {
		compile: "code",
		compileMatchers: "code",
		services: "code",
		"billing-business-rule.ts": "code",
		"billing-plumbing.ts": "code",
		"layers/classify.ts": "code",
		"packages/code-graph/src/layers/classify.ts": "code",
		"packages/code-graph/src/layers/layers.test.ts": "code",
		"/": "cut",
		Layer: "prose",
		"--layers": "code",
		"billing-business-rule": "cut",
		"billing-plumbing": "cut",
		"business rules": "prose",
		"ast-grep rule": "prose",
		per: "prose",
		consumer: "prose",
		"<domain>-api-surface": "code",
		"<domain>": "cut",
		layers: "code",
		name: "prose",
		plumbing: "code",
		"api-surface": "code",
		"business-rule": "code",
		"code-graph .": "cut",
		"--layers --layer-rules": "code",
		"compile()": "code",
		regex: "prose",
		"Rails'": "prose",
		"*_controller.rb": "code",
		"Angular's": "prose",
		"NestJS's": "prose",
		"packages/code-graph": "code",
		"compileMatchers()": "code",
		README: "prose",
		Decl: "cut",
		"--layer-rules": "code",
		Patterns: "prose",
		"<": "cut",
		"apps/web": "cut",
		"0 down,": "cut",
		zero: "prose",
		"[^/]*": "code",
	},
	565: {
		readAllowance: "code",
		decidedBy: "code",
		write: "code",
		"adapters/driving/": "code",
		"index.ts": "code",
		"packages/code-graph/README.md": "code",
		"code-graph": "code",
		read: "prose",
		B8: "code",
		driving: "prose",
		"read exception": "prose",
		hexagonal: "prose",
		"read-only": "prose",
		"decidedBy:": "cut",
		'contract"]': "cut",
		"adapters/driving": "code",
		"contract package": "prose",
		zod: "code",
		RPC: "prose",
		"Cockburn's": "prose",
		"CQRS's": "prose",
		"Read allowance": "prose",
		ORM: "prose",
		"packages/code-graph/src/boundaries/": "code",
		dec: "cut",
		exit: "cut",
	},
	579: {
		Scope: "code",
		Exit: "code",
		main: "code",
		stop: "code",
		"packages/tea/docs/how-to/run-many-machines.md": "code",
		"packages/tea/examples/parent-and-workers-effect.ts": "code",
		"run-many-machines": "code",
		tea: "prose",
		how: "cut",
		"Scope.make()": "code",
		"Scope.close": "code",
		"Exit.void": "code",
		Effect: "code",
		effect: "code",
		"Scope.make": "code",
		"packages/tea/docs/how": "cut",
	},
};

/**
 * The quoted outputs each ticket holds, by hand: what a perfect
 * `error_messages` list would give. 490 and 579 quote none ("gets compile
 * errors" names no message).
 */
const QUOTED: Record<number, readonly string[]> = {
	367: ["times each span by the transitions that opened and closed it"],
	393: [],
	490: [],
	504: ["0 down, 0 sideways, 0 UP, 10373 unlayered"],
	565: ["exit 2"],
	579: [],
};

// ---------------------------------------------------------------- the arms

/** An item as an arm hands it on, as a string. */
interface Item {
	readonly text: string;
	readonly kind: "name" | "path" | "error";
}

/** Backticks around an item are the ticket's, not part of the name. */
const clean = (s: string) =>
	s
		.trim()
		.replace(/^`+|`+$/g, "")
		.trim();

/** One item a string: `pnpm test` and `pnpm test\`` are one, and so is a name given in both lists. */
function uniqueItems(items: readonly Item[]): Item[] {
	const seen = new Map<string, Item>();
	for (const item of items) {
		const key = `${item.kind === "error" ? "error" : "code"}\n${item.text}`;
		if (!seen.has(key)) seen.set(key, item);
	}
	return [...seen.values()];
}

/**
 * What a Clairic list item becomes as a mention: the rules `mentionsOf` uses
 * on a backticked span, so `compile()` is the name `compile`. An item those
 * rules drop is kept as a folder when it is slash-separated words: a folder
 * written without its last slash.
 */
function asMentions(items: readonly Item[]): Mentions {
	const names: string[] = [];
	const paths: string[] = [];
	for (const item of items) {
		if (item.kind === "error") continue;
		const m = mentionsOf(`\`${item.text}\``);
		names.push(...m.names);
		paths.push(...m.paths);
		if (m.names.length + m.paths.length === 0 && /^[\w@.-]+(?:\/[\w@.-]+)+$/.test(item.text))
			paths.push(`${item.text}/`);
	}
	return {names: [...new Set(names)], paths: [...new Set(paths)], refs: []};
}

const itemsOfMentions = (m: Mentions): Item[] => [
	...m.names.map((text) => ({text, kind: "name" as const})),
	...m.paths.map((text) => ({text, kind: "path" as const})),
];

function itemsOfCall(c: Call): Item[] {
	const kindOf: Record<Field, Item["kind"]> = {
		code_names: "name",
		file_paths: "path",
		error_messages: "error",
	};
	return uniqueItems(
		FIELD_NAMES.flatMap((field) =>
			(c.answers?.[field]?.value ?? []).map((text) => ({text: clean(text), kind: kindOf[field]})),
		),
	);
}

async function packOf(base: Base, mentions: Mentions): Promise<FactsPack> {
	return Effect.runPromise(
		Effect.gen(function* () {
			return yield* (yield* Facts).gather(mentions);
		}).pipe(Effect.provide(localFacts(base.dir, {codeGraph: false}))),
	);
}

/**
 * The files an arm hands the planner: every file at the base its brief names,
 * and every file a path it found is, or is the tail of. A folder adds no file.
 */
async function handOf(base: Base, mentions: Mentions) {
	const pack = await packOf(base, mentions);
	const brief = factsBrief(pack);
	const named = [...brief.matchAll(/[\w@.$/-]+/g)].map((m) => m[0].replace(/:\d+$/, ""));
	const files = new Set([
		...named.filter((p) => base.files.has(p)),
		...mentions.paths.flatMap((p) => filesOfPath(base, p)),
	]);
	return {pack, brief, files};
}

type Real = "declared" | "user name" | "path" | "folder" | "word only" | "not at base";
const REAL: readonly Real[] = ["declared", "user name", "path", "folder"];

/** Whether an item is a real name or path at the base, by the pack and the published names. */
function realOf(base: Base, pack: FactsPack, item: Item): Real {
	if (filesOfPath(base, item.text).length > 0) return "path";
	if (isFolder(base, item.text)) return "folder";
	const heads = mentionsOf(`\`${item.text}\``).names;
	const facts = pack.names.filter((f) => heads.includes(f.name));
	if (facts.some((f) => f.definitions.length > 0 || f.more > 0)) return "declared";
	if (base.user.has(item.text) || heads.some((h) => base.user.has(h))) return "user name";
	if (facts.some((f) => f.mentionedIn > 0)) return "word only";
	return "not at base";
}

/**
 * Whether a Clairic list's spans point at exactly its items in the text sent.
 * A list folds repeats into one value but keeps a span for each place, so
 * spans and values do not line up by index: each value needs some span that
 * is it, and each span must be some value.
 */
function spansHold(state: string, answer: ListAnswer | undefined) {
	const value = answer?.value ?? [];
	const pieces = (answer?.spans ?? []).map(([from, to]) => state.slice(from, to));
	return {
		values: value.length,
		held: value.filter((v) => pieces.includes(v)).length,
		spans: pieces.length,
		spansExact: pieces.filter((p) => value.includes(p)).length,
	};
}

const share = (hit: number, all: number) => (all === 0 ? null : hit / all);

/** Spearman's rank correlation, ties given their mean rank. */
function spearman(a: readonly number[], b: readonly number[]): number {
	const ranks = (xs: readonly number[]) => {
		const order = xs.map((x, i) => ({x, i})).sort((p, q) => p.x - q.x);
		const out = new Array<number>(xs.length);
		for (let k = 0; k < order.length; ) {
			let j = k;
			while (j + 1 < order.length && order[j + 1]?.x === order[k]?.x) j++;
			for (let m = k; m <= j; m++) out[order[m]?.i ?? 0] = (k + j) / 2;
			k = j + 1;
		}
		return out;
	};
	const ra = ranks(a);
	const rb = ranks(b);
	const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
	const ma = mean(ra);
	const mb = mean(rb);
	let num = 0;
	let da = 0;
	let db = 0;
	ra.forEach((x, i) => {
		const y = rb[i] ?? 0;
		num += (x - ma) * (y - mb);
		da += (x - ma) ** 2;
		db += (y - mb) ** 2;
	});
	return num / Math.sqrt(da * db);
}
const pct = (x: number | null) => (x === null ? "-" : `${Math.round(100 * x)}%`);

interface Scored {
	readonly text: string;
	readonly kind: Item["kind"];
	readonly label: Label | "unlabelled";
	readonly real: Real;
	readonly inText: boolean;
}

interface ArmScore {
	readonly folders: readonly {readonly dir: string; readonly files: number}[];
	/** Truth files not handed on as files, but under a folder the arm named. */
	readonly planUnderFolder: readonly string[];
	readonly prUnderFolder: readonly string[];
	readonly items: readonly Scored[];
	readonly code: number;
	readonly real: number;
	readonly notInText: number;
	readonly briefChars: number;
	readonly files: readonly string[];
	readonly planHit: readonly string[];
	readonly prHit: readonly string[];
	/** For each truth file it reached, the items that reach it alone. */
	readonly reachedBy: Record<string, readonly string[]>;
}

async function scoreArm(
	n: number,
	base: Base,
	state: string,
	truth: Truth,
	items: readonly Item[],
	mentions: Mentions,
): Promise<ArmScore> {
	const {pack, brief, files} = await handOf(base, mentions);
	const scored: Scored[] = items
		.filter((i) => i.kind !== "error")
		.map((i) => ({
			...i,
			label: LABELS[n]?.[shown(i.text)] ?? "unlabelled",
			real: realOf(base, pack, i),
			inText: state.includes(i.text),
		}));
	const hits = [...new Set([...truth.plan, ...truth.pr])].filter((f) => files.has(f));
	const reachedBy: Record<string, string[]> = {};
	for (const item of scored) {
		const alone = await handOf(base, asMentions([item]));
		for (const f of hits)
			if (alone.files.has(f)) reachedBy[f] = [...(reachedBy[f] ?? []), item.text];
	}
	// A folder is a weaker pointer: the truth files under a folder it named, and how big each folder is.
	const folders = scored
		.filter((i) => i.real === "folder")
		.map((i) => bareOf(i.text).replace(/\/$/, ""))
		.map((dir) => ({dir, files: base.fileList.filter((f) => f.startsWith(`${dir}/`)).length}));
	const under = (f: string) => folders.some((d) => f.startsWith(`${d.dir}/`));
	return {
		folders,
		planUnderFolder: truth.plan.filter((f) => !files.has(f) && under(f)),
		prUnderFolder: truth.pr.filter((f) => !files.has(f) && under(f)),
		items: scored,
		code: scored.filter((i) => i.label === "code").length,
		real: scored.filter((i) => REAL.includes(i.real)).length,
		notInText: scored.filter((i) => !i.inText).length,
		briefChars: brief.length,
		files: [...files],
		planHit: truth.plan.filter((f) => files.has(f)),
		prHit: truth.pr.filter((f) => files.has(f)),
		reachedBy,
	};
}

interface Totals {
	plan: number;
	pr: number;
	code: number;
	real: number;
	items: number;
	notIn: number;
	files: number;
	planFolder: number;
	prFolder: number;
}
const zero = (): Totals => ({
	plan: 0,
	pr: 0,
	code: 0,
	real: 0,
	items: 0,
	notIn: 0,
	files: 0,
	planFolder: 0,
	prFolder: 0,
});

async function score() {
	const results = load();
	const out: Record<string, unknown> = {};
	const rows: string[] = [];
	const totals = {A: zero(), B: zero(), C: zero()};
	let planAll = 0;
	let prAll = 0;
	const lists: {
		n: number;
		field: Field;
		confidence: number;
		items: number;
		code: number | null;
	}[] = [];
	const errors: {n: number; quoted: readonly string[]; got: readonly string[]}[] = [];
	const unlabelled: string[] = [];
	for (const n of TICKETS) {
		const r = replayOf(n);
		const state = textOf(r);
		const base = baseOf(r.pr.baseSha);
		const truth = truthOf(n, base);
		const mentionsA = mentionsOf(state);
		const itemsA = itemsOfMentions(mentionsA);
		const A = await scoreArm(n, base, state, truth, itemsA, mentionsA);
		const calls = Object.entries(results.calls[n] ?? {})
			.filter(([, c]) => c.ok)
			.sort(([a], [b]) => Number(a) - Number(b));
		// Every run of a ticket gave the same answer, checked here; the first is scored.
		const same = calls.every(
			([, c]) => JSON.stringify(c.answers) === JSON.stringify(calls[0]?.[1].answers),
		);
		const first = calls[0]?.[1];
		if (first === undefined) continue;
		const itemsB = itemsOfCall(first);
		const mentionsB = asMentions(itemsB);
		const B = await scoreArm(n, base, state, truth, itemsB, mentionsB);
		const mentionsC: Mentions = {
			names: [...new Set([...mentionsA.names, ...mentionsB.names])],
			paths: [...new Set([...mentionsA.paths, ...mentionsB.paths])],
			refs: mentionsA.refs,
		};
		const C = await scoreArm(n, base, state, truth, uniqueItems([...itemsA, ...itemsB]), mentionsC);
		for (const s of [A, B])
			for (const i of s.items) if (i.label === "unlabelled") unlabelled.push(`${n}: ${i.text}`);
		for (const f of FIELD_NAMES) {
			const a = first.answers?.[f];
			if (a?.confidence === undefined) continue;
			const values = (a.value ?? []).map(clean);
			const labelled = values.map((v) => LABELS[n]?.[shown(v)]);
			lists.push({
				n,
				field: f,
				confidence: a.confidence,
				items: values.length,
				code: f === "error_messages" ? null : labelled.filter((l) => l === "code").length,
			});
		}
		errors.push({
			n,
			quoted: QUOTED[n] ?? [],
			got: (first.answers?.error_messages?.value ?? []).map(clean),
		});
		out[n] = {
			truth,
			runs: calls.length,
			sameEveryRun: same,
			spans: Object.fromEntries(FIELD_NAMES.map((f) => [f, spansHold(state, first.answers?.[f])])),
			stateTextSame: first.stateTextSame,
			A,
			B,
			C,
		};
		planAll += truth.plan.length;
		prAll += truth.pr.length;
		for (const [arm, s] of [
			["A", A],
			["B", B],
			["C", C],
		] as const) {
			const t = totals[arm];
			t.plan += s.planHit.length;
			t.pr += s.prHit.length;
			t.code += s.code;
			t.real += s.real;
			t.items += s.items.length;
			t.notIn += s.notInText;
			t.files += s.files.length;
			t.planFolder += s.planUnderFolder.length;
			t.prFolder += s.prUnderFolder.length;
		}
		const cell = (s: ArmScore) =>
			`${s.planHit.length}/${truth.plan.length}, ${s.prHit.length}/${truth.pr.length}, ${s.code}/${s.items.length} code, ${s.files.length} files`;
		rows.push(`| ${n} | ${cell(A)} | ${cell(B)} | ${cell(C)} |`);
	}
	const all = Object.values(results.calls).flatMap((runs) =>
		Object.values(runs).filter((c) => c.ok),
	);
	const cost = all.reduce((s, c) => s + (c.costUsd ?? 0), 0);
	const ms = all.map((c) => c.ms).sort((a, b) => a - b);
	const spend = {
		calls: all.length,
		costUsd: cost,
		inputTokens: all.reduce((s, c) => s + (c.usage?.input_tokens ?? 0), 0),
		medianMs: ms[Math.floor(ms.length / 2)] ?? null,
		slowestMs: ms.at(-1) ?? null,
	};
	// Clairic gives one confidence a list. Does it follow the list's code share, or its length?
	const scoredLists = lists.filter((l) => l.code !== null && l.items > 0);
	const logConfidence = scoredLists.map((l) => Math.log10(l.confidence));
	const confidenceRank = {
		lists: scoredLists.length,
		withCodeShare: spearman(
			logConfidence,
			scoredLists.map((l) => (l.code ?? 0) / l.items),
		),
		withLength: spearman(
			logConfidence,
			scoredLists.map((l) => l.items),
		),
	};
	// What arm A's extraction costs in time: `mentionsOf` on every ticket, a thousand times.
	const texts = TICKETS.map((n) => textOf(replayOf(n)));
	const started = performance.now();
	for (let i = 0; i < 1000; i++) for (const t of texts) mentionsOf(t);
	const mentionsOfMs = (performance.now() - started) / (1000 * texts.length);
	results.scores = {
		perTicket: out,
		totals,
		planAll,
		prAll,
		lists,
		confidenceRank,
		errors,
		spend,
		mentionsOfMs,
	};
	save(results);
	console.log("| # | A: plan files, PR files, code items, files handed | B | C |");
	console.log("|---|---|---|---|");
	for (const row of rows) console.log(row);
	console.log(`\nall six, plan files ${planAll}, PR files ${prAll}:`);
	for (const [arm, t] of Object.entries(totals))
		console.log(
			`  ${arm}: plan recall ${pct(share(t.plan, planAll))}, PR recall ${pct(share(t.pr, prAll))}, code by hand ${pct(share(t.code, t.items))} (${t.code}/${t.items}), real at base ${pct(share(t.real, t.items))}, not in the text ${t.notIn}, files handed ${t.files}; under a named folder, plan +${t.planFolder}, PR +${t.prFolder}`,
		);
	console.log("\nlist confidence against the list's code share (Clairic gives one per list):");
	for (const l of lists)
		console.log(
			`  ${l.n} ${l.field}: confidence ${l.confidence.toExponential(1)}, ${l.items} items, code ${l.code ?? "-"}`,
		);
	console.log("\nquoted outputs, by hand, against Clairic's error_messages:");
	for (const e of errors)
		console.log(`  ${e.n}: ${JSON.stringify(e.quoted)} / ${JSON.stringify(e.got)}`);
	console.log(
		`\nrank correlation of log confidence, over ${confidenceRank.lists} name and path lists: with code share ${confidenceRank.withCodeShare.toFixed(2)}, with length ${confidenceRank.withLength.toFixed(2)}`,
	);
	console.log(`mentionsOf: ${mentionsOfMs.toFixed(3)} ms a ticket`);
	if (unlabelled.length > 0) console.log(`\nunlabelled: ${unlabelled.join("; ")}`);
	console.log(
		`\n${spend.calls} calls, ${spend.inputTokens} input tokens, $${cost.toFixed(5)}, median ${spend.medianMs} ms, slowest ${spend.slowestMs} ms`,
	);
}

const only = (process.env.ONLY ?? TICKETS.join(",")).split(",").map((s) => Number(s.trim()));
if (STEP === "call") await call(only, Number(process.env.RUN ?? "1"));
else await score();
