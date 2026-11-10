// P14, next/ (Tier 1, ticket 286): check 2 and p17, on the real stage with real Chromium: two windows
// mirror, an offline press lands once, a narrow tab folds locally, and every named kill recovers
// (docs/plan "Browser checks, measurements and shots"). Written before the window, so each test is
// red until the built page exists. It kills real OS processes under the stage and reads the saved
// ledger afterward: one line per letter, never only a final visible count. Run it with:
//   nice -n 19 pnpm exec vitest run --maxWorkers=1 --root next/apps/fabrika/e2e --fileParallelism=false \
//     --testTimeout=120000 --hookTimeout=120000 window-recovery.test.ts
// Each kill is its own case, run five times; "the whole sequence" runs them all in one stage life,
// five times. `held restart` here is a second kill while the first restart is still being held back.
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {
	cleanup,
	connection,
	counts,
	grant,
	ledgerRows,
	openProfile,
	pause,
	press,
	startStage,
	summary,
	timed,
	until,
	samples,
	type Stage,
	type Tab,
} from "./p14.test-support.ts";

let stage: Stage;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
	stage = await startStage("p14-recover");
}, 180_000);

afterAll(async () => {
	for (const close of closers.splice(0)) {
		await close().catch(() => undefined);
	}

	await stage?.stop();
	process.stdout.write(`${summary()}\n`);

	if (stage !== undefined) {
		cleanup(stage.home);
	}
});

/** A separately granted browser context with one tab on the stage. */
const window = async (
	query = "",
	size = {width: 1280, height: 800},
): Promise<{
	tab: Tab;
	context: import("playwright").BrowserContext;
	close: () => Promise<void>;
}> => {
	const p = await openProfile();
	closers.push(p.close);
	const tab = await p.tab(`${stage.url}/${query}`, size);
	await grant(stage, tab);
	return {tab, context: p.context, close: p.close};
};

const first = async (tab: Tab): Promise<number> => (await counts(tab.page))[0] ?? Number.NaN;

const settled = (tab: Tab, n: number, ms = 60_000) =>
	until(
		`the first count to read ${n}`,
		async () => ((await first(tab)) === n ? true : undefined),
		ms,
	);

/** The inbox lines the stage saved for the counters: one `send` per letter, each id once. */
const letters = (): ReadonlyArray<string> =>
	ledgerRows(stage.home)
		.filter((r) => r.tag === "send" && r.stream.endsWith("/inbox"))
		.map((r) => r.id);

const expectOnePerLetter = (accepted: number): void => {
	const ids = letters();
	expect(new Set(ids).size, "no letter is saved twice").toBe(ids.length);
	expect(ids.length, "every accepted letter is saved once").toBe(accepted);
};

let accepted = 0; // presses made so far, which the saved ledger must hold exactly

describe("two windows mirror, press by press, and every press is measured", () => {
	it("scenario: a press shows in its own tab and the other window, five times", async () => {
		const a = await window();
		const b = await window();
		// Every case on this stage presses counter:1, so each counts from the value it starts at.
		const base = await first(a.tab);

		for (let n = 1; n <= 5; n++) {
			await timed("same-tab click", async () => {
				await press(a.tab.page, "Add one", 0);
				await settled(a.tab, base + n);
			});
			accepted++;
			await timed("other-tab click", () => settled(b.tab, base + n));
			expect(await counts(b.tab.page)).toEqual(await counts(a.tab.page));
		}

		await until(
			"the ledger to hold the five",
			() => (letters().length === accepted ? true : undefined),
			20_000,
		);
		expectOnePerLetter(accepted);
		samples["bundle bytes"] = [
			Buffer.byteLength(await (await fetch(`${stage.url}/window.js`)).text()),
		];
	});

	it("scenario: a narrow tab folds locally; the other window and the saved layout keep every tile", async () => {
		const wide = await window("?layout=grid");
		const narrow = await window("?layout=grid", {width: 700, height: 500});
		const all = await wide.tab.page.getByRole("region", {name: /^counter/i}).count();
		const some = await narrow.tab.page.getByRole("region", {name: /^counter/i}).count();
		expect(all).toBe(4);
		expect(some, "the narrow tab folds what does not fit").toBeLessThan(4);
		expect(some).toBeGreaterThan(0);
		await narrow.tab.page.setViewportSize({width: 1280, height: 800});
		await until("the tiles to unfold", async () =>
			(await narrow.tab.page.getByRole("region", {name: /^counter/i}).count()) === 4
				? true
				: undefined,
		);
		expect(
			await wide.tab.page.getByRole("region", {name: /^counter/i}).count(),
			"another tab's size never changes this one",
		).toBe(4);
	});
});

describe("an offline press lands once", () => {
	it("scenario: three presses while the browser is offline wait, show in the queue, and land once each", async () => {
		const a = await window();
		const b = await window();
		const base = await first(a.tab);
		await a.context.setOffline(true);
		await until("the frame to say offline", async () =>
			/offline|reconnecting/i.test(await connection(a.tab.page)) ? true : undefined,
		);

		for (let n = 0; n < 3; n++) {
			await press(a.tab.page, "Add one", 0);
		}

		accepted += 3;
		await expect
			.poll(() => a.tab.page.getByTestId("queue").innerText(), {timeout: 30_000})
			.toMatch(/3/);
		expect(await first(b.tab), "nothing reached the other window yet").toBe(base);
		await a.context.setOffline(false);
		await settled(a.tab, base + 3);
		await settled(b.tab, base + 3);
		await until("the queue to empty", async () =>
			(await a.tab.page.getByTestId("queue").innerText()).match(/\d+/)?.[0] === "0"
				? true
				: undefined,
		);
		expectOnePerLetter(accepted);
	});
});

type Kill = {
	readonly name: string;
	readonly run: (s: Stage) => Promise<void>;
	readonly label: string;
};

const workerd = (s: Stage) => {
	// edge: finds workerd with `ps` under the stage, since Alchemy's runtime has no form to list or crash it from outside, not reported, 0042 amendment 2026-11-09
	const found = s.processes().find((p) => /workerd/.test(p.command));

	if (found === undefined) {
		throw new Error(
			`no workerd under the stage: ${s
				.processes()
				.map((p) => p.command.slice(0, 60))
				.join(" | ")}`,
		);
	}

	return found.pid;
};

const KILLS: ReadonlyArray<Kill> = [
	{
		name: "workerd is killed",
		label: "loss detection",
		// edge: kills workerd by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
		run: async (s) => s.kill(workerd(s), "SIGKILL"),
	},
	{
		name: "the stage parent is killed and started again",
		label: "restart",
		run: async (s) => {
			// edge: kills the local stage's parent by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
			s.kill(s.parent(), "SIGKILL");
			await pause(1_000);
			await s.start();
		},
	},
	{
		name: "a restart is held back by a second kill",
		label: "reconnect",
		run: async (s) => {
			// edge: kills workerd by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
			s.kill(workerd(s), "SIGKILL");
			await pause(300);

			try {
				// edge: kills the restarted workerd by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
				s.kill(workerd(s), "SIGKILL");
			} catch {
				/* the first restart has not made a new one yet */
			}
		},
	},
	{
		name: "a hung brain is stopped and continued",
		label: "hang detection",
		run: async (s) => {
			const pid = workerd(s);
			// edge: stops workerd by signal to hang the brain, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
			s.kill(pid, "SIGSTOP");
			await pause(8_000);
			// edge: continues the stopped workerd by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
			s.kill(pid, "SIGCONT");
		},
	},
	{
		name: "the whole stage stops and starts on the same home",
		label: "full restart",
		run: async (s) => {
			await s.stop();
			await s.start();
		},
	},
];

/** One kill, with a press made during the outage and one after: all must be counted, once. */
const survive = async (kill: Kill): Promise<void> => {
	const a = await window();
	const b = await window();

	try {
		await recover(kill, a, b);
	} finally {
		await a.close().catch(() => undefined);
		await b.close().catch(() => undefined);
	}
};

const recover = async (
	kill: Kill,
	a: Awaited<ReturnType<typeof window>>,
	b: Awaited<ReturnType<typeof window>>,
): Promise<void> => {
	const base = await first(a.tab);
	await press(a.tab.page, "Add one", 0);
	accepted++;
	await settled(b.tab, base + 1);
	await timed(kill.label, async () => {
		await kill.run(stage);
		await press(a.tab.page, "Add one", 0); // pressed in the outage when there is one: it waits and resends
		accepted++;
		await settled(a.tab, base + 2, 100_000);
		await settled(b.tab, base + 2, 100_000);
	});
	await until(
		"the ledger to hold every accepted letter",
		() => (letters().length === accepted ? true : undefined),
		30_000,
	);
	expectOnePerLetter(accepted);
};

describe("every named kill recovers, five times each", () => {
	for (const kill of KILLS) {
		for (let n = 1; n <= 5; n++) {
			it(`scenario: ${kill.name} (run ${n} of 5)`, () => survive(kill));
		}
	}
});

describe("the whole recovery sequence, five times", () => {
	for (let n = 1; n <= 5; n++) {
		it(`scenario: every kill in turn on one stage life (run ${n} of 5)`, async () => {
			for (const kill of KILLS) {
				await survive(kill);
			}
		});
	}
});
