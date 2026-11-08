import {createHash} from "node:crypto";
import {mkdir, mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Ledger, streams} from "@kampus/fabrika-old";
import {layerSqliteSync} from "@kampus/fabrika-old/sqlite";
import {blindDraw, sealAsk} from "@kampus/pipeline/tickets/ask";
import {nameOf} from "@kampus/pipeline/tickets/ticket";
import {Effect} from "effect";
import {build} from "esbuild";
import type {ElectronApplication, Locator, Page} from "playwright";
import {
	CANONICAL_INPUT,
	CANONICAL_TEXT,
	DRAFT,
	FILED,
	HEAD,
	NONE,
	policyFor,
	type Sealed,
} from "../../../fixtures/ask-desk/cases.ts";

// Today's app. The amendment excludes a new inbox, glance, Open all and content-tile placement.
// Run only on purpose through e2e.ts --ask-desk; never through Vitest. No agent or key is needed.
type Tools = {
	launch: (home: string) => Promise<ElectronApplication>;
	prompted: (page: Page, tile: string) => Promise<unknown>;
	run: (page: Page, tile: string, line: string) => Promise<unknown>;
	prefixed: (page: Page, key: string) => Promise<unknown>;
	focusOn: (page: Page, tile: string) => Promise<unknown>;
	tilesAre: (page: Page, ids: string[]) => Promise<unknown>;
	lookIs: (app: ElectronApplication, page: Page, look: "dark" | "light") => Promise<unknown>;
	hostPid: (home: string) => Promise<number | null>;
	stop: (pid: number) => Promise<unknown>;
	shots: string;
};
// ASK_DESK_SOFT=1 logs a failed check and goes on, so the shots still get taken; the run then
// lists every failure and exits nonzero. Without it, the first failure stops the run.
const soft = process.env.ASK_DESK_SOFT === "1";
const failed: string[] = [];
let watched: Page | null = null;
let failShots: string | null = null;
const check = (what: string, yes: boolean, seen?: unknown) => {
	if (!yes && !soft) throw new Error(`${what}: ${JSON.stringify(seen)}`);
	if (!yes) {
		failed.push(`${what}: ${JSON.stringify(seen)}`);
		// What the window showed when the check failed, beside the shots, for whoever reads them.
		if (watched !== null && failShots !== null)
			void watched
				.screenshot({path: join(failShots, `failed-${failed.length}.png`)})
				.catch(() => {});
	}
	console.log(`${yes ? "ok  " : "FAIL"} ask desk ${what}`);
};
// In soft mode, a step that throws (a wait that times out) is a failed check, and the run goes on.
const attempt = (what: string, step: () => Promise<unknown>) => {
	if (!soft) return step();
	return step().catch(async (e: unknown) => {
		if (watched !== null && failShots !== null)
			await watched
				.screenshot({path: join(failShots, `${what.replaceAll(/[^a-z0-9]+/gi, "-")}.png`)})
				.catch(() => {});
		check(what, false, e instanceof Error ? e.message.split("\n")[0] : e);
	});
};
const until = async <A>(what: string, read: () => Promise<A>, ok: (value: A) => boolean) => {
	let value = await read();
	for (let i = 0; i < 200 && !ok(value); i++) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		value = await read();
	}
	if (!ok(value) && watched !== null && failShots !== null)
		await watched
			.screenshot({path: join(failShots, `${what.replaceAll(/[^a-z0-9]+/gi, "-")}.png`)})
			.catch(() => {});
	check(what, ok(value), value);
	return value;
};
const seal: (draft: unknown, policy: {seed: number}) => Effect.Effect<Sealed, unknown> = sealAsk;
const on = <A, E>(home: string, program: Effect.Effect<A, E, Ledger>) =>
	Effect.runPromise(
		program.pipe(
			Effect.provide(layerSqliteSync({path: join(home, "ledger.sqlite")})),
			Effect.scoped,
		),
	);
const seedAsk = (
	home: string,
	ticket: number,
	hidden = false,
	rec: unknown = DRAFT.rec,
	id = `a-approve-${ticket}`,
) =>
	on(
		home,
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const inbox = streams(nameOf(ticket)).inbox;
			yield* ledger.register(nameOf(ticket), "user:owner");
			yield* ledger.send(inbox, "file", {kind: "filed", writer: "user:owner", data: FILED});
			yield* ledger.send(inbox, "plan/2", {
				kind: "planned",
				writer: "agent:lane for:owner",
				data: {type: "planned", version: 2, tasks: []},
			});
			// A blind ask is a step's: an approve ask is never drawn blind (review 2, medium 2).
			const draft = {...DRAFT, ask: id, rec, ...(hidden ? {for: "step"} : {})};
			const ask = yield* seal(draft, policyFor(id, hidden, blindDraw));
			yield* ledger.send(inbox, id, {kind: "asked", writer: "agent:lane for:owner", data: ask});
			return ask;
		}),
	);
const answers = (home: string, ticket: number) =>
	on(
		home,
		Effect.gen(function* () {
			const all = yield* (yield* Ledger).readStream(streams(nameOf(ticket)).inbox);
			return all
				.filter((r) => r.kind === "answered")
				.map((row): Record<string, unknown> => JSON.parse(row.data));
		}),
	);
const seedFacts = (
	home: string,
	ticket: number,
	facts: readonly {readonly type: string; readonly [key: string]: unknown}[],
) =>
	on(
		home,
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const inbox = streams(nameOf(ticket)).inbox;
			yield* ledger.register(nameOf(ticket), "user:owner");
			for (const [i, fact] of [FILED, ...facts].entries())
				yield* ledger.send(inbox, `state/${i}`, {
					kind: fact.type,
					writer: i === 0 ? "user:owner" : "agent:lane for:owner",
					data: fact,
				});
		}),
	);
const box = (page: Page, tile = "t1") =>
	page
		.locator(`[data-tile="${tile}"]`)
		.getByRole("region", {name: `ask: ${DRAFT.what}`, exact: true});
const button = (where: Locator, name: string) =>
	where.getByRole("button", {name: new RegExp(`^${name}`)});
const focusIn = (where: Locator) =>
	where.evaluate((element) => element.contains(document.activeElement));
const clickRec = (where: Locator) => button(where, "Take rec").click();

const browserHash = async (page: Page) => {
	const bundle = await build({
		stdin: {
			contents:
				'import {hash} from "@kampus/fabrika-old"; import {Effect} from "effect"; export const digest = value => Effect.runPromise(hash(value));',
			resolveDir: import.meta.dirname,
		},
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
		globalName: "askDeskHash",
	});
	// The page's CSP refuses inline script tags; Playwright's evaluate runs over CDP, outside it.
	await page.evaluate(bundle.outputFiles[0]?.text ?? "");
	const seen = await page.evaluate(async (value) => {
		const api = Reflect.get(window, "askDeskHash") as {digest: (v: unknown) => Promise<string>};
		return api.digest(value);
	}, CANONICAL_INPUT);
	check(
		"P3 Chromium matches the independent RFC/Node hash",
		seen === `sha256:${createHash("sha256").update(CANONICAL_TEXT).digest("hex")}`,
		seen,
	);
};

export const askDesk = async (tools: Tools) => {
	const home = await mkdtemp(join(tmpdir(), "ad-"));
	const dir = join(tools.shots, "ask-desk");
	await mkdir(dir, {recursive: true});
	// Exercise remapping and unbinding through the same file a person edits.
	await writeFile(
		join(home, "keybindings.toml"),
		'program.ask.rec = "r"\nprogram.ask.later = []\n',
	);
	await seedAsk(home, 117);
	await seedAsk(home, 118);
	await seedAsk(home, 119, true);
	await seedAsk(home, 120, false, NONE);
	await seedAsk(home, 124);
	await seedFacts(home, 121, [
		{type: "started", run: "r-build-121", stage: "build", task: null, log: null},
	]);
	await seedFacts(home, 122, [{type: "stopped", why: "read_failed", resume: "review"}]);
	await seedFacts(home, 123, [
		{
			type: "pr",
			url: "https://github.com/fixture/project/pull/1",
			state: "merged",
			head: HEAD,
			checks: [],
		},
	]);
	const app = await tools.launch(home);
	const captured: string[] = [];
	let failedTicket = 130;
	const shot = async (page: Page, state: string, layout: string, look: string) => {
		const file = `${state}-${layout}-${look}.png`;
		await page.screenshot({path: join(dir, file)});
		captured.push(file);
	};
	try {
		const page = await app.firstWindow();
		watched = page;
		failShots = soft ? join(tools.shots, "ask-desk-failed") : null;
		if (failShots !== null) await mkdir(failShots, {recursive: true});
		await tools.prompted(page, "t1");
		await browserHash(page);
		await tools.run(page, "t1", "ticket --ticket 117");
		await box(page).waitFor();
		const first = box(page);
		await first.focus();
		check(
			"P14 remapped keycap matches aria-keyshortcuts",
			(await button(first, "Take rec").getAttribute("aria-keyshortcuts")) === "r",
		);
		await page.keyboard.press("y");
		check("P14 the old key is unbound", (await answers(home, 117)).length === 0);
		check("P17 E: no mark before a pick", (await marksIn(first)) === 0, await marksIn(first));
		check("P23 E: Recommended once before a pick", (await recommendedIn(first)) === 1);
		await page.keyboard.press("n");
		const note = first.getByRole("textbox");
		await note.waitFor();
		check(
			"P24 n focuses the required note",
			await note.evaluate((e) => e === document.activeElement),
		);
		await page.keyboard.type("yonh");
		check("P14 letter keys type in a note", (await note.inputValue()) === "yonh");
		check("P14 typing never answers", (await answers(home, 117)).length === 0);
		check("P17 E: the marks show once a pick is in hand", (await marksIn(first)) === 2);
		check("P23 E: Recommended once with the note open", (await recommendedIn(first)) === 1);
		await button(first, "Needed me").click();
		check(
			"P17 true mark",
			(await button(first, "Needed me").getAttribute("aria-pressed")) === "true",
		);
		await button(first, "Needed me").click();
		check(
			"P17 clear mark",
			(await button(first, "Needed me").getAttribute("aria-pressed")) === "false",
		);
		await button(first, "Needed me").click();
		await note.focus();
		await page.keyboard.press("Escape");
		check(
			"P24 Escape closes the note before leaving the ask",
			(await note.count()) === 0 && (await first.isVisible()),
		);
		check("P17 E: the marks go with the pick", (await marksIn(first)) === 0);
		await button(first, "Every pick").click();
		await first
			.getByRole("button", {name: /approve/i})
			.last()
			.waitFor();
		check("P17 E: every pick open is not a pick, so no mark", (await marksIn(first)) === 0);
		check("P23 E: Recommended once with every pick open", (await recommendedIn(first)) === 1);
		await page.keyboard.press("Escape");
		check("P24 every pick closes one level", await first.isVisible());
		await clickRec(first);
		await until(
			"P15 click records rec",
			() => answers(home, 117),
			(a) => a.length === 1,
		);
		check(
			"P17 E: a mark left with its pick never rides on the rec",
			!Object.hasOwn((await answers(home, 117))[0] ?? {}, "needed"),
			(await answers(home, 117))[0],
		);
		check(
			"P24 answer is politely announced",
			(await page
				.getByRole("status")
				.filter({hasText: /approved/i})
				.count()) === 1,
		);
		check(
			"P24 the answer keeps focus in its component",
			await focusIn(page.locator('[data-tile="t1"]')),
		);

		// The mark rides with a picked answer: n, Agent could work it out, a note, Enter.
		await page.keyboard.press("Control+c");
		await tools.prompted(page, "t1");
		await tools.run(page, "t1", "ticket --ticket 124");
		await box(page).waitFor();
		await button(box(page), "Not the rec").click();
		await box(page).getByRole("textbox").fill("The plan misses the empty input");
		await button(box(page), "Agent could work it out").click();
		await box(page).getByRole("textbox").press("Enter");
		const marked = await until(
			"P17 a marked pick saves",
			() => answers(home, 124),
			(a) => a.length === 1,
		);
		check(
			"P17 false survives the window write",
			marked[0]?.needed === false &&
				(marked[0]?.answer as Record<string, unknown> | undefined)?._tag === "against" &&
				(marked[0]?.answer as Record<string, unknown> | undefined)?.note ===
					"The plan misses the empty input",
			marked[0],
		);

		await page.keyboard.press("Control+c");
		await tools.prompted(page, "t1");
		await tools.run(page, "t1", "ticket --ticket 118");
		await box(page).waitFor();
		await box(page).focus();
		await page.keyboard.down("r");
		await until(
			"P13 first held press answers",
			() => answers(home, 118),
			(a) => a.length === 1,
		);
		await attempt("P13 the next ask shows every pick under a held key", async () => {
			await seedAsk(home, 118, false, DRAFT.rec, "a-approve-118-next");
			await box(page).waitFor();
			await page.keyboard.down("r");
			await page.keyboard.press("o");
			await box(page)
				.getByRole("button", {name: /approve/i})
				.last()
				.waitFor({timeout: 5000});
			check(
				"P13 repeated keydown cannot answer the next ask",
				(await answers(home, 118)).length === 1,
			);
		});
		await page.keyboard.up("r");
		await page.keyboard.press("Escape");
		const click = (await answers(home, 117))[0];
		const key = (await answers(home, 118))[0];
		check(
			"P15 click and key resolve to the same answer",
			JSON.stringify(click?.answer) === '{"_tag":"rec"}' &&
				JSON.stringify(click?.answer) === JSON.stringify(key?.answer),
		);
		check(
			"P15 remapped actual key is recorded",
			(key?.via as {took?: {key: string}})?.took?.key === "r",
		);

		await page.keyboard.press("Control+c");
		await tools.prompted(page, "t1");
		await tools.run(page, "t1", "ticket --ticket 119");
		await box(page).waitFor();
		check(
			"P8 blind ask has no Take rec button, including hidden DOM",
			(await box(page)
				.getByRole("button", {name: /take rec/i, includeHidden: true})
				.count()) === 0,
		);
		check(
			"P8 blind rec does not leak through DOM or accessible text",
			!(await box(page).ariaSnapshot()).includes(DRAFT.rec.why) &&
				!(await box(page).innerHTML()).includes(DRAFT.rec.why),
		);
		check("P23 E: a blind ask never says Recommended", (await recommendedIn(box(page))) === 0);
		check("P17 E: a blind ask offers no mark before a pick", (await marksIn(box(page))) === 0);
		await tools.prefixed(page, "|");
		await tools.prompted(page, "t2");
		await tools.run(page, "t2", "tracker | ticket");
		// The tracker and old asks menu read the same sealed ask, never redraw the blind draw.
		await tools.prefixed(page, "a");
		const menu = page.locator("#pop-asks");
		await menu.waitFor();
		await menu.getByText(DRAFT.what, {exact: true}).first().waitFor();
		check(
			"P10 old asks menu uses the shared answer controls",
			(await menu.getByRole("button", {name: /every pick/i}).count()) > 0,
		);
		const views = menu.getByRole("region", {name: /^ask: /});
		const said: number[] = [];
		for (let i = 0; i < (await views.count()); i++) said.push(await recommendedIn(views.nth(i)));
		check(
			"P23 E: each ask in the menu says Recommended once at most",
			said.every((n) => n <= 1),
			said,
		);
		check("P17 E: the menu offers no mark before a pick", (await marksIn(menu)) === 0);
		const selected = menu.getByRole("row", {selected: true});
		check("P24 selection has a supported row role", (await selected.count()) === 1);
		const before = await selected.textContent();
		await page.keyboard.press("ArrowDown");
		check(
			"P24 an arrow changes the selected row",
			(await menu.getByRole("row", {selected: true}).textContent()) !== before,
		);
		await page.keyboard.press("Escape");

		// P23/P24 captures: real ticket and tracker, both themes, all five required layouts.
		// No new inbox, new glance or content-opening screenshots are required by this PR.
		await tools.focusOn(page, "t1");
		await tools.prefixed(page, "-");
		// `tracker | ticket` took t2 and t3, so the two splits are t4 (under t1) and t5 (under t2).
		await tools.prompted(page, "t4");
		await tools.focusOn(page, "t2");
		await tools.prefixed(page, "-");
		await tools.prompted(page, "t5");
		await tools.focusOn(page, "t1");
		const layouts = ["one", "side", "stacked", "2x2", "small"] as const;
		for (const layout of layouts) {
			// Fold existing tiles to create each shape; running work stays alive.
			const visible =
				layout === "one"
					? ["t1"]
					: layout === "side"
						? ["t1", "t2"]
						: layout === "stacked"
							? ["t1", "t4"]
							: ["t1", "t4", "t2", "t5"];
			// Open every strip first: a column whose tiles all folded is one strip named by the
			// column, not by a tile, so a tile's own strip may not exist.
			const strips = page.locator("[data-strip]").filter({visible: true});
			// A strip may still be sliding into place, so press it in the page, not by its position.
			for (let i = 0; i < 8 && (await strips.count()) > 0; i++) {
				await strips.first().evaluate((element) => (element as HTMLElement).click());
				await page.waitForTimeout(300);
			}
			for (const id of ["t1", "t2", "t3", "t4", "t5"])
				await page.locator(`[data-tile="${id}"]`).waitFor();
			for (const id of ["t2", "t3", "t4", "t5"]) {
				if (visible.includes(id)) continue;
				await tools.focusOn(page, id);
				await tools.prefixed(page, "f");
			}
			await tools.focusOn(page, "t1");
			await app.evaluate(
				({BrowserWindow}, size) =>
					BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height),
				layout === "small" ? {width: 1024, height: 700} : {width: 1440, height: 1000},
			);
			for (const look of ["dark", "light"] as const) {
				await tools.lookIs(app, page, look);
				await shot(page, "blind", layout, look);
				await inspectBar(page, box(page));
				await inspectCard(page, box(page));
				// Today's asks menu, drawn with the shared ask view.
				await attempt("P10 the asks menu opens", async () => {
					await tools.prefixed(page, "a");
					await page.locator("#pop-asks").getByText(DRAFT.what, {exact: true}).first().waitFor();
					// The menu fades in: the shot waits for it to finish, so it shows the menu as it stays.
					await page
						.locator("#pop-asks")
						.evaluate((menu) => Promise.all(menu.getAnimations().map((a) => a.finished)));
					await shot(page, "asks-menu", layout, look);
					await page.keyboard.press("Escape");
				});
				await page.keyboard.press("Control+c");
				await tools.prompted(page, "t1");
				await tools.run(page, "t1", "ticket --ticket 120");
				await box(page).waitFor();
				check(
					"P8 no-rec ask has no Take rec",
					(await box(page)
						.getByRole("button", {name: /take rec/i})
						.count()) === 0,
				);
				check("P23 E: a no-rec ask never says Recommended", (await recommendedIn(box(page))) === 0);
				await shot(page, "no-rec", layout, look);
				await page.keyboard.press("Control+c");
				await tools.prompted(page, "t1");
				await tools.run(page, "t1", "ticket --ticket 118");
				await box(page).waitFor();
				await shot(page, "shown", layout, look);
				check("P17 E: no mark before a pick", (await marksIn(box(page))) === 0);
				check("P23 E: Recommended once", (await recommendedIn(box(page))) === 1);
				await inspectBar(page, box(page));
				await button(box(page), "Every pick").click();
				await shot(page, "every-pick", layout, look);
				check("P17 E: every pick open offers no mark", (await marksIn(box(page))) === 0);
				check(
					"P23 E: Recommended once with every pick open",
					(await recommendedIn(box(page))) === 1,
				);
				await inspectBar(page, box(page));
				await inFlow(
					"P23 E: every pick opens under the bar in normal flow",
					box(page),
					box(page)
						.getByRole("button", {name: /\bno\b/i})
						.last(),
				);
				await page.keyboard.press("Escape");
				await button(box(page), "Not the rec").click();
				await shot(page, "required-note", layout, look);
				check("P17 E: the marks show once a pick is in hand", (await marksIn(box(page))) === 2);
				check("P23 E: Recommended once with the note open", (await recommendedIn(box(page))) === 1);
				await inspectBar(page, box(page));
				await inFlow(
					"P23 E: the note opens under the bar in normal flow",
					box(page),
					box(page).getByRole("textbox"),
				);
				for (const [name, state] of [
					["Needed me", "needed-true"],
					["Agent could work it out", "needed-false"],
				] as const) {
					await button(box(page), name).click();
					await shot(page, state, layout, look);
				}
				await button(box(page), "Agent could work it out").click();
				await box(page).getByRole("textbox").focus();
				await page.keyboard.press("Escape");
				check("P17 E: the marks go with the pick", (await marksIn(box(page))) === 0);
				await box(page).focus();
				await page.keyboard.press("Space");
				await shot(page, "evidence-open", layout, look);
				await inspectBar(page, box(page));
				await inspectCard(page, box(page));
				for (const [ticket, state] of [
					[121, "running"],
					[122, "stuck"],
					[123, "done"],
				] as const) {
					await page.keyboard.press("Control+c");
					await tools.prompted(page, "t1");
					await tools.run(page, "t1", `ticket --ticket ${ticket}`);
					const card = page.locator('[data-tile="t1"]').getByRole("region", {name: "Whose turn"});
					await card.waitFor();
					await shot(page, state, layout, look);
					await inspectLook(page, card, look);
					if (state === "stuck")
						check(
							"P20 a stop has Open lane and no answer buttons",
							(await card.getByRole("button", {name: /open lane/i}).count()) === 1 &&
								(await card
									.getByRole("button", {name: /take rec|not the rec|every pick/i})
									.count()) === 0,
						);
				}
				await seedAsk(home, failedTicket);
				await page.keyboard.press("Control+c");
				await tools.prompted(page, "t1");
				await tools.run(page, "t1", `ticket --ticket ${failedTicket}`);
				await box(page).waitFor();
				await button(box(page), "Not the rec").click();
				const draft = box(page).getByRole("textbox");
				await draft.fill("The plan misses the empty input");
				// Hold a real competing write lock. The host must expose pending, then failure.
				// This changes no app code, response, clock or product export.
				const locked = new DatabaseSync(join(home, "ledger.sqlite"));
				locked.exec("BEGIN IMMEDIATE");
				try {
					await draft.press("Enter");
					await attempt("P12 a save shows it is pending", () =>
						page.locator('[data-tile="t1"] [aria-busy="true"]').waitFor({timeout: 5000}),
					);
					await shot(page, "saving", layout, look);
					await attempt("P12 a failed real write says so", async () => {
						await box(page).getByRole("alert").waitFor({timeout: 15000});
						check(
							"P12 failed real write keeps the note",
							(await draft.inputValue()) === "The plan misses the empty input",
						);
						const alert = await box(page).getByRole("alert").innerText();
						check(
							"P12 a failed save says it in a person's words, never the store's",
							!/database is locked|SQLITE|LedgerUnreachable/i.test(alert),
							alert,
						);
						await inFlow(
							"P23 E: a failed save opens under the bar in normal flow",
							box(page),
							box(page).getByRole("alert"),
						);
						check(
							"P23 E: Recommended once on a failed save",
							(await recommendedIn(box(page))) === 1,
						);
						await shot(page, "failed-save", layout, look);
					});
				} finally {
					locked.exec("ROLLBACK");
					locked.close();
				}
				check(
					"P12 failed real write records no answer",
					(await answers(home, failedTicket)).length === 0,
				);
				failedTicket++;
				await page.keyboard.press("Control+c");
				await tools.prompted(page, "t1");
				await tools.run(page, "t1", "ticket --ticket 119");
				await box(page).waitFor();
			}
		}
		for (const [i, choice] of [
			{hidden: false, note: undefined},
			{hidden: false, note: "Keep the empty input test."},
			{hidden: true, note: undefined},
			{hidden: true, note: "Keep the empty input test."},
		].entries()) {
			await attempt(`P8 optional chose note ${i}`, async () => {
				const ticket = 150 + i;
				await seedAsk(home, ticket, choice.hidden, choice.hidden ? DRAFT.rec : NONE);
				await page.keyboard.press("Control+c");
				await tools.prompted(page, "t1");
				await tools.run(page, "t1", `ticket --ticket ${ticket}`);
				const ask = box(page);
				await ask.waitFor();
				await button(ask, "Every pick").click();
				await ask
					.getByRole("button", {name: /\bapprove\b/i})
					.last()
					.click();
				const note = ask.getByRole("textbox");
				await note.waitFor();
				check("P17 E: the marks show once a pick is in hand", (await marksIn(ask)) === 2);
				check(
					"P23 E: Recommended is never said for a blind or no-rec ask",
					(await recommendedIn(ask)) === 0,
				);
				check("P8 a pick waits for its optional note", (await answers(home, ticket)).length === 0);
				check(
					"P8 the note is optional",
					await note.evaluate(
						(element) =>
							!element.hasAttribute("required") && element.getAttribute("aria-required") !== "true",
					),
				);
				check(
					"P24 the optional note takes focus",
					await note.evaluate((element) => element === document.activeElement),
				);
				if (choice.note !== undefined) await note.fill(choice.note);
				if (choice.hidden) {
					check(
						"P8 the blind rec stays hidden while entering a note",
						!(await ask.innerHTML()).includes(DRAFT.rec.why) &&
							!(await ask.ariaSnapshot()).includes(DRAFT.rec.why) &&
							(await ask.getByRole("button", {name: /take rec/i, includeHidden: true}).count()) ===
								0,
					);
				}
				await note.press("Enter");
				const saved = await until(
					"P8 Enter saves chose with or without a note",
					() => answers(home, ticket),
					(all) => all.length === 1,
				);
				const answer = saved[0]?.answer as Record<string, unknown>;
				check(
					"P22 the window records exactly the chose note supplied",
					answer._tag === "chose" &&
						answer.pick === "approve" &&
						answer.note === choice.note &&
						Object.hasOwn(answer, "note") === (choice.note !== undefined),
					answer,
				);
			});
		}
		await writeFile(
			join(dir, "capture-record.json"),
			JSON.stringify(
				{
					version: "today",
					look: "E: one quiet bar under the ticket title (owner, 2026-11-08)",
					madeUp: [
						"repository",
						"plan contents",
						"recommendations",
						"costs",
						"clocks",
						"ids except the historical ticket number and question",
					],
					screenshots: captured,
					inspection: "pending human inspection",
					voiceOver: "not run",
				},
				null,
				2,
			),
		);
	} finally {
		await app.close().catch(() => {});
		const pid = await tools.hostPid(home);
		if (pid !== null) await tools.stop(pid);
	}
	if (failed.length > 0) {
		console.log(
			`ask desk: ${failed.length} failed checks\n${failed.map((f) => `  ${f}`).join("\n")}`,
		);
		process.exitCode = 1;
	}
};

const inspectLook = async (page: Page, where: Locator, look: "dark" | "light") => {
	const style = await where.evaluate((element) => {
		const css = getComputedStyle(element);
		const edges = (node: Element) => {
			const s = getComputedStyle(node);
			return (
				[s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].some(
					(w) => Number.parseFloat(w) > 0,
				) || s.boxShadow !== "none"
			);
		};
		return {
			background: css.backgroundColor,
			radius: css.borderRadius,
			edge: edges(element),
			nestedEdges: [...element.querySelectorAll("section, article, fieldset")].some(edges),
			scrolls: document.documentElement.scrollWidth > innerWidth,
		};
	});
	check(
		"P23 one quiet card, 8px corners, no extra edges or page overflow",
		style.radius === "8px" &&
			style.background === (look === "dark" ? "rgb(33, 34, 37)" : "rgb(240, 240, 243)") &&
			!style.edge &&
			!style.nestedEdges &&
			!style.scrolls,
		style,
	);
	const properties = await page.locator('[data-tile="t1"] .props').evaluateAll((nodes) =>
		nodes.map((node) => {
			const css = getComputedStyle(node.parentElement ?? node);
			return {
				edge: [
					css.borderTopWidth,
					css.borderRightWidth,
					css.borderBottomWidth,
					css.borderLeftWidth,
				].some((w) => Number.parseFloat(w) > 0),
			};
		}),
	);
	check(
		"P23 properties keep their labels without an edge",
		properties.length > 0 && properties.every((p) => !p.edge),
		properties,
	);
};
/** How many times an ask's DOM text says Recommended, hidden text included (design E, fix 3). */
const recommendedIn = async (where: Locator) =>
	((await where.evaluate((element) => element.textContent ?? "")).match(/\brecommended\b/gi) ?? [])
		.length;
/** How many mark buttons an ask draws, hidden ones included (design E, fix 1). */
const marksIn = (where: Locator) =>
	where
		.getByRole("button", {name: /^(needed me|agent could work it out)/i, includeHidden: true})
		.count();
/** What opens under the bar stays in normal flow: nothing up to the ask is lifted out of it. */
const inFlow = async (what: string, where: Locator, target: Locator) => {
	const lifted = await target.evaluate((element) => {
		const out: string[] = [];
		const root = element.closest('[aria-label^="ask: "]');
		for (let node: Element | null = element; node !== null; node = node.parentElement) {
			const position = getComputedStyle(node).position;
			if (position !== "static" && position !== "relative") out.push(`${node.tagName} ${position}`);
			if (node === root) break;
		}
		return out;
	});
	check(what, lifted.length === 0 && (await where.isVisible()), lifted);
};
/**
 * Design E (owner, 2026-11-08): one quiet bar, no box around it, never pinned, and at most a
 * hairline under it (fix 2), focused or not. Its background is the tile's own, so no fill makes it
 * a card.
 */
const inspectBar = async (page: Page, where: Locator) => {
	const read = () =>
		where.evaluate((element) => {
			const css = getComputedStyle(element);
			const px = (w: string) => Number.parseFloat(w) || 0;
			const clear = (c: string) => c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
			let behind = "rgba(0, 0, 0, 0)";
			for (let node = element.parentElement; node !== null; node = node.parentElement) {
				const bg = getComputedStyle(node).backgroundColor;
				if (!clear(bg)) {
					behind = bg;
					break;
				}
			}
			const pinned: string[] = [];
			const tile = element.closest("[data-tile]");
			for (let node: Element | null = element; node !== null; node = node.parentElement) {
				const position = getComputedStyle(node).position;
				if (position === "sticky" || position === "fixed")
					pinned.push(`${node.tagName} ${position}`);
				if (node === tile) break;
			}
			const edges = (node: Element) => {
				const s = getComputedStyle(node);
				return (
					[s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].some(
						(w) => px(w) > 0,
					) || s.boxShadow !== "none"
				);
			};
			return {
				sides: [css.borderTopWidth, css.borderRightWidth, css.borderLeftWidth].map(px),
				under: px(css.borderBottomWidth),
				// Every length in the shadow: a 2px inset line under the bar is the thick line fix 2 drops.
				shadow: css.boxShadow === "none" ? [] : (css.boxShadow.match(/-?[\d.]+px/g) ?? []).map(px),
				background: css.backgroundColor,
				fill: !clear(css.backgroundColor) && css.backgroundColor !== behind,
				behind,
				pinned,
				nestedEdges: [...element.querySelectorAll("section, article, fieldset")].some(edges),
				scrolls: document.documentElement.scrollWidth > innerWidth,
			};
		});
	for (const focused of [false, true]) {
		if (focused) await where.focus();
		else
			await page
				.locator('[data-tile="t1"]')
				.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		const bar = await read();
		check(
			`P23 E: no box around the bar${focused ? ", focused" : ""}: no side edges, no fill`,
			bar.sides.every((w) => w === 0) && !bar.fill && !bar.nestedEdges,
			bar,
		);
		check(
			`P23 E: at most a hairline under the bar${focused ? ", focused" : ""}`,
			bar.under <= 1 && bar.shadow.every((l) => Math.abs(l) <= 1),
			bar,
		);
		check("P23 E: the bar scrolls with the ticket, never pinned", bar.pinned.length === 0, bar);
		check("P23 E: no page overflow", !bar.scrolls, bar);
	}
};
const inspectCard = async (page: Page, where: Locator) => {
	const toolbar = where.getByRole("toolbar");
	check("P24 toolbar is keyboard reachable", (await toolbar.count()) === 1);
	await toolbar.focus();
	await page.keyboard.press("ArrowRight");
	check("P24 toolbar arrows keep keyboard focus inside", await focusIn(toolbar));
	const reached = new Set<string>();
	for (let i = 0; i < 12; i++) {
		reached.add(
			await toolbar.evaluate((element) =>
				element.contains(document.activeElement) ? (document.activeElement?.textContent ?? "") : "",
			),
		);
		await page.keyboard.press("ArrowRight");
	}
	check(
		"P24 every-pick is reachable through toolbar arrows",
		[...reached].some((text) => /every pick/i.test(text)),
		[...reached],
	);
	// Design E: the marks come only with a pick, so take one that is not the rec first.
	await button(where, "Every pick").click();
	await where
		.getByRole("button", {name: /\bno\b/i})
		.last()
		.click();
	await where.getByRole("textbox").waitFor();
	await where.focus();
	for (let i = 0; i < 24; i++) {
		await page.keyboard.press("Tab");
		if (await button(where, "Needed me").evaluate((element) => element === document.activeElement))
			break;
	}
	check(
		"P24 a mark is reachable by Tab",
		await button(where, "Needed me").evaluate((element) => element === document.activeElement),
	);
	await page.keyboard.press("Space");
	check(
		"P24 Space sets the mark",
		(await button(where, "Needed me").getAttribute("aria-pressed")) === "true",
	);
	await page.keyboard.press("Space");
	check(
		"P24 Space clears the mark",
		(await button(where, "Needed me").getAttribute("aria-pressed")) === "false",
	);
	await page.keyboard.press("Escape");
	check("P17 E: Escape closes the pick and its marks", (await marksIn(where)) === 0);
};
