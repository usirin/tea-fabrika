import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {afterAll, describe, expect, it, vi} from "vitest";
import * as realJournal from "./journal.ts";
import {type Ledger, LedgerUnreachable} from "./ledger.ts";
import {memoryService} from "./memory.ts";

// The journal's laws for lane 18, part 2: a save the ledger does not answer waits and is sent
// again under the same id, with no try limit, until the host stops the program (its lease's end
// plus a 10 minute grace). Properties over random runs of saves, each with a network drop as it
// starts, on the ledger in memory.
//
// The time: the journal runs its Effects on Effect's live clock, at its own edge (tea's store is
// Promise-shaped). So the test fakes the clock under it, `Date` and `setTimeout` (vitest's fake
// timers), and moves it on by hand. Nothing sleeps on this machine's clock.
//
// Nobody writes their own exam: each planted mistake is a text edit on a COPY of journal.ts in a
// temp folder, and the exact laws it breaks are checked below. Today's journal breaks one law: it
// is kept as a known bug, which passes while the law fails for the rule's reason.

type Mod = {readonly journalStore: typeof realJournal.journalStore};
const real: Mod = {journalStore: realJournal.journalStore};

const madeDirs: string[] = [];
afterAll(() => {
	for (const d of madeDirs) rmSync(d, {recursive: true, force: true});
});

/** A copy of journal.ts with one mistake, imported from its own folder. Each edit matches once. */
async function plant(a: string, b: string): Promise<Mod> {
	const dir = mkdtempSync(join(import.meta.dirname, ".journal-laws-plant-"));
	madeDirs.push(dir);
	const text = readFileSync(join(import.meta.dirname, "journal.ts"), "utf8");
	const count = text.split(a).length - 1;
	if (count !== 1) throw new Error(`plant edit: "${a}" found ${count} times, want 1`);
	writeFileSync(
		join(dir, "journal.ts"),
		text.replace(a, () => b),
	);
	const mod = (await import(
		/* @vite-ignore */ pathToFileURL(join(dir, "journal.ts")).href
	)) as typeof realJournal;
	return {journalStore: mod.journalStore};
}

/** The rule's grace past the lease's end: a save waits out any drop shorter than this. */
const GRACE = 600_000;
/** Once the network is back, a save lands within this long (the fix of experiment 149 backs off to 1 s). */
const BACK_WITHIN = 2000;

/** One save: the network drops as it starts, for `drop` ms. `lands`: its first try in the drop lands, and only the answer is lost. */
interface Save {
	readonly drop: number;
	readonly lands: boolean;
}
interface Done {
	readonly save: Save;
	readonly expected: number;
	/** What the save said, and when, from its start: null, it had not settled by the end. */
	readonly end: {readonly ok: boolean; readonly rev: number | null; readonly at: number} | null;
}
interface Run {
	readonly done: readonly Done[];
	/** The state stream's ids, as it ends. */
	readonly ids: readonly (string | null)[];
}

const NAME = "journal-laws";
const STREAM = `${NAME}/state`;

/** The ledger, cut off while the clock is before `net.until`. A try in a drop may land, its answer lost. */
const cut = (l: Ledger["Service"], net: {until: number; lands: boolean}): Ledger["Service"] => ({
	...l,
	append: (stream, expected, event, fence) =>
		Effect.suspend(() => {
			if (Date.now() >= net.until) return l.append(stream, expected, event, fence);
			const lost = Effect.fail(
				new LedgerUnreachable({method: "append", message: "the network is down"}),
			);
			if (!net.lands) return lost;
			net.lands = false;
			return l.append(stream, expected, event, fence).pipe(Effect.ignore, Effect.andThen(lost));
		}),
});

const runSaves = async (mod: Mod, saves: readonly Save[]): Promise<Run> => {
	vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"], now: 0});
	try {
		const l = memoryService();
		await Effect.runPromise(l.register(NAME, "test"));
		const c = await Effect.runPromise(l.claim(NAME, "h1", 1, 24 * 3_600_000));
		const net = {until: 0, lands: false};
		const store = mod.journalStore(cut(l, net), {
			schema: Schema.Number,
			stream: STREAM,
			fence: c.fence,
			holder: "h1",
			note: () => {},
		});
		const done: Done[] = [];
		let expected = 0;
		for (const [i, save] of saves.entries()) {
			const start = Date.now();
			net.until = start + save.drop;
			net.lands = save.lands;
			let end: Done["end"] = null;
			store.saveFenced(i, expected).then(
				(rev) => {
					end = {ok: true, rev, at: Date.now() - start};
				},
				() => {
					end = {ok: false, rev: null, at: Date.now() - start};
				},
			);
			while (end === null && Date.now() - start <= save.drop + BACK_WITHIN)
				await vi.advanceTimersByTimeAsync(Math.min(1000, Math.max(50, save.drop / 20)));
			done.push({save, expected, end});
			if (end === null || !(end as {ok: boolean}).ok) break;
			expected = (end as {rev: number}).rev;
		}
		const rows = await Effect.runPromise(l.readStream(STREAM));
		return {done, ids: rows.map((r) => r.id)};
	} finally {
		vi.useRealTimers();
	}
};

interface Law {
	readonly name: string;
	readonly saves: fc.Arbitrary<readonly Save[]>;
	readonly check: (r: Run) => string | null;
}

const assertLaw = (law: Law, mod: Mod) =>
	fc.assert(
		fc.asyncProperty(law.saves, async (saves) => {
			const why = law.check(await runSaves(mod, saves));
			if (why !== null) throw new Error(why);
		}),
		{numRuns: 30, seed: 7},
	);

const shown = (d: Done) =>
	d.end === null
		? `had not ended ${d.save.drop + BACK_WITHIN} ms on`
		: d.end.ok
			? `landed at rev ${d.end.rev} after ${d.end.at} ms`
			: `failed after ${d.end.at} ms`;

/**
 * J1. A save whose answer was lost is sent again under its id: it lands once, and the save goes on.
 * Drops here are short, under a second, so a try limit of today's size does not end them.
 */
const landsOnce: Law = {
	name: "a save whose answer was lost lands once, under one id, and the save goes on",
	saves: fc.array(
		fc.record({
			drop: fc.oneof(fc.constant(0), fc.integer({min: 1, max: 900})),
			lands: fc.boolean(),
		}),
		{minLength: 1, maxLength: 4},
	),
	check: ({done, ids}) => {
		for (const d of done)
			if (d.end === null || !d.end.ok || d.end.rev !== d.expected + 1)
				return `a save at rev ${d.expected} in a ${d.save.drop} ms drop${d.save.lands ? ", its first try landed" : ""}: ${shown(d)}, wanted it to land at rev ${d.expected + 1}`;
		const twice = ids.find((id, i) => ids.indexOf(id) !== i);
		if (twice !== undefined) return `id ${twice} landed twice`;
		if (ids.length !== done.length) return `${ids.length} rows for ${done.length} saves`;
		return null;
	},
};

/** J2. No try limit: a save waits out any drop shorter than the grace, and lands once it is back. */
const waitsOut: Law = {
	name: "a save waits out any drop shorter than the grace, and lands once the network is back",
	saves: fc.array(
		fc.record({
			drop: fc.oneof(
				fc.constantFrom(1000, 2000, 60_000, GRACE - 1000),
				fc.integer({min: 1, max: GRACE - 1000}),
			),
			lands: fc.boolean(),
		}),
		{minLength: 1, maxLength: 2},
	),
	check: ({done}) => {
		for (const d of done)
			if (d.end === null || !d.end.ok || d.end.at > d.save.drop + BACK_WITHIN)
				return `a save in a ${d.save.drop} ms drop ${shown(d)}: wanted it to land within ${BACK_WITHIN} ms of the network coming back`;
		return null;
	},
};

const LAWS: readonly Law[] = [landsOnce, waitsOut];
/**
 * Laws the real journal breaks, each run as a known failure for its reason. The journal gave up
 * after 20 tries, 50 ms apart, about a second, until lane 18: then `waitsOut` moved.
 */
const BUGS: readonly (readonly [Law, RegExp])[] = [];

const messageOf = (e: unknown): string =>
	e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);

const PLANTS: Record<string, () => Promise<Mod>> = {
	// Each try a new id: a resend of a save that landed is a second save at the same rev.
	idPerTry: () =>
		plant(
			"ledger.append(o.stream, expected, event, o.fence)",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: the text of a planted line; its `${...}` is that line's own template
			"ledger.append(o.stream, expected, {...event, id: `${event.id}:${tries}`}, o.fence)",
		),
	// No answer is taken for a refusal: the first drop ends the save.
	noResend: () => plant("if (tries >= 20) {", "if (tries >= 1) {"),
};

describe("the journal's laws for a short drop (lane 18, part 2)", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", async (_, law) => {
		await assertLaw(law, real);
	});

	it.each(BUGS.map(([law, how]) => [law.name, law, how] as const))(
		"known bug: %s",
		async (_, law, how) => {
			const e = await assertLaw(law, real).then(
				() => null,
				(x: unknown) => x,
			);
			expect(e).toBeInstanceOf(Error);
			expect(messageOf(e)).toMatch(how);
		},
	);

	it("each law is seen to fail on a planted mistake, and only the laws it should", async () => {
		const caught: Record<string, readonly string[]> = {};
		for (const [name, make] of Object.entries(PLANTS)) {
			const mod = await make();
			const out: string[] = [];
			for (const law of LAWS) {
				const failed = await assertLaw(law, mod).then(
					() => false,
					() => true,
				);
				if (failed) out.push(law.name);
			}
			caught[name] = out;
		}
		expect(caught).toEqual({idPerTry: [landsOnce.name], noResend: [landsOnce.name]});
	});
});
