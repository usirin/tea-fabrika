import {Effect, FileSystem, Option, Schema} from "effect";
import type {Sessions} from "./turn.ts";

// Our session ids, mapped to each maker's (./turn.ts). A stage names its
// session before the first turn, so a parent keeps it in its state at once;
// the maker's own id comes later (Codex and ACP pick it) and is kept here.
//
//   put("build/42", "codex", "019a...")   then, in a new process:
//   get("build/42")  ->  {provider: "codex", own: "019a..."}
//
// Once only: a session never moves to another maker's id or provider.

/** In memory, for a test or one process. */
export const memorySessions = (): Sessions & {readonly all: () => ReadonlyMap<string, unknown>} => {
	const map = new Map<string, {provider: string; own: string}>();
	return {
		get: (session) => Effect.sync(() => map.get(session) ?? null),
		put: (session, provider, own) =>
			Effect.sync(() => {
				if (!map.has(session)) map.set(session, {provider, own});
			}),
		all: () => map,
	};
};

const Kept = Schema.Struct({provider: Schema.String, own: Schema.String});
const readKept = Schema.decodeUnknownOption(Schema.fromJsonString(Kept));

/**
 * One small file per session under `dir`, so a new process finds it. Its name
 * is our id, escaped; it holds the provider and the maker's id, nothing else.
 */
export const fileSessions = (dir: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.makeDirectory(dir, {recursive: true, mode: 0o700}).pipe(Effect.orDie);
		const fileOf = (session: string) => `${dir}/${encodeURIComponent(session)}.json`;
		const sessions: Sessions = {
			get: (session) =>
				fs.readFileString(fileOf(session)).pipe(
					Effect.map((text) => Option.getOrNull(readKept(text))),
					Effect.orElseSucceed(() => null),
				),
			put: (session, provider, own) =>
				Effect.gen(function* () {
					const file = fileOf(session);
					if (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))) return;
					yield* fs.writeFileString(file, JSON.stringify({provider, own})).pipe(Effect.orDie);
				}),
		};
		return sessions;
	});
