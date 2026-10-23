import {createHash} from "node:crypto";
import {Effect, Exit, FileSystem, Path, Schema, Stream} from "effect";
import {ChildProcess, ChildProcessSpawner} from "effect/process";
import {splitPiece, textOf} from "./blocks.ts";
import {type Facts, type Judged, judge, type Ran, type Removed} from "./judge.ts";
import {decodeEntry, decodeVerdict, type Entry, type Piece, piecesOf} from "./record.ts";

// The reading: records from disk or from git at a base, prints of the code,
// and runs of the check commands (experiment 117). Node at the edge in one
// place only: `node:crypto` for sha256, which Effect does not have. Files go
// through Effect's FileSystem, commands through Effect's ChildProcess.
//
// A check command runs under `sh -c` with PATH and HOME alone, plus
// PROMISE_PLANT when the plant is asked for: no key in the shell reaches it.

/** Where the records live, from the top of the repo. */
export const FOLDER = "promises";

/** The tool could not read what it needs, or will not write. */
export class Refused extends Schema.TaggedError<Refused>()("Refused", {why: Schema.String}) {}
const refused = (why: string) => new Refused({why});

/** A piece's print: the first 16 hex of the sha256 of its text. */
export const printOf = (text: string): string =>
	createHash("sha256").update(text).digest("hex").slice(0, 16);

const text = (stream: Stream.Stream<Uint8Array, unknown>) =>
	stream.pipe(Stream.decodeText(), Stream.mkString);

/** Run one command to its end, in `cwd`. Exit code -1: it could not start. */
const run = (cwd: string, file: string, args: readonly string[], env: Record<string, string>) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const handle = yield* spawner.spawn(
			ChildProcess.make(file, [...args], {cwd, env, extendEnv: false}),
		);
		const [out, err, code] = yield* Effect.all(
			[text(handle.stdout), text(handle.stderr), handle.exitCode],
			{concurrency: "unbounded"},
		);
		return {code: Number(code), out, err};
	}).pipe(
		Effect.scoped,
		Effect.catch((e) => Effect.succeed({code: -1, out: "", err: String(e)})),
	);

const baseEnv = (): Record<string, string> => ({
	PATH: process.env.PATH ?? "/usr/bin:/bin",
	HOME: process.env.HOME ?? "/",
});

const git = (cwd: string, args: readonly string[]) =>
	run(cwd, "git", args, baseEnv()).pipe(
		Effect.flatMap((r) =>
			r.code === 0
				? Effect.succeed(r.out)
				: Effect.fail(refused(`git ${args.join(" ")}: ${r.err.trim()}`)),
		),
	);

const decode = (id: string, json: string) => {
	const exit = decodeEntry(json);
	return Exit.isSuccess(exit)
		? Effect.succeed(exit.value)
		: Effect.fail(refused(`${FOLDER}/${id}.json is not a promise record: ${String(exit.cause)}`));
};

/** Every record in the working tree, by id, sorted. */
export const readEntries = (root: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dir = path.join(root, FOLDER);
		const names = (yield* fs.readDirectory(dir)).filter((n) => n.endsWith(".json")).sort();
		const out: [string, Entry][] = [];
		for (const name of names) {
			const id = name.slice(0, -".json".length);
			out.push([id, yield* decode(id, yield* fs.readFileString(path.join(dir, name)))]);
		}
		return out;
	});

/** Every record at a git ref, by id. A ref with no records folder has none. */
export const readEntriesAt = (root: string, ref: string) =>
	Effect.gen(function* () {
		const listed = yield* git(root, ["ls-tree", "--name-only", `${ref}:${FOLDER}`]).pipe(
			Effect.catch(() => Effect.succeed("")),
		);
		const out = new Map<string, Entry>();
		for (const name of listed.split("\n").filter((n) => n.endsWith(".json"))) {
			const id = name.slice(0, -".json".length);
			out.set(id, yield* decode(id, yield* git(root, ["show", `${ref}:${FOLDER}/${name}`])));
		}
		return out;
	});

/** Each piece's print in the working tree. `null`: the file or the block is not there. */
export const printsNow = (root: string, pieces: readonly Piece[]) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const out: Record<Piece, string | null> = {};
		for (const piece of pieces) {
			const {file, name} = splitPiece(piece);
			const source = yield* fs
				.readFileString(path.join(root, file))
				.pipe(Effect.catch(() => Effect.succeed(null)));
			const found = source === null ? null : textOf(source, name);
			out[piece] = found === null ? null : printOf(found);
		}
		return out;
	});

/** Run a record's check, on the real code or on its plant, and read its verdict. */
export const runCheck = (root: string, command: string, plant: string | null) =>
	Effect.gen(function* () {
		const started = performance.now();
		const env = plant === null ? baseEnv() : {...baseEnv(), PROMISE_PLANT: plant};
		const r = yield* run(root, "sh", ["-c", command], env);
		const ms = Math.round(performance.now() - started);
		const last = r.out.trim().split("\n").at(-1) ?? "";
		const verdict = decodeVerdict(last);
		if (Exit.isSuccess(verdict)) return {kind: "verdict", verdict: verdict.value, ms} satisfies Ran;
		const said = (r.err.trim() || r.out.trim()).split("\n").slice(-3).join(" / ");
		return {kind: "none", why: `exit ${r.code}${said === "" ? "" : `, ${said}`}`, ms} satisfies Ran;
	});

/** Read, run and judge every promise; with a base, against the records there. */
export const judgeAll = (root: string, base: string | null) =>
	Effect.gen(function* () {
		const entries = yield* readEntries(root);
		const before = base === null ? null : yield* readEntriesAt(root, base);
		const judged: Judged[] = [];
		for (const [id, entry] of entries) {
			const facts: Facts = {
				id,
				entry,
				before: before === null ? "unknown" : (before.get(id) ?? null),
				now: yield* printsNow(root, piecesOf(entry)),
				check: yield* runCheck(root, entry.check, null),
				plant: yield* runCheck(root, entry.check, entry.plant.name),
			};
			judged.push(judge(facts));
		}
		const ids = new Set(entries.map(([id]) => id));
		const removed: Removed[] = [...(before ?? new Map<string, Entry>())]
			.filter(([id]) => !ids.has(id))
			.map(([id, e]) => ({id, promise: e.promise}));
		return {judged, removed};
	});

/**
 * Confirm one promise at the head: refuse unless the files it names are
 * committed, the check holds and the plant is caught; then write the head
 * commit and the prints into its record.
 */
export const confirm = (root: string, id: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const all = yield* readEntries(root);
		const entry = all.find(([k]) => k === id)?.[1];
		if (entry === undefined) return yield* Effect.fail(refused(`no promise named ${id}`));
		const files = [...new Set(piecesOf(entry).map((p) => splitPiece(p).file))];
		const dirty = (yield* git(root, ["status", "--porcelain", "--", ...files])).trim();
		if (dirty !== "")
			return yield* Effect.fail(
				refused(`commit these first, so the confirmed commit holds the code checked:\n${dirty}`),
			);
		const now = yield* printsNow(root, piecesOf(entry));
		const check = yield* runCheck(root, entry.check, null);
		const plant = yield* runCheck(root, entry.check, entry.plant.name);
		const commit = (yield* git(root, ["rev-parse", "HEAD"])).trim();
		const prints: Record<string, string> = {};
		for (const [piece, print] of Object.entries(now)) if (print !== null) prints[piece] = print;
		const next: Entry = {...entry, confirmed: {commit, prints}};
		const j = judge({id, entry: next, before: "unknown", now, check, plant});
		if (!j.green) return {written: false, judged: j};
		yield* fs.writeFileString(
			path.join(root, FOLDER, `${id}.json`),
			`${JSON.stringify(next, null, "\t")}\n`,
		);
		return {written: true, judged: j};
	});
