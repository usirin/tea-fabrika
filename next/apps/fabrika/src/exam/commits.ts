// The commit check for `next/` (Tier 1, P32; docs/direction/a-unit-of-work-is-a-commit.md, experiment
// 221). Each step that commits signs a link, its step, ticket, version and the trees before and after,
// with its own role's key, into a git note on `refs/notes/fabrika`. CI decides from the signature, never
// from the author, the message or a trailer. The laws are p83 to p87 and p89 in
// docs/plan/tier-1-detail.md.
//
//   pnpm commits check --base <rev> --head <rev> [--main <sha>] [--keys-from head] [--fetch --pr <n>]
//   pnpm commits chain (--squash <sha> | --base <rev> --head <rev> [--main <sha>] [--fetch] | --advise)
//   pnpm commits sign --step <role> --ticket <n> --key <path>
//   pnpm commits push
//
// `allowed_signers` and `exam-paths.json` are always read from main as CI checked it out (`--main`,
// else the base), never from the change under test. After a merge, a logged link's keys commit counts
// only when it was on main before its squash. `--keys-from head` reads both from the head instead: only for the pull request that adds them,
// run once by hand, and never passed by the workflow. A pure core over plain data (`signedText`,
// `check`, `chain`), and a thin edge that runs `git` and `ssh-keygen`, the reference verifier. It
// imports no product code, so a builder cannot weaken it by changing one (p84). Exit 1 on any `stuck`,
// 0 on `done` and `ask`, 2 when the run fails: a keys file p87 refuses, or something it could not read.
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {Config, Console, Effect, Exit, FileSystem, Option, Path, Schema, Stream} from "effect";
import {ChildProcess} from "effect/process";

export const ROLES = ["tests", "build", "lead"] as const;
export const Role = Schema.Literals(ROLES);
export type Role = typeof Role.Type;
const NAMESPACE = "fabrika-step";

const Sha = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/));
const Ticket = Schema.String.check(Schema.isPattern(/^[0-9]+$/));
const Version = Schema.Int.check(Schema.isGreaterThan(0));
const linkFields = {step: Role, ticket: Ticket, version: Version, from: Sha, to: Sha};

/** A note on `refs/notes/fabrika`: the link a step signed, its key's fingerprint and its signature. */
export const Note = Schema.TaggedStruct("attested", {
	...linkFields,
	key: Schema.String,
	sig: Schema.String,
});
export type Note = typeof Note.Type;

/** The same link as a `field/runs.jsonl` row holds it, with what a later reader needs to walk it. */
const Link = Schema.TaggedStruct("attested", {
	...Note.fields,
	by: Schema.String,
	arrivedAt: Schema.String,
	parent: Schema.NullOr(Schema.String),
	traceId: Schema.String,
	commit: Sha,
	pr: Schema.String,
	base: Sha,
	squash: Sha,
	keys: Sha,
});
type Link = typeof Link.Type;

const PersonLink = Schema.TaggedStruct("attested", {
	...Link.fields,
	step: Schema.Literal("person"),
});
type PersonLink = typeof PersonLink.Type;
const ChainLink = Schema.Union([Link, PersonLink]);
type ChainLink = typeof ChainLink.Type;

const Reason = Schema.Literals([
	"unsigned_commit",
	"build_touched_exam",
	"broken_chain",
	"stale_link",
]);
type Reason = typeof Reason.Type;

export const Answer = Schema.TaggedUnion({
	done: {},
	ask: {
		who: Schema.Literal("owner"),
		for: Schema.Literal("exam_read"),
		paths: Schema.Array(Schema.String),
	},
	stuck: {
		reason: Reason,
		sha: Schema.String,
		paths: Schema.optional(Schema.Array(Schema.String)),
		step: Schema.optional(Role),
	},
});
export type Answer = typeof Answer.Type;

const done = Answer.cases.done.make({});
const stuck = (reason: Reason, sha: string, more: {paths?: string[]; step?: Role} = {}) =>
	Answer.cases.stuck.make({reason, sha, ...more});

/** What the key signs, v2: the link and nothing about the commit, so a copied note can be replayed. */
export const signedText = (link: {
	readonly step: Role;
	readonly ticket: string;
	readonly version: number;
	readonly from: string;
	readonly to: string;
}) =>
	[
		"fabrika-step attested v2",
		`step ${link.step}`,
		`ticket ${link.ticket}`,
		`version ${link.version}`,
		`from ${link.from}`,
		`to ${link.to}`,
		"",
	].join("\n");

export const decodeNote = Schema.decodeUnknownOption(Schema.fromJsonString(Note));
export const decodeLink = Schema.decodeUnknownOption(ChainLink, {onExcessProperty: "error"});

const KEY_LINE =
	/^(\S+) namespaces="(fabrika-step|git)" ssh-ed25519 (AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43})$/;

/**
 * p87 and p87b: each step at least once in `fabrika-step`, and distinct literal `person:<id>`
 * principals in `git`. Ed25519 only, no key twice and no other option. No file is refused.
 */
export const keysProblem = (text: string | null): string | null => {
	if (text === null) return "no allowed_signers on the base";
	const roles = new Set<string>();
	const keys = new Set<string>();
	for (const line of text.replace(/\n$/, "").split("\n")) {
		const m = KEY_LINE.exec(line);
		if (m === null) return `refused line ${JSON.stringify(line)}`;
		const [, role = "", namespace = "", key = ""] = m;
		const step = (ROLES as ReadonlyArray<string>).includes(role);
		const person = /^person:[A-Za-z0-9._:-]+$/.test(role);
		if (!step && !person) return `unknown role ${JSON.stringify(role)}`;
		if (namespace !== (step ? NAMESPACE : "git"))
			return `wrong namespace for ${JSON.stringify(role)}`;
		if (person && roles.has(role)) return `principal named twice: ${JSON.stringify(role)}`;
		if (keys.has(key)) return `a key named twice, the second under ${role}`;
		keys.add(key);
		roles.add(role);
	}
	const missing = ROLES.filter((r) => !roles.has(r));
	return missing.length === 0 ? null : `no key for ${missing.join(", ")}`;
};

/** One row of `exam-paths.json`: a glob and why it is the exam's. */
const ExamList = Schema.Array(
	// The trusted root config keeps today's spelling; next/'s decoded rows use reason.
	Schema.Struct({glob: Schema.String.check(Schema.isNonEmpty()), reason: Schema.String}).pipe(
		Schema.encodeKeys({reason: "why"}),
	),
);
type ExamList = typeof ExamList.Type;
export const decodeExam = Schema.decodeUnknownOption(Schema.fromJsonString(ExamList));

/** A glob as the list writes it: `**` crosses folders, `*` stays inside one, dots match like letters. */
const globRegex = (glob: string) =>
	new RegExp(
		`^${glob
			.split(/(\*\*\/|\/\*\*$|\*\*|\*)/)
			.map((part) => {
				if (part === "**/") return "(?:.*/)?";
				if (part === "/**") return "(?:/.*)?";
				if (part === "**") return ".*";
				if (part === "*") return "[^/]*";
				return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
			})
			.join("")}$`,
		"s",
	);

/** p85: an exam path is on the list, or holds a control character, which never passes quietly. */
export const examMatcher = (list: ExamList) => {
	const res = list.map((row) => globRegex(row.glob));
	const control = (path: string) =>
		[...path].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
	return (path: string) => control(path) || res.some((re) => re.test(path));
};

/** The scope rule: only a change under `next/` or on the exam list is judged. */
export const inScope = (changed: ReadonlyArray<string>, isExam: (path: string) => boolean) =>
	changed.some((p) => p.startsWith("next/") || isExam(p));

/** A note as CI saw it: decoded, and the role whose key verified its text, or null. */
interface Signed {
	readonly note: Note;
	readonly signer: Role | null;
}

/** One commit of the pull request, as git and ssh-keygen gave it. */
export interface Commit {
	readonly sha: string;
	readonly tree: string;
	readonly parentTree: string | null;
	/** Changed against its first parent: added, changed and deleted, and both sides of a rename. */
	readonly paths: ReadonlyArray<string>;
	readonly signed: Signed | null;
	/** Present only when git verified an SSH commit signature against the base's person keys. */
	readonly person?: true | undefined;
}

export interface PullRequest {
	readonly head: string;
	readonly containsBase: boolean;
	/** The pull request's own change, `base...head`. */
	readonly changed: ReadonlyArray<string>;
	/** `base..head`, oldest first, merges included. */
	readonly commits: ReadonlyArray<Commit>;
	/** Every note on `refs/notes/fabrika`, the pull request's and any other. */
	readonly notes: ReadonlyArray<Signed>;
}

const verified = (s: Signed | null): s is Signed => s !== null && s.signer === s.note.step;

/**
 * p89: the steps whose newest verified link for the ticket is not where it must be. `used` is the
 * chain's links in order. A tie at the top version counts neither, and an older link of the step
 * must come before its newest.
 */
export const staleSteps = (
	ticket: string,
	all: ReadonlyArray<Signed>,
	used: ReadonlyArray<Note>,
): ReadonlySet<Role> => {
	const stale = new Set<Role>();
	for (const role of ROLES) {
		const mine = all.filter((s) => verified(s) && s.note.step === role && s.note.ticket === ticket);
		if (mine.length === 0) continue;
		const top = Math.max(...mine.map((s) => s.note.version));
		const newest = new Set(
			mine.filter((s) => s.note.version === top).map((s) => signedText(s.note)),
		);
		const chain = used.filter((n) => n.step === role).map(signedText);
		const [only] = newest;
		const at = only === undefined ? -1 : chain.indexOf(only);
		if (newest.size !== 1 || at < 0 || at !== chain.length - 1) stale.add(role);
	}
	return stale;
};

/** p83 to p86 and p89 at pull request time. The scope rule is the caller's, before it gathers. */
export const check = (pr: PullRequest, isExam: (path: string) => boolean) => {
	const fits = (c: Commit) =>
		verified(c.signed) && c.signed.note.from === c.parentTree && c.signed.note.to === c.tree;
	const ticket = pr.commits.find(fits)?.signed?.note.ticket ?? null;
	const role = (c: Commit) =>
		fits(c) && c.signed?.note.ticket === ticket ? c.signed.note.step : null;
	const used = pr.commits.flatMap((c) =>
		role(c) === null || c.signed === null ? [] : [c.signed.note],
	);
	const stale = ticket === null ? new Set<Role>() : staleSteps(ticket, pr.notes, used);
	const answers: Answer[] = [];
	for (const c of pr.commits) {
		const step = role(c);
		const touched = step === "build" ? c.paths.filter(isExam).sort() : [];
		if (step === null && !(c.signed === null && c.person === true))
			answers.push(stuck("unsigned_commit", c.sha));
		else if (touched.length > 0) answers.push(stuck("build_touched_exam", c.sha, {paths: touched}));
		else if (step !== null && stale.has(step)) answers.push(stuck("stale_link", c.sha, {step}));
	}
	for (const step of stale) {
		if (!pr.commits.some((c) => role(c) === step))
			answers.push(stuck("stale_link", pr.head, {step}));
	}
	if (!pr.containsBase) answers.push(stuck("broken_chain", pr.head));
	const exam = [...new Set(pr.changed.filter(isExam))].sort();
	if (exam.length > 0)
		answers.push(Answer.cases.ask.make({who: "owner", for: "exam_read", paths: exam}));
	return {ticket, answers: answers.length === 0 ? [done] : answers};
};

/** A logged link, and its signer verified against the keys at its `keys` commit. */
export interface Logged<L extends ChainLink = Link> {
	readonly link: L;
	readonly signer: L["step"] | null;
}

/** What git says about one squash: whether it is on main, and which commits came before it there. */
interface Placed {
	/** The squash is on the checked-out main. */
	readonly onMain: boolean;
	/** Commits on main before the squash (ancestors of its first parent), among the links' bases. */
	readonly before: ReadonlySet<string>;
}

/**
 * p86 and p89 after the merge: the links logged for one squash run from its base's tree to its
 * tree. `trees` maps a commit to its tree, for the squash and the first link's base. The squash must
 * be on main, and every link's base on main before it: a base off main could start the chain
 * anywhere. A link's `base` is main when its step started, so after a `lead` merge of a moved main
 * it is older than the squash's first parent, and an ancestor is what is asked, not that parent.
 */
export const chain = (
	squash: string,
	rows: ReadonlyArray<Logged<ChainLink>>,
	trees: ReadonlyMap<string, string>,
	placed: Placed,
): ReadonlyArray<Answer> => {
	const mine = rows.filter((r) => r.link.squash === squash);
	const links = mine.map((r) => r.link);
	const tickets = new Set(links.map((l) => l.ticket));
	const moves = links.filter((l) => l.from !== l.to);
	const empty = links.filter((l) => l.from === l.to);
	const first = links[0];
	const last = links.at(-1);
	const visited = new Set([first?.from, ...moves.map((l) => l.to)]);
	const whole =
		first !== undefined &&
		last !== undefined &&
		placed.onMain &&
		links.every((l) => placed.before.has(l.base)) &&
		mine.every((r) => r.signer === r.link.step) &&
		tickets.size === 1 &&
		visited.size === moves.length + 1 &&
		new Set(empty.map((l) => l.from)).size === empty.length &&
		first.from === trees.get(first.base) &&
		links.every((l, i) => i === 0 || l.from === links[i - 1]?.to) &&
		last.to === trees.get(squash);
	if (!whole || first === undefined) return [stuck("broken_chain", squash)];
	const all = rows.flatMap(({link, signer}): Signed[] =>
		link.step === "person" || signer === "person" ? [] : [{note: link, signer}],
	);
	const steps = links.filter((l): l is Link => l.step !== "person");
	const stale = staleSteps(first.ticket, all, steps);
	return stale.size === 0 ? [done] : [...stale].map((step) => stuck("stale_link", squash, {step}));
};

// The edge: git and ssh-keygen through effect/process, and the files a run reads and writes.

class Failed extends Schema.TaggedError<Failed>()("Failed", {what: Schema.String}) {}

const text = Effect.fnUntraced(function* (s: Stream.Stream<Uint8Array, unknown>) {
	return yield* s.pipe(Stream.decodeText(), Stream.mkString);
});

/** One process: its output, its errors and its exit code. Nothing it prints is trusted as a command. */
const run = Effect.fnUntraced(function* (cmd: string, args: ReadonlyArray<string>, input?: string) {
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const stdin = input === undefined ? "ignore" : Stream.make(new TextEncoder().encode(input));
			const proc = yield* ChildProcess.make(cmd, [...args], {stdin});
			const [out, err, code] = yield* Effect.all(
				[text(proc.stdout), text(proc.stderr), proc.exitCode],
				{concurrency: 3},
			);
			return {out, err, code: Number(code)};
		}),
	).pipe(Effect.mapError(() => new Failed({what: `could not start ${cmd}`})));
});

const must = Effect.fnUntraced(function* (
	cmd: string,
	args: ReadonlyArray<string>,
	input?: string,
) {
	return yield* run(cmd, args, input).pipe(
		Effect.flatMap((r) =>
			r.code === 0
				? Effect.succeed(r.out)
				: Effect.fail(new Failed({what: `${cmd} ${args.join(" ")}: ${r.err.trim()}`})),
		),
	);
});

const git = Effect.fnUntraced(function* (args: ReadonlyArray<string>, input?: string) {
	return yield* must("git", args, input);
});
const gitMaybe = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
	return yield* run("git", args).pipe(Effect.map((r) => (r.code === 0 ? r.out : null)));
});
const nul = (out: string) => out.split("\0").filter((p) => p !== "");
const words = (out: string) => out.split("\n").filter((p) => p !== "");
const treeAt = Effect.fnUntraced(function* (rev: string) {
	return yield* gitMaybe(["rev-parse", "--verify", "-q", `${rev}^{tree}`]);
});
const fileAt = Effect.fnUntraced(function* (rev: string, path: string) {
	return yield* gitMaybe(["show", `${rev}:${path}`]);
});

/**
 * Checks a link's text with ssh-keygen against one keys file: the role that signed it, or null. The
 * note's `key` must be the fingerprint of the key that verified, so a row never names another key.
 */
const verifier = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const dir = yield* fs.makeTempDirectoryScoped();
	let n = 0;
	return Effect.fnUntraced(function* (keys: string, note: Note) {
		return yield* Effect.gen(function* () {
			n += 1;
			const allowed = path.join(dir, `allowed-${n}`);
			const sig = path.join(dir, `sig-${n}`);
			yield* fs.writeFileString(allowed, keys);
			yield* fs.writeFileString(sig, note.sig);
			const found = yield* run("ssh-keygen", ["-Y", "find-principals", "-s", sig, "-f", allowed]);
			const names = words(found.out);
			const [who] = names;
			if (found.code !== 0 || names.length !== 1 || who !== note.step) return null;
			const args = ["-Y", "verify", "-f", allowed, "-I", who, "-n", NAMESPACE, "-s", sig];
			const ok = yield* run("ssh-keygen", args, signedText(note));
			const used = / key (SHA256:[A-Za-z0-9+/=]+)\s*$/.exec(ok.out)?.[1];
			return ok.code === 0 && used === note.key ? note.step : null;
		}).pipe(Effect.mapError(() => new Failed({what: "could not write a temp file"})));
	});
});

/** Git separates header lines only at LF and removes one space from continuation lines. */
const headerField = (lines: ReadonlyArray<string>, name: string) => {
	const values: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		if (!line.startsWith(`${name} `)) continue;
		const value = [line.slice(name.length + 1)];
		while (lines[i + 1]?.startsWith(" ")) {
			i += 1;
			value.push((lines[i] ?? "").slice(1));
		}
		values.push(value.join("\n"));
	}
	return values.length === 1 ? values[0] : undefined;
};

/** p83b: git checks native SSH signatures using only the trusted file's person lines. */
const personVerifier = Effect.gen(function* () {
	const format = (yield* git(["rev-parse", "--show-object-format"])).trim();
	const name = format === "sha256" ? "gpgsig-sha256" : "gpgsig";
	return Effect.fnUntraced(function* (keys: string) {
		return yield* Effect.gen(function* () {
			const people = words(keys).filter((line) => line.startsWith("person:"));
			if (people.length === 0)
				return Effect.fnUntraced(function* (_sha: string, _link?: PersonLink) {
					return yield* Effect.succeed(false);
				});
			const fs = yield* FileSystem.FileSystem;
			const allowed = yield* fs.makeTempFileScoped();
			yield* fs.writeFileString(allowed, `${people.join("\n")}\n`);
			return Effect.fnUntraced(function* (sha: string, link?: PersonLink) {
				// gpg.format chooses how to sign; verification detects the signature's own format.
				const raw = yield* gitMaybe(["cat-file", "commit", sha]);
				const headers = ((raw ?? "").split("\n\n", 1)[0] ?? "").split("\n");
				const signature = headerField(headers, name);
				const tree = headerField(headers, "tree");
				if (
					signature === undefined ||
					tree === undefined ||
					signature.split("\n", 1)[0] !== "-----BEGIN SSH SIGNATURE-----"
				)
					return false;
				if (link !== undefined) {
					const parent = yield* treeAt(`${sha}^1`);
					if (link.sig !== `${signature}\n` || link.to !== tree || link.from !== parent?.trim())
						return false;
				}
				const result = yield* run("git", [
					"-c",
					"gpg.format=ssh",
					"-c",
					`gpg.ssh.allowedSignersFile=${allowed}`,
					"-c",
					"gpg.ssh.program=ssh-keygen",
					"verify-commit",
					sha,
				]);
				const used = / key (SHA256:[A-Za-z0-9+/=]+)\s*$/.exec(result.err)?.[1];
				return result.code === 0 && (link === undefined || used === link.key);
			});
		}).pipe(Effect.mapError(() => new Failed({what: "could not write person signers"})));
	});
});

/** Every note on one notes ref, decoded; one that does not decode is left out. */
const notesOn = Effect.fnUntraced(function* (ref: string) {
	const found: Array<{commit: string; note: Note}> = [];
	for (const line of words(yield* git(["notes", `--ref=${ref}`, "list"]))) {
		const [blob = "", commit = ""] = line.split(" ");
		const note = decodeNote((yield* git(["cat-file", "blob", blob])).trim());
		if (Option.isSome(note)) found.push({commit, note: note.value});
	}
	return found;
});

const HEX = /^[0-9a-f]{40}$/;
const flag = (name: string) => {
	const args = process.argv.slice(3);
	const at = args.indexOf(name);
	return at < 0 ? undefined : args[at + 1];
};
const need = Effect.fnUntraced(function* (name: string) {
	const value = flag(name);
	return yield* value === undefined || value.startsWith("-")
		? Effect.fail(new Failed({what: `${name} is required`}))
		: Effect.succeed(value);
});
const resolve = Effect.fnUntraced(function* (rev: string) {
	return yield* git(["rev-parse", "--verify", "-q", `${rev}^{commit}`]).pipe(
		Effect.map((s) => s.trim()),
	);
});

/**
 * The commits to judge. `--main` is the main CI checked out, the trusted one: the keys file, the exam
 * list and the up-to-date check are read there, so a key main has dropped since the event's base stops
 * counting. With no `--main`, the base stands in, as on a laptop. With `--fetch`, the workflow's values:
 * `--main` is required, every sha is checked, and the event's shas are fetched by sha, notes too.
 */
const endpoints = Effect.gen(function* () {
	const base = yield* need("--base");
	const head = yield* need("--head");
	const main = flag("--main");
	if (process.argv.includes("--fetch")) {
		const pr = flag("--pr");
		const shas = [base, head, main ?? ""];
		if (!shas.every((sha) => HEX.test(sha)) || (pr !== undefined && !/^[0-9]+$/.test(pr)))
			return yield* new Failed({what: "--fetch takes 40-hex shas, --main included, and a number"});
		yield* git(["fetch", "--no-tags", "-q", "origin", base, head]);
		const remote = yield* run("git", ["ls-remote", "--exit-code", "origin", "refs/notes/fabrika"]);
		if (remote.code === 0)
			yield* git(["fetch", "--no-tags", "-q", "origin", "+refs/notes/fabrika:refs/notes/fabrika"]);
	}
	return {head: yield* resolve(head), main: yield* resolve(main ?? base)};
});

/** Text inside a workflow command, escaped as GitHub's own toolkit does, so it cannot start another. */
export const annotate = (s: string) =>
	s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
/** A path in a printed line: JSON-quoted, and safe inside markdown code and a table. */
const quote = (path: string) =>
	JSON.stringify(path)
		.replaceAll("`", "\\u0060")
		.replaceAll("<", "\\u003c")
		.replaceAll("|", "\\u007c");
/** One answer as a line, its paths shown by `show`. */
export const plain = (a: Answer, show: (path: string) => string = quote) => {
	if (a._tag === "done") return "done";
	if (a._tag === "ask") return `ask owner exam_read ${a.paths.map(show).join(" ")}`;
	const paths = a.paths === undefined ? "" : ` ${a.paths.map(show).join(" ")}`;
	return `stuck ${a.reason} ${a.sha}${a.step === undefined ? "" : ` step ${a.step}`}${paths}`;
};

/**
 * Prints each answer three ways and returns the exit code, 1 on any `stuck`: one JSON line on stdout,
 * one plain line on stderr, and in GitHub Actions an annotation and a row of the step summary.
 */
const report = Effect.fnUntraced(function* (
	title: string,
	answers: ReadonlyArray<Answer>,
	extra: string,
) {
	for (const a of answers) {
		yield* Console.log(JSON.stringify(a));
		yield* Console.error(`${title}: ${plain(a)}`);
	}
	const summary = yield* Config.String("GITHUB_STEP_SUMMARY").pipe(Config.option);
	if (Option.isSome(summary)) {
		for (const a of answers) {
			const level = a._tag === "stuck" ? "error" : a._tag === "ask" ? "warning" : "notice";
			yield* Console.log(`::${level} title=${title}::${annotate(plain(a, (p) => p))}`);
		}
		const rows = answers.map((a) => `| \`${a._tag}\` | \`${plain(a)}\` |`);
		const body = [`### ${title}${extra}`, "", "| answer | detail |", "|---|---|", ...rows, ""];
		const fs = yield* FileSystem.FileSystem;
		yield* fs
			.writeFileString(summary.value, `${body.join("\n")}\n`, {flag: "a"})
			.pipe(Effect.mapError(() => new Failed({what: "could not write the step summary"})));
	}
	return answers.some((a) => a._tag === "stuck") ? 1 : 0;
});

const changedPaths = Effect.fnUntraced(function* (from: string, sha: string) {
	return yield* git([
		"diff-tree",
		"-r",
		"-z",
		"-M",
		"--name-status",
		"--no-commit-id",
		from,
		sha,
	]).pipe(
		Effect.map((out) => {
			const parts = nul(out);
			const paths: string[] = [];
			for (let i = 0; i < parts.length;) {
				const status = parts[i] ?? "";
				const two = status.startsWith("R") || status.startsWith("C");
				paths.push(...parts.slice(i + 1, i + (two ? 3 : 2)));
				i += two ? 3 : 2;
			}
			return paths;
		}),
	);
});

const checkMain = Effect.gen(function* () {
	const {head, main} = yield* endpoints;
	const trust = flag("--keys-from") === "head" ? head : main;
	const exam = decodeExam((yield* fileAt(trust, "exam-paths.json")) ?? "");
	if (Option.isNone(exam)) return yield* new Failed({what: "no readable exam-paths.json"});
	const isExam = examMatcher(exam.value);
	const changed = nul(
		yield* git(["diff", "--name-only", "-z", "--no-renames", `${main}...${head}`]),
	);
	if (!inScope(changed, isExam)) {
		yield* Console.log(JSON.stringify(done));
		yield* Console.error("commits: not in scope: touches no next/** and no exam path");
		return 0;
	}
	const keys = yield* fileAt(trust, "allowed_signers");
	const problem = keysProblem(keys);
	if (problem !== null || keys === null)
		return yield* new Failed({what: `allowed_signers: ${problem}`});
	const verify = yield* verifier;
	const people = yield* personVerifier;
	const verifyPerson = yield* people(keys);
	const signedBy = Effect.fnUntraced(function* (note: Note) {
		return yield* verify(keys, note).pipe(Effect.map((signer): Signed => ({note, signer})));
	});
	const notes = yield* notesOn("fabrika");
	const byCommit = new Map(notes.map((n) => [n.commit, n.note]));
	const commits: Commit[] = [];
	for (const sha of words(
		yield* git(["rev-list", "--topo-order", "--reverse", `${main}..${head}`]),
	)) {
		const parent = yield* gitMaybe(["rev-parse", "--verify", "-q", `${sha}^1`]);
		const note = byCommit.get(sha);
		commits.push({
			sha,
			tree: (yield* treeAt(sha))?.trim() ?? "",
			parentTree: parent === null ? null : ((yield* treeAt(parent.trim()))?.trim() ?? null),
			paths: parent === null ? [] : yield* changedPaths(parent.trim(), sha),
			signed: note === undefined ? null : yield* signedBy(note),
			person: note === undefined && (yield* verifyPerson(sha)) ? true : undefined,
		});
	}
	// p89 reads every note on the ref, but only one naming a ticket of this pull request can matter.
	const tickets = new Set(
		commits.flatMap((c) => (c.signed === null ? [] : [c.signed.note.ticket])),
	);
	const all: Signed[] = [];
	for (const n of notes) {
		if (!tickets.has(n.note.ticket)) continue;
		const mine = commits.find((c) => c.sha === n.commit)?.signed;
		all.push(mine ?? (yield* signedBy(n.note)));
	}
	const containsBase = (yield* run("git", ["merge-base", "--is-ancestor", main, head])).code === 0;
	const result = check({head, containsBase, changed, commits, notes: all}, isExam);
	const extra = result.ticket === null ? "" : `, ticket ${result.ticket}`;
	yield* Console.error(`commits: ${commits.length} commits${extra}`);
	return yield* report("commits", result.answers, extra);
});

/**
 * Every `attested` link in one revision's `field/runs.jsonl`, with the line each came from. Each line
 * is parsed, never searched as text, so a key written with escapes cannot hide a row.
 */
const loggedAt = Effect.fnUntraced(function* (rev: string) {
	const lines = ((yield* fileAt(rev, "field/runs.jsonl")) ?? "").split("\n");
	const found: Array<{line: string; link: ChainLink}> = [];
	for (const [i, line] of lines.entries()) {
		if (line.trim() === "") continue;
		const row: unknown = yield* Effect.try({
			try: () => JSON.parse(line),
			catch: () => new Failed({what: `field/runs.jsonl line ${i + 1} is not JSON`}),
		});
		if (row === null || typeof row !== "object") continue;
		const links = (row as {attested?: unknown}).attested;
		if (links === undefined) continue;
		if (!Array.isArray(links))
			return yield* new Failed({what: `field/runs.jsonl line ${i + 1}: attested is not a list`});
		for (const raw of links) {
			const link = decodeLink(raw);
			if (Option.isNone(link))
				return yield* new Failed({
					what: `field/runs.jsonl line ${i + 1}: a link that does not read`,
				});
			found.push({line, link: link.value});
		}
	}
	return found;
});

const ancestor = Effect.fnUntraced(function* (older: string, newer: string) {
	return yield* run("git", ["merge-base", "--is-ancestor", older, newer]).pipe(
		Effect.map((r) => r.code === 0),
	);
});

const chainMain = Effect.gen(function* () {
	const advice = process.argv.includes("--advise");
	let rev = "HEAD";
	let main = "HEAD";
	let squashes: string[];
	const one = flag("--squash");
	if (one !== undefined) squashes = [yield* resolve(one)];
	else if (advice) {
		const added = words(
			yield* git([
				"log",
				"--first-parent",
				"--diff-filter=A",
				"--format=%H",
				"HEAD",
				"--",
				"next/apps/fabrika/src/exam/commits.ts",
			]),
		).at(-1);
		const exam = decodeExam((yield* fileAt("HEAD", "exam-paths.json")) ?? "");
		const isExam = Option.isSome(exam) ? examMatcher(exam.value) : () => false;
		squashes = [];
		const since =
			added === undefined
				? []
				: words(yield* git(["rev-list", "--first-parent", `${added}..HEAD`]));
		for (const sha of since) {
			const paths = yield* changedPaths(`${sha}^1`, sha);
			if (inScope(paths, isExam)) squashes.push(sha);
		}
	} else {
		const ends = yield* endpoints;
		const head = ends.head;
		main = ends.main;
		rev = head;
		const before = new Set((yield* loggedAt(main)).map((l) => l.line));
		squashes = [
			...new Set(
				(yield* loggedAt(head)).filter((l) => !before.has(l.line)).map((l) => l.link.squash),
			),
		];
	}
	const verify = yield* verifier;
	const rows: Logged<ChainLink>[] = [];
	const people = yield* personVerifier;
	// A row's keys commit counts only when it was on main before its squash. Anyone who can push can
	// make a commit whose allowed_signers holds their own key, on a branch or in a log pull request.
	for (const {link} of yield* loggedAt(rev)) {
		const keys = (yield* ancestor(link.keys, `${link.squash}^1`))
			? yield* fileAt(link.keys, "allowed_signers")
			: null;
		let signer: Logged<ChainLink>["signer"] = null;
		if (keys !== null && keysProblem(keys) === null) {
			if (link.step === "person") {
				// A squash does not keep the original commit in main's history.
				if ((yield* gitMaybe(["cat-file", "-e", `${link.commit}^{commit}`])) === null)
					yield* run("git", ["fetch", "--no-tags", "-q", "origin", link.commit]);
				const verifyPerson = yield* people(keys);
				signer = (yield* verifyPerson(link.commit, link)) ? "person" : null;
			} else signer = yield* verify(keys, link);
		}
		rows.push({link, signer});
	}
	const answers: Answer[] = [];
	for (const squash of squashes) {
		const trees = new Map<string, string>();
		for (const sha of [
			squash,
			...rows.filter((r) => r.link.squash === squash).map((r) => r.link.base),
		]) {
			const tree = yield* treeAt(sha);
			if (tree !== null) trees.set(sha, tree.trim());
		}
		const before = new Set<string>();
		for (const r of rows.filter((r) => r.link.squash === squash)) {
			if (yield* ancestor(r.link.base, `${squash}^1`)) before.add(r.link.base);
		}
		const onMain = yield* ancestor(squash, main);
		answers.push(...chain(squash, rows, trees, {onMain, before}));
	}
	if (squashes.length === 0) yield* Console.error("chain: no squash to walk");
	const code = yield* report("chain", answers, "");
	return advice ? 0 : code;
});

const signMain = Effect.gen(function* () {
	const step = Schema.decodeUnknownOption(Role)(flag("--step"));
	const ticket = Schema.decodeUnknownOption(Ticket)(flag("--ticket"));
	const key = yield* need("--key");
	if (Option.isNone(step) || Option.isNone(ticket))
		return yield* new Failed({what: "--step is tests, build or lead, and --ticket a number"});
	const head = yield* resolve("HEAD");
	const from = yield* treeAt("HEAD^1");
	const to = yield* treeAt("HEAD");
	const keys = yield* fileAt("HEAD", "allowed_signers");
	if (from === null || to === null || keys === null)
		return yield* new Failed({what: "HEAD needs a parent and an allowed_signers"});
	const verify = yield* verifier;
	let top = 0;
	for (const ref of ["fabrika", "fabrika-origin"]) {
		for (const {note} of yield* notesOn(ref)) {
			if (note.step !== step.value || note.ticket !== ticket.value || note.version <= top) continue;
			if ((yield* verify(keys, note)) === step.value) top = note.version;
		}
	}
	const link = {
		step: step.value,
		ticket: ticket.value,
		version: top + 1,
		from: from.trim(),
		to: to.trim(),
	};
	const sig = yield* must(
		"ssh-keygen",
		["-Y", "sign", "-n", NAMESPACE, "-f", key],
		signedText(link),
	);
	const print = yield* must("ssh-keygen", ["-l", "-f", `${key}.pub`]);
	const note = Note.make({...link, key: print.split(" ")[1] ?? "", sig});
	if ((yield* verify(keys, note)) !== step.value)
		return yield* new Failed({
			what: `the key does not verify as ${step.value} in HEAD's allowed_signers`,
		});
	yield* git(["notes", "--ref=fabrika", "add", "-F", "-", head], JSON.stringify(note));
	yield* Console.log(JSON.stringify({...note, commit: head}));
	return 0;
});

const pushMain = Effect.gen(function* () {
	const merge = Effect.gen(function* () {
		const remote = yield* run("git", ["ls-remote", "--exit-code", "origin", "refs/notes/fabrika"]);
		if (remote.code !== 0) return;
		yield* git([
			"fetch",
			"--no-tags",
			"-q",
			"origin",
			"+refs/notes/fabrika:refs/notes/fabrika-origin",
		]);
		yield* git(["notes", "--ref=fabrika", "merge", "-q", "refs/notes/fabrika-origin"]);
	});
	yield* merge;
	const pushed = yield* run("git", ["push", "-q", "origin", "refs/notes/fabrika"]);
	if (pushed.code !== 0) {
		yield* merge;
		yield* git(["push", "-q", "origin", "refs/notes/fabrika"]);
	}
	yield* git(["push", "-q", "origin", "HEAD"]);
	return 0;
});

const main = Effect.gen(function* () {
	const command = process.argv[2];
	if (command === "check") return yield* checkMain;
	if (command === "chain") return yield* chainMain;
	if (command === "sign") return yield* signMain;
	if (command === "push") return yield* pushMain;
	return yield* new Failed({what: "commands: check, chain, sign, push"});
});

if (import.meta.main) {
	NodeRuntime.runMain(
		Effect.scoped(main).pipe(
			Effect.tapError((e) =>
				Console.error(
					`commits: the run failed: ${annotate(e._tag === "Failed" ? e.what : String(e))}`,
				),
			),
			Effect.provide(NodeServices.layer),
		),
		{
			teardown: (exit, onExit) =>
				onExit(Exit.isSuccess(exit) && typeof exit.value === "number" ? exit.value : 2),
		},
	);
}
