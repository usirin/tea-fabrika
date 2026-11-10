// The CI ask for edges (Tier 1, P35; docs/direction/no-promises.md). An edge is one line under an
// edge comment, `// oxlint-disable-next-line fabrika/no-promises -- edge: <why>` or the same for
// `fabrika/no-effect-run-outside-edge`, and the owner reads each new one. A pull request that adds
// one asks, one line each with its reason. It never blocks.
//
// `asks` is the core: given a branch's files at its merge base and at its head, it answers the edge
// comments the head has that the base did not. An edge is matched by its file, its rules and its
// reason, and counted, so an edge moved within its file asks nothing, a renamed file or a reworded
// reason asks again, and a deleted file asks nothing. Comments are read with oxc-parser, so the text
// of an edge comment inside a string is not one. A file that does not parse fails, never a clean
// answer.
//
// Run as `node next/apps/fabrika/src/exam/edges.ts --base <ref>` (default `origin/main`), it reads
// the files under `next/` that changed since the merge base with git, prints the asks and exits 0. In
// GitHub Actions it also writes them to the step summary and puts a note on each line of the diff.
// It exits 2 when it could not read something. The answer comes back by hand for now: the lead agent
// relays each line to the owner and posts the answer on the pull request (P35, flag 2).
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {Config, Console, Effect, Exit, FileSystem, Option, Path, Schema, Stream} from "effect";
import {ChildProcess} from "effect/process";
import {parseSync} from "oxc-parser";

/** One edge comment: where it stands, the rules it names, as written, and its reason. */
interface Edge {
	readonly path: string;
	readonly line: number;
	readonly rules: string;
	readonly why: string;
}

const EDGE_RULES: ReadonlySet<string> = new Set([
	"fabrika/no-promises",
	"fabrika/no-effect-run-outside-edge",
]);

const DISABLE = /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(.*)$/s;
const REASON = /\s--\s+/;
const CODE = /\.[cm]?[jt]sx?$/;

class Unparsed extends Schema.TaggedError<Unparsed>()("Unparsed", {path: Schema.String}) {}

/** The edge comments in one file, in line order. */
const edgesIn = Effect.fnUntraced(function* (path: string, text: string) {
	const parsed = parseSync(path, text);

	if (parsed.errors.length > 0) {
		return yield* new Unparsed({path});
	}

	return parsed.comments.flatMap((comment): Edge[] => {
		const rest = DISABLE.exec(comment.value)?.[1];

		if (rest === undefined) {
			return [];
		}

		const at = rest.search(REASON);
		const rules = (at < 0 ? rest : rest.slice(0, at))
			.split(",")
			.map((rule) => rule.trim())
			.filter((rule) => rule !== "");

		if (!rules.some((rule) => EDGE_RULES.has(rule))) {
			return [];
		}

		const why = at < 0 ? "" : rest.slice(at).replace(REASON, "").trim();
		const line = text.slice(0, comment.start).split("\n").length;
		return [{path, line, rules: rules.join(", "), why}];
	});
});

const matchKey = (edge: Edge) => JSON.stringify([edge.path, edge.rules, edge.why]);

/**
 * The edge comments at `head` that were not at `base`, each map keyed by path from the top of the
 * repo, in path then line order.
 */
export const asks = Effect.fn("exam.asks")(function* (
	base: ReadonlyMap<string, string>,
	head: ReadonlyMap<string, string>,
) {
	const found: Edge[] = [];

	for (const path of [...head.keys()].sort()) {
		const old = base.get(path);
		const before = old === undefined ? [] : yield* edgesIn(path, old);
		const left = new Map<string, number>();

		for (const edge of before) {
			left.set(matchKey(edge), (left.get(matchKey(edge)) ?? 0) + 1);
		}

		for (const edge of yield* edgesIn(path, head.get(path) ?? "")) {
			const n = left.get(matchKey(edge)) ?? 0;

			if (n > 0) {
				left.set(matchKey(edge), n - 1);
			} else {
				found.push(edge);
			}
		}
	}

	return found;
});

class GitFailed extends Schema.TaggedError<GitFailed>()("GitFailed", {
	args: Schema.String,
	code: Schema.Number,
}) {}

/** One git command's output; any exit but 0 fails. */
const git = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
	const run = yield* ChildProcess.make("git", [...args]);
	const [out, code] = yield* Effect.all(
		[run.stdout.pipe(Stream.decodeText(), Stream.mkString), run.exitCode],
		{concurrency: 2},
	);

	if (code !== 0) {
		return yield* new GitFailed({args: args.join(" "), code});
	}

	return out;
}, Effect.scoped);

const lines = (text: string) => text.split("\n").filter((line) => line !== "");

/** A note on one line of the diff, in GitHub's workflow command form. */
const notice = (edge: Edge) => {
	const escape = (s: string) =>
		s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
	const where = escape(edge.path).replaceAll(":", "%3A").replaceAll(",", "%2C");
	return `::notice file=${where},line=${edge.line}::${escape(`${edge.rules} -- ${edge.why}`)}`;
};

const ask = (edge: Edge) => `${edge.path}:${edge.line}  ${edge.rules}  ${edge.why}  [ok] [no]`;

const main = Effect.gen(function* () {
	const args = process.argv.slice(2);
	const flag = args.indexOf("--base");
	const against = (flag < 0 ? undefined : args[flag + 1]) ?? "origin/main";
	const top = (yield* git(["rev-parse", "--show-toplevel"])).trim();
	const at = Effect.fnUntraced(function* (more: ReadonlyArray<string>) {
		return yield* git(["-C", top, ...more]);
	});
	const base = (yield* at(["merge-base", against, "HEAD"])).trim();
	const changed = lines(yield* at(["diff", "--name-only", "--no-renames", base, "--", "next"]));
	const atBase = new Set(lines(yield* at(["ls-tree", "-r", "--name-only", base, "--", "next"])));
	const fs = yield* FileSystem.FileSystem;
	const paths = yield* Path.Path;
	const before = new Map<string, string>();
	const after = new Map<string, string>();

	for (const path of changed.filter((p) => CODE.test(p))) {
		if (atBase.has(path)) {
			before.set(path, yield* at(["show", `${base}:${path}`]));
		}

		if (yield* fs.exists(paths.join(top, path))) {
			after.set(path, yield* fs.readFileString(paths.join(top, path)));
		}
	}

	const found = yield* asks(before, after);
	const head =
		found.length === 0
			? "No new edge comments in this pull request."
			: "Edges this pull request adds, for the owner:";
	yield* Console.log([head, ...found.map(ask)].join("\n"));
	const summary = yield* Config.String("GITHUB_STEP_SUMMARY").pipe(Config.option);

	if (Option.isSome(summary)) {
		for (const edge of found) {
			yield* Console.log(notice(edge));
		}

		const body = [`### ${head}`, "", ...found.map((edge) => `- \`${ask(edge)}\``), ""];
		yield* fs.writeFileString(summary.value, `${body.join("\n")}\n`, {flag: "a"});
	}
});

if (import.meta.main) {
	NodeRuntime.runMain(
		main.pipe(
			Effect.tapError((e) => Console.error(`edges: could not read: ${JSON.stringify(e)}`)),
			Effect.provide(NodeServices.layer),
		),
		{teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) ? 0 : 2)},
	);
}
