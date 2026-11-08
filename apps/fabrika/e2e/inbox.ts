import {chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {Ledger, streams} from "@kampus/fabrika-old";
import {layerSqliteSync} from "@kampus/fabrika-old/sqlite";
import {blindDraw, sealAsk} from "@kampus/pipeline/tickets/ask";
import {nameOf} from "@kampus/pipeline/tickets/ticket";
import {Effect} from "effect";
import type {ElectronApplication, Locator, Page} from "playwright";
import {DRAFT, FILED, policyFor} from "../../../fixtures/ask-desk/cases.ts";
import {MESSAGE} from "../../../fixtures/inbox/cases.ts";
import {
	cells,
	type Layout,
	layouts,
	type Look,
	looks,
	type State,
	shotName,
} from "../../../fixtures/inbox/shots.ts";
import {nativeAgent} from "./inbox-native.ts";

type Tools = {
	launch: (home: string) => Promise<ElectronApplication>;
	prompted: (page: Page, tile: string) => Promise<unknown>;
	run: (page: Page, tile: string, line: string) => Promise<unknown>;
	prefixed: (page: Page, key: string) => Promise<unknown>;
	focusOn: (page: Page, tile: string) => Promise<unknown>;
	lookIs: (app: ElectronApplication, page: Page, look: Look) => Promise<unknown>;
	hostPid: (home: string) => Promise<number | null>;
	stop: (pid: number) => Promise<unknown>;
	shots: string;
};
const check = (what: string, holds: boolean, saw?: unknown) => {
	if (!holds) throw new Error(`inbox ${what}: ${JSON.stringify(saw)}`);
	console.log(`ok  inbox ${what}`);
};
const until = async <A>(what: string, read: () => Promise<A>, yes: (a: A) => boolean) => {
	let value = await read();
	for (let n = 0; n < 200 && !yes(value); n++) {
		await new Promise((done) => setTimeout(done, 25));
		value = await read();
	}
	check(what, yes(value), value);
	return value;
};
const tileIds = (page: Page) =>
	page
		.locator("[data-tile]")
		.evaluateAll((all) => all.map((e) => e.getAttribute("data-tile") ?? ""));
const focus = (page: Page) =>
	page.locator('[data-tile][aria-current="true"]').getAttribute("data-tile");
const quick = (page: Page) => page.getByRole("region", {name: "inbox glance", exact: true});
const inbox = (page: Page) => page.getByRole("region", {name: "inbox", exact: true});
const grid = (where: Locator) => where.getByRole("grid");
const row = (where: Locator, text: string) => where.getByRole("row").filter({hasText: text});
const selected = (where: Locator) => where.locator('[role="row"][aria-selected="true"]');
const button = (where: Locator, name: string) =>
	where.getByRole("button", {name: new RegExp(`^${name}(?:\\b|$)`, "i")});
const reply = (where: Locator) => where.getByRole("textbox", {name: /reply/i});
const listFocused = (where: Locator) =>
	grid(where).evaluate(
		(e) =>
			e === document.activeElement ||
			(e.contains(document.activeElement) &&
				document.activeElement?.getAttribute("role") === "row"),
	);
const sameSelection = async (a: Locator, b: Locator) =>
	check(
		"I1 the views share selection",
		(await selected(a).textContent()) === (await selected(b).textContent()),
	);
const openQuick = async (page: Page, tools: Tools) => {
	if (await quick(page).isVisible()) return;
	await tools.prefixed(page, "a");
	await quick(page).waitFor();
};
const added = async (page: Page, before: readonly string[]) => {
	const ids = await until(
		"one new tile",
		() => tileIds(page),
		(all) => all.length === before.length + 1,
	);
	const id = ids.find((value) => !before.includes(value));
	if (id === undefined) throw new Error("no new tile id");
	return id;
};
const focusTile = async (page: Page, tools: Tools, id: string) => {
	const strip = page.locator(`[data-strip="${id}"]`);
	if ((await strip.count()) > 0) await strip.click();
	else await tools.focusOn(page, id);
};
const split = async (page: Page, tools: Tools, id: string, key: "|" | "-") => {
	await tools.focusOn(page, id);
	const before = await tileIds(page);
	await tools.prefixed(page, key);
	const made = await added(page, before);
	await tools.prompted(page, made);
	return made;
};
const size = async (app: ElectronApplication, width: number, height: number, zoom = 1) =>
	app.evaluate(
		({BrowserWindow}, values) => {
			const win = BrowserWindow.getAllWindows()[0];
			win?.setBounds({x: 0, y: 0, width: values.width, height: values.height});
			win?.webContents.setZoomFactor(values.zoom);
		},
		{width, height, zoom},
	);
const arrange = async (app: ElectronApplication, page: Page, tools: Tools, layout: Layout) => {
	const small = layout.startsWith("small");
	const shape = layout.replace("small-", "");
	await size(app, small ? 1024 : 1440, small ? 700 : 900);
	let ids = ["t1"];
	if (["side", "stacked", "2x2", "text-200", "minimum"].includes(shape)) {
		const b = await split(page, tools, "t1", shape === "stacked" ? "-" : "|");
		ids = ["t1", b];
		if (["2x2", "text-200"].includes(shape))
			ids = ["t1", await split(page, tools, "t1", "-"), b, await split(page, tools, b, "-")];
	}
	if (layout === "text-200") {
		// Electron's menu changes text zoom with real key events; no DOM styles are injected.
		await page.keyboard.press("Meta+Equal");
		await page.keyboard.press("Meta+Equal");
		await page.keyboard.press("Meta+Equal");
		await page.keyboard.press("Meta+Equal");
		await page.keyboard.press("Meta+Equal");
		await app.evaluate(({BrowserWindow}) => {
			if (BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() !== 2)
				throw new Error("the text zoom menu did not reach 200%");
		});
	}
	if (layout === "minimum") {
		const tile = page.locator('[data-tile="t1"]');
		const box = await tile.boundingBox();
		if (box === null) throw new Error("no first tile");
		const borders = page.getByRole("separator");
		const border = await borders.first().boundingBox();
		if (border === null) throw new Error("no draggable split border");
		await page.mouse.move(border.x + border.width / 2, border.y + border.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x, border.y + border.height / 2, {steps: 12});
		await page.mouse.up();
	}
	if (layout === "reflow-320") {
		await size(app, 1280, 900, 4);
		check("U3 reflow is 320 CSS pixels", (await page.evaluate(() => window.innerWidth)) === 320);
	}
	await tools.focusOn(page, "t1");
	return ids;
};
const seedAsk = (home: string, ticket: number, stopped = false, long = false) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			const name = nameOf(ticket);
			yield* ledger.register(name, "user:owner");
			const send = (id: string, fact: {type: string}) =>
				ledger.send(streams(name).inbox, id, {
					kind: fact.type,
					writer: "agent:scout for:owner",
					data: fact,
				});
			yield* send("file", FILED);
			if (stopped)
				yield* send("stopped", {type: "stopped", ...{why: "read_failed", resume: "build"}});
			else {
				const ask = `a-approve-${ticket}`;
				yield* send(
					ask,
					yield* sealAsk(
						{
							...DRAFT,
							ask,
							what: long
								? "Should the long question wrap so every required word remains readable in a narrow tile?"
								: DRAFT.what,
						},
						policyFor(ask, false, blindDraw),
					),
				);
			}
		}).pipe(Effect.provide(layerSqliteSync({path: join(home, "ledger.sqlite")})), Effect.scoped),
	);
const answers = (home: string, ticket: number) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const all = yield* (yield* Ledger).readStream(streams(nameOf(ticket)).inbox);
			return all.filter((entry) => entry.kind === "answered");
		}).pipe(Effect.provide(layerSqliteSync({path: join(home, "ledger.sqlite")})), Effect.scoped),
	);
const filedCount = (home: string) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const rows = yield* (yield* Ledger).read(0, 10000);
			return new Set(rows.filter((r) => r.kind === "filed").map((r) => r.stream)).size;
		}).pipe(Effect.provide(layerSqliteSync({path: join(home, "ledger.sqlite")})), Effect.scoped),
	);

// Real I/O failure. Deny writes only in this test home's DM store, then restore every mode.
const denyDelivery = async (home: string) => {
	const root = join(home, "storage", "rooms");
	const modes: {path: string; mode: number}[] = [];
	const visit = async (path: string): Promise<void> => {
		const found = await stat(path);
		modes.push({path, mode: found.mode & 0o777});
		if (found.isDirectory())
			for (const entry of await readdir(path)) await visit(join(path, entry));
		await chmod(path, found.isDirectory() ? 0o500 : 0o400);
	};
	await visit(root);
	return async () => {
		for (const entry of modes.toReversed()) await chmod(entry.path, entry.mode);
	};
};
const treeCheck = async (where: Locator) => {
	check(
		"I20 no nested interactive listbox options",
		(await where.getByRole("listbox").count()) === 0 &&
			(await where.getByRole("option").count()) === 0,
	);
	check(
		"I20 named row groups",
		(await grid(where).getByRole("rowgroup", {name: "Your turn"}).count()) === 1 &&
			(await grid(where).getByRole("rowgroup", {name: "Messages"}).count()) === 1,
	);
	const activeStops = await grid(where).locator('[tabindex="0"]').count();
	check("I20 one list navigation tab stop", activeStops === 1, activeStops);
};

// --inbox checks real input. --inbox-shots adds the full required state/layout/look matrix.
export const inboxStage = async (tools: Tools, shots = false) => {
	const destination = resolve(import.meta.dirname, "../../../programs/inbox/docs");
	const trackerShots = resolve(import.meta.dirname, "../../../programs/tracker/docs/glance");
	const actualAria = join(tools.shots, "aria", "inbox");
	await mkdir(destination, {recursive: true});
	await mkdir(trackerShots, {recursive: true});
	await mkdir(actualAria, {recursive: true});
	await writeFile(
		join(actualAria, "intended.yml"),
		await readFile(new URL("../aria/inbox/intended.yml", import.meta.url), "utf8"),
	);
	const remaining = new Set(shots ? cells : []);
	try {
		for (const layout of shots ? layouts : (["one"] as const))
			for (const look of shots ? looks : (["dark"] as const)) {
				const home = await mkdtemp(join(tmpdir(), "ix-"));
				await writeFile(join(home, "keybindings.toml"), 'program.inbox.open = "shift+i"\n');
				const app = await tools.launch(home);
				let agent: Awaited<ReturnType<typeof nativeAgent>> | undefined;
				const captured = async (page: Page, state: State) => {
					if (!shots) return;
					const widths = await page
						.getByRole("grid", {name: "inbox", exact: true})
						.evaluateAll((all) => all.map((e) => e.scrollWidth <= e.clientWidth + 1));
					check(`U3 ${state} keeps required words within the tile`, widths.every(Boolean));
					const file = shotName(state, layout, look);
					await page.screenshot({
						path: join(state === "tracker-glance" ? trackerShots : destination, file),
					});
					await writeFile(
						join(actualAria, file.replace(".png", ".yml")),
						await page.locator("body").ariaSnapshot(),
					);
					remaining.delete(file);
				};
				try {
					const page = await app.firstWindow();
					await tools.prompted(page, "t1");
					await tools.lookIs(app, page, look);
					const ids = await arrange(app, page, tools, layout);
					await openQuick(page, tools);
					check("I20 empty keeps Open all", await button(quick(page), "Open all").isVisible());
					await captured(page, "empty");
					await page.keyboard.press("Escape");
					agent = await nativeAgent(home, "scout");
					check("I9 native DM tool exists", (await agent.tools()).includes("dm_send"));
					const beforeFocus = await focus(page);
					const beforeDom = await page.evaluate(() => document.activeElement?.outerHTML);
					const send = async (id: string, text: string) => {
						if (agent === undefined) throw new Error("no native agent");
						const got = await agent.call("dm_send", {
							id,
							to: "owner",
							text,
							ticket: null,
							said: MESSAGE.said,
						});
						check("I3/I9 native unticketed send acknowledged", !got.error, got.text);
					};
					await send("m17", MESSAGE.text);
					await until(
						"I4 count changes without opening",
						() => page.getByRole("button", {name: /inbox.*1.*message/i}).count(),
						(n) => n === 1,
					);
					check(
						"I4 arrival preserves desk and DOM focus",
						(await focus(page)) === beforeFocus &&
							(await page.evaluate(() => document.activeElement?.outerHTML)) === beforeDom,
					);
					check(
						"I4 arrival opens no view",
						(await quick(page).count()) === 0 && (await inbox(page).count()) === 0,
					);
					check("I4 arrival opens no tile", (await tileIds(page)).join() === ids.join());
					await seedAsk(home, 268);
					await seedAsk(home, 269, true);
					await openQuick(page, tools);
					await treeCheck(quick(page));
					check(
						"I17 remapped Open all key",
						/i/i.test(
							(await button(quick(page), "Open all").getAttribute("aria-keyshortcuts")) ?? "",
						),
					);
					await captured(page, "glance-open");
					await row(quick(page), DRAFT.what).click();
					await button(quick(page), "Evidence").click();
					await button(quick(page), "Agent could work it out").click();
					await send("m18", "Second message stays below the selected row.");
					await row(quick(page), MESSAGE.text).click();
					await page.keyboard.press("r");
					await reply(quick(page)).waitFor();
					await page.keyboard.type("jro O");
					check("I5 typing stays text", (await reply(quick(page)).inputValue()) === "jro O");
					check("I5 typing opens no tile", (await tileIds(page)).join() === ids.join());
					await captured(page, "glance-reply");
					check(
						"I20 reply and its buttons stay in the selected row",
						(await selected(quick(page)).getByRole("textbox", {name: /reply/i}).count()) === 1 &&
							(await button(selected(quick(page)), "Send").count()) === 1 &&
							(await button(selected(quick(page)), "Cancel").count()) === 1,
					);
					await page.keyboard.press("Escape");
					check(
						"I6 first Escape leaves glance open",
						(await quick(page).isVisible()) && (await reply(quick(page)).count()) === 0,
					);
					await page.keyboard.press("r");
					check("I6 reopening retains draft", (await reply(quick(page)).inputValue()) === "jro O");
					await reply(quick(page)).fill("Please fix it.");
					const restore = await denyDelivery(home);
					try {
						await page.keyboard.press("Meta+Enter");
						await button(quick(page), "Retry").waitFor();
						check(
							"I8 failed send retains text",
							(await reply(quick(page)).inputValue()) === "Please fix it.",
						);
						await captured(page, "reply-failed");
					} finally {
						await restore();
					}
					await button(quick(page), "Retry").click();
					const receiver = agent;
					await until(
						"I8 retry reaches the real mailbox once",
						() => receiver.call("dm_read", {after: 0, limit: 100}),
						(got) => !got.error && got.text.includes("Please fix it."),
					);
					if ((await reply(quick(page)).count()) > 0) await page.keyboard.press("Escape");
					await openQuick(page, tools);
					await button(quick(page), "Open all").click();
					await inbox(page).waitFor();
					await treeCheck(inbox(page));
					check(
						"I20 no duplicate Inbox heading",
						(await inbox(page).getByRole("heading", {name: "Inbox", exact: true}).count()) === 0,
					);
					const inboxTile = await inbox(page).evaluate((e) =>
						e.closest("[data-tile]")?.getAttribute("data-tile"),
					);
					check("I12 one Open all tile", inboxTile != null);
					if (inboxTile == null) throw new Error("no inbox tile id");
					// Remove the empty origin to restore the requested layout after Open all's split.
					await focusTile(page, tools, "t1");
					await tools.prefixed(page, "x");
					await page.keyboard.press("y");
					await until(
						"origin closed after split",
						() => tileIds(page),
						(all) => !all.includes("t1"),
					);
					await focusTile(page, tools, inboxTile);
					const shape = layout.replace("small-", "");
					const expectedTiles =
						shape === "side" || shape === "stacked" || shape === "minimum"
							? 2
							: shape === "2x2" || shape === "text-200"
								? 4
								: 1;
					check("U3 requested tile count", (await tileIds(page)).length === expectedTiles);
					await captured(page, "inbox-tile");
					await row(inbox(page), MESSAGE.text).click();
					const next = row(inbox(page), "read_failed");
					const following = row(inbox(page), "Second message stays below");
					const beforeBox = await selected(inbox(page)).boundingBox();
					const followingBefore = await following.boundingBox();
					await page.keyboard.press("Space");
					const detail = inbox(page).getByRole("region", {name: "look", exact: true});
					await detail.waitFor();
					const below = await detail.boundingBox();
					const followingAfter = await following.boundingBox();
					check(
						"I15 look below row and list keeps focus",
						beforeBox !== null &&
							below !== null &&
							below.y >= beforeBox.y + beforeBox.height - 1 &&
							(await listFocused(inbox(page))),
					);
					check(
						"I15 following rows move down",
						followingBefore !== null &&
							followingAfter !== null &&
							followingAfter.y > followingBefore.y,
					);
					await captured(page, "look-open");
					await page.keyboard.press("ArrowUp");
					check(
						"I15 look follows selection",
						(await detail.isVisible()) && (await selected(inbox(page)).count()) === 1,
					);
					await page.keyboard.press("Escape");
					check(
						"I15 Escape closes look and keeps list focus",
						(await detail.count()) === 0 && (await listFocused(inbox(page))),
					);
					await row(inbox(page), DRAFT.what).click();
					await page.keyboard.press("Space");
					await button(inbox(page), "Take rec").waitFor();
					check(
						"ask desk needed=false survives glance to tile",
						(await button(inbox(page), "Agent could work it out").getAttribute("aria-pressed")) ===
							"true",
					);
					await captured(page, "ask-answering");
					await button(inbox(page), "Take rec").click();
					const written = await until(
						"ask desk writes one answer from inbox",
						() => answers(home, 268),
						(all) => all.length === 1,
					);
					const answer = JSON.parse(written[0]?.data ?? "null");
					check(
						"ask desk evidence and needed reach the one answer path",
						answer?.needed === false &&
							answer?.via?.took?.opened?.includes("evidence") === true &&
							answer?.via?.took?.ms > 0,
					);
					await next.click();
					if ((await detail.count()) === 0) await page.keyboard.press("Space");
					check(
						"I16 stop has no answer controls",
						(await button(selected(inbox(page)), "Take rec").count()) === 0 &&
							(await button(selected(inbox(page)), "Against").count()) === 0,
					);
					await captured(page, "stop-selected");
					await page.keyboard.press("Escape");
					await send("long", "A long sender and message must wrap. ".repeat(40));
					const longSender = await nativeAgent(home, "research-assistant-checking-background-work");
					try {
						const got = await longSender.call("dm_send", {
							id: "long-sender",
							to: "owner",
							text: "Every letter of this sender must remain readable.",
							ticket: null,
						});
						check("long sender uses its real connection identity", !got.error);
						await row(inbox(page), "Every letter of this sender").waitFor();
					} finally {
						await longSender.close();
					}
					await seedAsk(home, 270, false, true);
					await captured(page, "long-content");
					for (let n = 0; n < 35; n++)
						await send(`list-${n}`, `Message ${n}: the list still receives while a tile is open.`);
					await row(inbox(page), "Message 34:").click();
					await page.keyboard.press("h");
					await captured(page, "long-list-later");
					await grid(inbox(page)).hover();
					await page.mouse.wheel(0, -200);
					const held = {
						selected: await selected(inbox(page)).textContent(),
						scroll: await grid(inbox(page)).evaluate((e) => e.scrollTop),
						focus: await page.evaluate(() => document.activeElement?.outerHTML),
					};
					await send("arrival-while-reading", "A fresh row must leave reading alone.");
					await row(inbox(page), "A fresh row must leave reading alone.").waitFor({
						state: "attached",
					});
					check(
						"I1/I4 arrival keeps selection, scroll and DOM focus",
						held.selected === (await selected(inbox(page)).textContent()) &&
							held.scroll === (await grid(inbox(page)).evaluate((e) => e.scrollTop)) &&
							held.focus === (await page.evaluate(() => document.activeElement?.outerHTML)),
					);
					if ((await tileIds(page)).length === 1) await split(page, tools, inboxTile, "|");
					await openQuick(page, tools);
					await sameSelection(quick(page), inbox(page));
					const beforeOpen = await tileIds(page);
					await page.keyboard.press("Shift+i");
					await page.keyboard.press("Shift+i");
					await until(
						"I12 two opens focus one tile",
						() => tileIds(page),
						(all) => all.join() === beforeOpen.join(),
					);
					await tools.focusOn(page, inboxTile);
					await tools.prefixed(page, "f");
					await tools.prefixed(page, "z");
					await openQuick(page, tools);
					await page.keyboard.press("Shift+i");
					check(
						"I13 reuse unfolds inbox",
						(await page.locator(`[data-strip="${inboxTile}"]`).count()) === 0 &&
							(await inbox(page).isVisible()),
					);
					const current = await focus(page);
					await tools.prefixed(page, ";");
					check("I19 leave reads focus history", (await focus(page)) !== current);
					await tools.run(page, (await focus(page)) ?? "t1", "tracker");
					await page.keyboard.press("Meta+k");
					await page.locator(".pop-palette").getByRole("combobox").fill("tracker");
					await page
						.locator(".pop-palette")
						.getByRole("option", {name: /tracker.*glance|glance.*tracker/i})
						.click();
					await page.getByRole("button", {name: /tracker.*\d/i}).waitFor();
					const realCount = await filedCount(home);
					const trackerButton = page.getByRole("button", {name: /tracker.*\d/i});
					check(
						"tracker glance uses the actual count",
						realCount > 0 &&
							(
								(await trackerButton.getAttribute("aria-label")) ??
								(await trackerButton.textContent()) ??
								""
							).includes(String(realCount)),
					);
					await captured(page, "tracker-glance");
					check(
						"I18 palette saves the same setting",
						(await readFile(join(home, "fabrika.toml"), "utf8")).includes("tracker"),
					);
					await page.keyboard.press("Control+c");
					await until(
						"I18 stopped provider falls back",
						() => page.getByRole("button", {name: /inbox/i}).count(),
						(n) => n > 0,
					);
					check(
						"I18 fallback keeps chosen tracker",
						(await readFile(join(home, "fabrika.toml"), "utf8")).includes("tracker"),
					);
					await page.keyboard.press("Meta+k");
					await page.locator(".pop-palette").getByRole("combobox").fill("inbox");
					await page
						.locator(".pop-palette")
						.getByRole("option", {name: /inbox.*glance|glance.*inbox/i})
						.click();
					const pid = await tools.hostPid(home);
					if (pid === null) throw new Error("no host pid for reconnect");
					await agent.close();
					agent = undefined;
					await openQuick(page, tools);
					await row(quick(page), MESSAGE.text).click();
					await page.keyboard.press("r");
					await reply(quick(page)).fill("Keep this queued until scout returns.");
					await page.keyboard.press("Meta+Enter");
					await until(
						"I8 offline is queued, never delivered",
						() => quick(page).textContent(),
						(text) => /queued/i.test(text ?? "") && !/delivered/i.test(text ?? ""),
					);
					await tools.stop(pid);
					await until(
						"I11 host restarts",
						() => tools.hostPid(home),
						(nextPid) => nextPid !== null && nextPid !== pid,
					);
					await openQuick(page, tools);
					check(
						"I11 saved content survives reconnect",
						(await quick(page).textContent())?.includes(MESSAGE.text) === true,
					);
					check(
						"I11 reconnect preserves honest queued status",
						/queued/i.test((await quick(page).textContent()) ?? "") &&
							!/delivered/i.test((await quick(page).textContent()) ?? ""),
					);
					await captured(page, "host-reconnect");
					const overflow = await page
						.locator("[role=grid]")
						.evaluateAll((all) => all.map((e) => e.scrollWidth > e.clientWidth + 1));
					check(
						"U3 no horizontal inbox scrolling",
						overflow.every((over) => !over),
					);
				} finally {
					await agent?.close().catch(() => {});
					await app.close().catch(() => {});
					const pid = await tools.hostPid(home);
					if (pid !== null) await tools.stop(pid);
				}
			}
	} finally {
		await writeFile(
			join(tools.shots, "inbox-captures.json"),
			JSON.stringify(
				{
					expected: shots ? cells.length : 0,
					captured: shots ? cells.filter((file) => !remaining.has(file)) : [],
					skipped: [...remaining].map((file) => ({
						file,
						why: "the run stopped before this capture",
					})),
				},
				null,
				2,
			),
		);
	}
	check("U3 every required screenshot exists", remaining.size === 0, [...remaining]);
};
