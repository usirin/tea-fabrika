// The probe: what the Agent SDK's session store and resume really do, before the fault runs lean
// on them. Runs in the container (real Claude Code, haiku), no ledger, a Map as the store. Four
// steps, one JSON line each:
//
//   fresh     a two-turn run; every `append` the SDK makes, and the store as it stood when turn 1's
//             result came back
//   resumed   turn 2 alone, from that snapshot, in a second store and a second, empty Claude
//             config folder: another host with nothing on its disk
//   cut       a two-turn run aborted CUT_MS into turn 1: what the store holds after a kill
//   again     a second fresh two-turn run, the price to compare a resume against (warm cache)
//
// Config (env): MODEL (haiku), CUT_MS (1200), QUESTION ("What is 40 + 75?").
import {randomUUID} from "node:crypto";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {SessionKey, SessionStore, SessionStoreEntry} from "@anthropic-ai/claude-agent-sdk";
import {Config, Console, Duration, Effect} from "effect";
import {CHECK, runTurns, type TurnResult} from "./agent.ts";

type Seen = {at: number; session: string; n: number; types: string[]};

/** A Map store that remembers each append, as the probe reports it (types and counts, no text). */
const mapStore = (t0: number) => {
	const data = new Map<string, SessionStoreEntry[]>();
	const appends: Seen[] = [];
	const loads: {session: string; n: number | null}[] = [];
	const store: SessionStore = {
		append: async (key: SessionKey, entries: SessionStoreEntry[]) => {
			if (key.subpath !== undefined) return;
			data.set(key.sessionId, [...(data.get(key.sessionId) ?? []), ...entries]);
			appends.push({
				at: Date.now() - t0,
				session: key.sessionId,
				n: entries.length,
				types: entries.map((e) => e.type),
			});
		},
		load: async (key: SessionKey) => {
			const got = key.subpath === undefined ? (data.get(key.sessionId) ?? null) : null;
			loads.push({session: key.sessionId, n: got?.length ?? null});
			return got;
		},
	};
	return {data, appends, loads, store};
};

const short = (r: TurnResult) => ({...r, text: r.text.slice(0, 40)});
const bytes = (es: readonly SessionStoreEntry[] | undefined) => JSON.stringify(es ?? []).length;

const main = Effect.gen(function* () {
	const model = yield* Config.String("MODEL").pipe(Config.withDefault("haiku"));
	const cutMs = yield* Config.Number("CUT_MS").pipe(Config.withDefault(1200));
	const question = yield* Config.String("QUESTION").pipe(Config.withDefault("What is 40 + 75?"));
	const line = (o: object) => Console.log(JSON.stringify(o));

	// fresh: two turns, and a snapshot of the store at turn 1's result.
	const t0 = Date.now();
	const a = mapStore(t0);
	const sessionA = randomUUID();
	let snapshot: SessionStoreEntry[] = [];
	let turn1Usd = 0;
	const fresh = yield* runTurns({
		model,
		session: sessionA,
		from: null,
		prompts: [question, CHECK],
		store: a.store,
		onTurn: (r) => {
			if (r.turn === 1) {
				snapshot = [...(a.data.get(sessionA) ?? [])];
				turn1Usd = r.totalUsd;
			}
		},
	});
	yield* Effect.sleep(Duration.millis(500));
	yield* line({
		step: "fresh",
		ok: fresh.ok,
		answer: fresh.answer.slice(0, 40),
		totalUsd: fresh.totalUsd,
		turns: fresh.turns.map(short),
		ms: Date.now() - t0,
		appends: a.appends,
		entriesAtTurn1: snapshot.length,
		entryTypesAtTurn1: snapshot.map((e) => e.type),
		entriesAtEnd: a.data.get(sessionA)?.length ?? 0,
		bytesAtTurn1: bytes(snapshot),
		bytesAtEnd: bytes(a.data.get(sessionA)),
		otherKeys: [...a.data.keys()].filter((k) => k !== sessionA).length,
	});

	// resumed: turn 2 only, from the snapshot, on "another host": a second store, an empty config.
	const t1 = Date.now();
	const b = mapStore(t1);
	b.data.set(sessionA, snapshot);
	const sessionB = randomUUID();
	const resumed = yield* runTurns({
		model,
		session: sessionB,
		from: sessionA,
		prompts: [CHECK],
		store: b.store,
		onTurn: () => {},
		env: {CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "other-host-"))},
	});
	yield* Effect.sleep(Duration.millis(500));
	yield* line({
		step: "resumed",
		ok: resumed.ok,
		answer: resumed.answer.slice(0, 40),
		/**
		 * What this query() spent, alone: the snapshot was taken at turn 1, before Claude Code saves
		 * its cost counter (a `cost-state` line) at the end of a query, so nothing carries over.
		 */
		totalUsd: resumed.totalUsd,
		turn1Usd,
		turns: resumed.turns.map(short),
		ms: Date.now() - t1,
		loads: b.loads,
		appends: b.appends,
		newSessionEntries: b.data.get(sessionB)?.length ?? 0,
		newSessionTypes: (b.data.get(sessionB) ?? []).map((e) => e.type),
		oldSessionEntriesAfter: b.data.get(sessionA)?.length ?? 0,
	});

	// cut: a run aborted mid turn 1 (an interrupt aborts the Claude Code child).
	const t2 = Date.now();
	const c = mapStore(t2);
	const sessionC = randomUUID();
	const cut = yield* runTurns({
		model,
		session: sessionC,
		from: null,
		prompts: [question, CHECK],
		store: c.store,
		onTurn: () => {},
	}).pipe(Effect.timeoutOption(Duration.millis(cutMs)));
	yield* Effect.sleep(Duration.millis(1500));
	yield* line({
		step: "cut",
		cutMs,
		finishedBeforeCut: cut._tag === "Some",
		appends: c.appends,
		entries: c.data.get(sessionC)?.length ?? 0,
		types: (c.data.get(sessionC) ?? []).map((e) => e.type),
	});

	// again: a second fresh run, the price a resume competes with.
	const t3 = Date.now();
	const d = mapStore(t3);
	const again = yield* runTurns({
		model,
		session: randomUUID(),
		from: null,
		prompts: [question, CHECK],
		store: d.store,
		onTurn: () => {},
	});
	yield* line({
		step: "again",
		ok: again.ok,
		answer: again.answer.slice(0, 40),
		totalUsd: again.totalUsd,
		turns: again.turns.map(short),
		ms: Date.now() - t3,
	});
});

Effect.runPromise(main).catch((e) => {
	console.log(JSON.stringify({step: "failed", why: String(e).slice(0, 300)}));
	process.exitCode = 1;
});
