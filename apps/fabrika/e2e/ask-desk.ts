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
const check = (what: string, yes: boolean, seen?: unknown) => {
	if (!yes) throw new Error(`${what}: ${JSON.stringify(seen)}`);
	console.log(`ok  ask desk ${what}`);
};
const until = async <A>(what: string, read: () => Promise<A>, ok: (value: A) => boolean) => {
	let value = await read();
	for (let i = 0; i < 200 && !ok(value); i++) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		value = await read();
	}
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
			const ask = yield* seal({...DRAFT, ask: id, rec}, policyFor(id, hidden, blindDraw));
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
	await page.addScriptTag({content: bundle.outputFiles[0]?.text ?? ""});
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
		await page.keyboard.press("n");
		const note = first.getByRole("textbox", {name: /note/i});
		await note.waitFor();
		check(
			"P24 n focuses the required note",
			await note.evaluate((e) => e === document.activeElement),
		);
		await page.keyboard.type("yonh");
		check("P14 letter keys type in a note", (await note.inputValue()) === "yonh");
		check("P14 typing never answers", (await answers(home, 117)).length === 0);
		await page.keyboard.press("Escape");
		check(
			"P24 Escape closes the note before leaving the ask",
			(await note.count()) === 0 && (await first.isVisible()),
		);
		await button(first, "Every pick").click();
		await first
			.getByRole("button", {name: /approve/i})
			.last()
			.waitFor();
		await page.keyboard.press("Escape");
		check("P24 every pick closes one level", await first.isVisible());
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
		await button(first, "Agent could work it out").click();
		await clickRec(first);
		await until(
			"P15 click records rec",
			() => answers(home, 117),
			(a) => a.length === 1,
		);
		check("P17 false survives the window write", (await answers(home, 117))[0]?.needed === false);
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
		await seedAsk(home, 118, false, DRAFT.rec, "a-approve-118-next");
		await box(page).waitFor();
		await page.keyboard.down("r");
		await page.keyboard.press("o");
		await box(page)
			.getByRole("button", {name: /approve/i})
			.last()
			.waitFor();
		check(
			"P13 repeated keydown cannot answer the next ask",
			(await answers(home, 118)).length === 1,
		);
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
		await tools.prompted(page, "t3");
		await tools.focusOn(page, "t2");
		await tools.prefixed(page, "-");
		await tools.prompted(page, "t4");
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
							? ["t1", "t3"]
							: ["t1", "t3", "t2", "t4"];
			for (const id of ["t2", "t3", "t4"]) {
				const shown = (await page.locator(`[data-tile="${id}"]`).count()) > 0;
				if (shown !== visible.includes(id)) {
					if (shown) {
						await tools.focusOn(page, id);
						await tools.prefixed(page, "f");
					} else await page.locator(`[data-strip="${id}"]`).click();
				}
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
				await inspectCard(page, box(page), look);
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
				await shot(page, "no-rec", layout, look);
				await page.keyboard.press("Control+c");
				await tools.prompted(page, "t1");
				await tools.run(page, "t1", "ticket --ticket 118");
				await box(page).waitFor();
				await shot(page, "shown", layout, look);
				for (const [name, state] of [
					["Needed me", "needed-true"],
					["Agent could work it out", "needed-false"],
				]) {
					await button(box(page), name ?? "").click();
					await shot(page, state ?? "", layout, look);
				}
				await button(box(page), "Agent could work it out").click();
				await button(box(page), "Every pick").click();
				await shot(page, "every-pick", layout, look);
				await page.keyboard.press("Escape");
				await button(box(page), "Not the rec").click();
				await shot(page, "required-note", layout, look);
				await page.keyboard.press("Escape");
				await box(page).focus();
				await page.keyboard.press("Space");
				await shot(page, "evidence-open", layout, look);
				await inspectCard(page, box(page), look);
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
				const draft = box(page).getByRole("textbox", {name: /note/i});
				await draft.fill("The plan misses the empty input");
				// Hold a real competing write lock. The host must expose pending, then failure.
				// This changes no app code, response, clock or product export.
				const locked = new DatabaseSync(join(home, "ledger.sqlite"));
				locked.exec("BEGIN IMMEDIATE");
				try {
					await draft.press("Enter");
					await page.locator('[data-tile="t1"] [aria-busy="true"]').waitFor();
					await shot(page, "saving", layout, look);
					await box(page).getByRole("alert").waitFor();
					check(
						"P12 failed real write keeps the note",
						(await draft.inputValue()) === "The plan misses the empty input",
					);
					await shot(page, "failed-save", layout, look);
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
		await writeFile(
			join(dir, "capture-record.json"),
			JSON.stringify(
				{
					version: "today",
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
const inspectCard = async (page: Page, where: Locator, look: "dark" | "light") => {
	await inspectLook(page, where, look);
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
};
