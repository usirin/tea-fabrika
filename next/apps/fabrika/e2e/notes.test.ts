// T293, next/. Labeled browser scenarios, not substitutes for generated machine laws.
// Lead run: the compiled client, two admitted contexts and actual P12 workerd must complete all
// scenarios. Inspect every saved picture. A socket refusal is neither a red law nor a pass.
import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {Effect, Exit, Schema, Scope} from "effect";
import {expect as browserExpect, type Page} from "playwright/test";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {startNotesStage, type NotesLayout} from "./notes.test-support.ts";

let fixture: Effect.Success<ReturnType<typeof startNotesStage>>;
let scope: Scope.Closeable;
const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(
		effect.pipe(Effect.provideService(Scope.Scope, scope), Effect.provide(NodeServices.layer)),
	);
const tile = (page: Page) => page.getByRole("region", {name: /notes/i}).first();
const editor = (page: Page) => tile(page).getByRole("textbox");
const status = (page: Page) => page.getByRole("status");
const sent = (client: number) =>
	fixture.requests.filter((r) => r.client === client && r.method === "process.send");
const admitted = async () => {
	const window = await run(fixture.open());
	await run(fixture.grant(window.page));
	await browserExpect(tile(window.page)).toBeVisible();
	return window;
};
const create = async (page: Page, body: string) => {
	await tile(page)
		.getByRole("button", {name: /new note/i})
		.click();
	await editor(page).fill(body);
	await tile(page).getByRole("button", {name: "Done", exact: true}).click();
	await browserExpect(editor(page)).toHaveCount(0);
	await browserExpect(tile(page)).toContainText(body);
};
const edit = async (page: Page, body: string) => {
	await tile(page).getByRole("button", {name: "Edit", exact: true}).click();
	await editor(page).fill(body);
};
beforeEach(async () => {
	scope = await Effect.runPromise(Scope.make());
	fixture = await run(startNotesStage());
});
afterEach(async () => {
	if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
});

describe.sequential("P20 real-browser scenarios", () => {
	it("scenario L10 real Done and Escape save then return to reading with usable focus", async () => {
		const {page, client} = await admitted();
		await create(page, "original\ntrailing  ");
		for (const finish of ["button", "Escape", "ControlOrMeta+Enter"]) {
			await edit(page, `changed with ${finish}\n🙂`);
			const before = sent(client).length;
			if (finish === "button")
				await tile(page).getByRole("button", {name: "Done", exact: true}).click();
			else await editor(page).press(finish);
			await browserExpect(editor(page)).toHaveCount(0);
			expect(sent(client).length).toBe(before + 1);
			await browserExpect(
				tile(page).getByRole("button", {name: "Edit", exact: true}),
			).toBeFocused();
		}
	});
	it("scenario L12 background and pagehide save outside a folded child", async () => {
		const {page, client} = await admitted();
		await create(page, "lifecycle");
		for (const event of ["visibilitychange", "pagehide"]) {
			await edit(page, `saved by ${event}`);
			const before = sent(client).length;
			await page.setViewportSize({width: 240, height: 700});
			await page.keyboard.press("F6");
			await page.evaluate((type) => {
				if (type === "visibilitychange")
					Object.defineProperty(document, "visibilityState", {configurable: true, value: "hidden"});
				(type === "pagehide" ? window : document).dispatchEvent(new Event(type));
			}, event);
			await browserExpect.poll(() => sent(client).length).toBe(before + 1);
			await page.setViewportSize({width: 1200, height: 800});
			await browserExpect(tile(page)).toContainText(`saved by ${event}`);
		}
	});
	it("scenario L13 composition and ordinary editing keys reach the real textarea", async () => {
		const {page, client} = await admitted();
		await create(page, "composition");
		await edit(page, "");
		await editor(page).pressSequentially("ejk ");
		await browserExpect(editor(page)).toHaveValue("ejk ");
		await editor(page).dispatchEvent("compositionstart", {data: ""});
		const before = sent(client).length;
		await editor(page).dispatchEvent("keydown", {key: "Escape", code: "Escape", isComposing: true});
		await browserExpect(editor(page)).toHaveValue("ejk ");
		expect(sent(client)).toHaveLength(before);
		await editor(page).dispatchEvent("compositionend", {data: "語"});
		await editor(page).fill("ejk 語");
		await editor(page).press("Escape");
		await browserExpect(tile(page)).toContainText("ejk 語");
	});
	it("scenario L14 L16 two windows conflict, Keep preserves origin, and a lost answer lands once", async () => {
		const a = await admitted(),
			b = await admitted();
		await create(a.page, "shared original");
		await tile(b.page).getByText("shared original", {exact: true}).click();
		await edit(a.page, "first window's draft");
		await edit(b.page, "second window's accepted text");
		await tile(b.page).getByRole("button", {name: "Done", exact: true}).click();
		await browserExpect(tile(b.page)).toContainText("second window's accepted text");
		await editor(a.page).press("Escape");
		await browserExpect(tile(a.page)).toContainText(/changed elsewhere/i);
		await browserExpect(editor(a.page)).toHaveValue("first window's draft");
		const stale = sent(a.client).at(-1);
		expect(stale).toBeDefined();
		fixture.loseAnswer(a.client);
		const before = sent(a.client).length;
		await tile(a.page).getByRole("button", {name: "Keep mine as a new note", exact: true}).click();
		await browserExpect.poll(() => sent(a.client).length).toBeGreaterThanOrEqual(before + 2);
		const attempts = sent(a.client).slice(before);
		for (const attempt of attempts) expect(attempt.params).toEqual(attempts[0]?.params);
		await browserExpect(editor(a.page)).toHaveCount(0);
		await browserExpect(tile(a.page)).toContainText("first window's draft");
		await tile(a.page).getByRole("button", {name: "History", exact: true}).click();
		await browserExpect(tile(a.page)).toContainText(/version 1/i);
		const reads = fixture.replies.filter(
			(r) => r.client === a.client && r.method === "ledger.read",
		);
		expect(reads.length).toBeGreaterThan(0);
		// Independent wire checks inspect the actual saved payload, not just the latest renderer.
		const payload = attempts[0]?.params;
		expect(payload).toMatchObject({
			m: {
				type: "save",
				value: {base: 0, body: "first window's draft", how: "kept", from: {version: 1}},
			},
		});
		await tile(b.page).getByRole("button", {name: "History", exact: true}).click();
		await browserExpect(tile(b.page)).toContainText("second window's accepted text");
		const {Entry} = await import("@kampus/libfabrika/data");
		const ledger = Schema.decodeUnknownSync(Schema.Struct({entries: Schema.Array(Entry)}))(
			await run(fixture.read(a.client, "notes:1/inbox", 0)),
		);
		const Save = Schema.Struct({
			m: Schema.Struct({
				type: Schema.Literal("save"),
				value: Schema.Struct({
					note: Schema.String,
					base: Schema.Int,
					body: Schema.String,
					how: Schema.optionalKey(Schema.String),
					from: Schema.optionalKey(Schema.Struct({note: Schema.String, version: Schema.Int})),
				}),
			}),
		});
		const saves = ledger.entries
			.filter((entry) => entry._tag === "send")
			.map((entry) => Schema.decodeUnknownSync(Save)(entry.body).m.value);
		const kept = saves.filter((save) => save.how === "kept");
		expect(kept).toHaveLength(1);
		expect(kept[0]).toMatchObject({base: 0, body: "first window's draft", from: {version: 1}});
		const original = saves.find((save) => save.body === "shared original");
		expect(original).toBeDefined();
		expect(kept[0]?.note).not.toBe(original?.note);
		expect(kept[0]?.from?.note).toBe(original?.note);
		expect(saves.filter((save) => save.note === original?.note)).toHaveLength(2);
	});
	it("scenario L19 Saved waits for acceptance and never hides newer typing", async () => {
		const {page, client} = await admitted();
		await create(page, "status original");
		await edit(page, "sent body");
		fixture.hold(client, true);
		await editor(page).press("ControlOrMeta+Enter");
		await browserExpect(status(page)).toContainText(/saving/i);
		await browserExpect(status(page)).not.toHaveText(/^Saved$/);
		await editor(page).fill("newer body");
		fixture.release(client);
		await browserExpect(editor(page)).toHaveValue("newer body");
		await tile(page).getByRole("button", {name: "Done", exact: true}).click();
		await browserExpect(editor(page)).toHaveCount(0);
		await browserExpect(tile(page)).toContainText("newer body");
	});
	it("scenario L22 focus, folds and hidden bars retain the local editor and mode words", async () => {
		const a = await admitted(),
			b = await admitted();
		await create(a.page, "focus original");
		await edit(a.page, "retained local text");
		await editor(a.page).focus();
		await a.page.keyboard.press("Shift+F6");
		await a.page.setViewportSize({width: 220, height: 700});
		await a.page.setViewportSize({width: 1200, height: 800});
		await a.page.keyboard.press("F6");
		await browserExpect(editor(a.page)).toHaveValue("retained local text");
		await browserExpect(editor(a.page)).toBeFocused();
		await browserExpect(tile(a.page)).toHaveAccessibleName(/editing/i);
		await browserExpect(tile(a.page)).toContainText(/editing/i);
		await a.page.getByRole("banner").evaluateAll((bars) =>
			bars.forEach((bar) => {
				bar.setAttribute("hidden", "");
			}),
		);
		await a.page.getByRole("contentinfo").evaluateAll((bars) =>
			bars.forEach((bar) => {
				bar.setAttribute("hidden", "");
			}),
		);
		await browserExpect(tile(a.page)).toContainText(/editing/i);
		await browserExpect(tile(b.page)).not.toHaveAccessibleName(/editing/i);
	});
	it("scenario L25 visible Retry performs the real history read and retains the draft", async () => {
		const {page, client} = await admitted();
		await create(page, "history original");
		await edit(page, "draft survives read failure");
		fixture.failReads(client, true);
		await tile(page).getByRole("button", {name: "History", exact: true}).click();
		await browserExpect(tile(page)).toContainText(/could not read|read failed/i);
		const before = fixture.requests.filter(
			(r) => r.client === client && r.method === "ledger.read",
		).length;
		fixture.failReads(client, false);
		await tile(page).getByRole("button", {name: "Retry", exact: true}).click();
		await browserExpect(tile(page)).toContainText("history original");
		expect(
			fixture.requests.filter((r) => r.client === client && r.method === "ledger.read").length,
		).toBeGreaterThan(before);
		await tile(page)
			.getByRole("button", {name: /close history/i})
			.click();
		await browserExpect(editor(page)).toHaveValue("draft survives read failure");
	});
	it.each<NotesLayout>(["full", "side-by-side", "stacked", "2x2"])(
		"scenario L28 every P20 state is usable in %s at the required viewport sizes",
		async (layout) => {
			await Effect.runPromise(Scope.close(scope, Exit.void));
			scope = await Effect.runPromise(Scope.make());
			fixture = await run(startNotesStage({layout}));
			const {page, client} = await admitted();
			const tiles = page.getByRole("region", {name: /notes/i});
			await browserExpect(tiles).toHaveCount(layout === "full" ? 1 : layout === "2x2" ? 4 : 2);
			const rectangles = await tiles.evaluateAll((elements) =>
				elements.map((element) => {
					const box = element.getBoundingClientRect();
					return {x: box.x, y: box.y};
				}),
			);
			expect(new Set(rectangles.map((box) => box.x)).size).toBe(
				layout === "side-by-side" || layout === "2x2" ? 2 : 1,
			);
			expect(new Set(rectangles.map((box) => box.y)).size).toBe(
				layout === "stacked" || layout === "2x2" ? 2 : 1,
			);
			const pictures = join(import.meta.dirname, "..", "..", "..", "programs", "notes", "docs");
			mkdirSync(pictures, {recursive: true});
			const capture = async (state: string) => {
				for (const [width, height] of [
					[1200, 800],
					[1400, 800],
					[700, 1000],
					[1024, 700],
					[390, 844],
				] as const) {
					await page.setViewportSize({width, height});
					await page.screenshot({
						path: join(pictures, `p20-${state}-${layout}-${width}x${height}.png`),
						fullPage: true,
					});
					for (const button of await tile(page).getByRole("button").all()) {
						await browserExpect(button).toBeVisible();
						const rect = await button.boundingBox();
						expect(rect).not.toBeNull();
						if (rect !== null) expect(rect.x + rect.width).toBeLessThanOrEqual(width);
					}
				}
			};
			await capture("empty");
			await create(page, "plain <b>text</b>");
			await capture("reading");
			await browserExpect(tile(page).locator("b")).toHaveCount(0);
			await edit(page, "changed");
			await capture("editing");
			fixture.hold(client, true);
			await editor(page).press("Escape");
			await browserExpect(status(page)).toContainText(/saving/i);
			await capture("saving");
			await page.context().setOffline(true);
			await browserExpect(status(page)).toContainText(/no link|offline|connection lost/i);
			await capture("no-link");
			await page.context().setOffline(false);
			fixture.release(client);
			await browserExpect(editor(page)).toHaveCount(0);
			const other = await admitted();
			await tile(other.page).getByText("changed", {exact: true}).click();
			await edit(page, "stale local draft");
			await edit(other.page, "new accepted version");
			await editor(other.page).press("Escape");
			await browserExpect(editor(other.page)).toHaveCount(0);
			await editor(page).press("Escape");
			await browserExpect(tile(page)).toContainText(/changed elsewhere/i);
			await browserExpect(
				tile(page).getByRole("button", {name: "Drop mine", exact: true}),
			).not.toBeFocused();
			await browserExpect(
				tile(page).getByRole("button", {name: "Keep mine as a new note", exact: true}),
			).not.toBeFocused();
			await capture("stale");
			await tile(page).getByRole("button", {name: "Drop mine", exact: true}).click();
			await browserExpect(tile(page)).toContainText("new accepted version");
			await edit(page, "x".repeat(256 * 1024 + 1));
			await editor(page).press("Escape");
			await browserExpect(tile(page)).toContainText(/too long/i);
			await capture("too-long");
			await browserExpect(editor(page)).toHaveValue("x".repeat(256 * 1024 + 1));
			await editor(page).fill("history draft");
			fixture.failReads(client, true);
			await tile(page).getByRole("button", {name: "History", exact: true}).click();
			await browserExpect(tile(page)).toContainText(/could not read|read failed/i);
			await capture("read-failure");
			fixture.failReads(client, false);
			await tile(page).getByRole("button", {name: "Retry", exact: true}).click();
			await browserExpect(tile(page)).toContainText(/version 1/i);
			await capture("history");
		},
	);
	it.each(["Done", "Escape"])(
		"plant scenario L10 dropping %s cannot satisfy save-then-read",
		async (finish) => {
			const {page, client} = await admitted();
			await create(page, "control plant");
			await edit(page, "must be saved");
			const before = sent(client).length;
			if (finish === "Done") {
				const control = tile(page).getByRole("button", {name: "Done", exact: true});
				await control.evaluate((element) =>
					element.addEventListener("click", (event) => event.stopImmediatePropagation(), {
						capture: true,
					}),
				);
				await control.click();
			} else {
				await editor(page).evaluate((element) =>
					element.addEventListener("keydown", (event) => event.stopImmediatePropagation(), {
						capture: true,
					}),
				);
				await editor(page).press("Escape");
			}
			const count = await editor(page).count();
			expect(() => expect(count).toBe(0)).toThrow();
			expect(sent(client)).toHaveLength(before);
		},
	);
	it("plant scenario L12 a swallowed page event leaves text unsent", async () => {
		const {page, client} = await admitted();
		await create(page, "lifecycle plant");
		await edit(page, "pending leave");
		const before = sent(client).length;
		await page.evaluate(() => {
			window.addEventListener("pagehide", (event) => event.stopImmediatePropagation(), {
				capture: true,
			});
			window.dispatchEvent(new Event("pagehide"));
		});
		expect(() => expect(sent(client).length).toBe(before + 1)).toThrow();
	});
	it("plant scenario L13 stealing composition Escape changes the textarea", async () => {
		const {page} = await admitted();
		await create(page, "composition plant");
		await edit(page, "keep this");
		await editor(page).dispatchEvent("compositionstart");
		await editor(page).evaluate((element) =>
			element.addEventListener(
				"keydown",
				() => {
					if (element instanceof HTMLTextAreaElement) element.value = "";
				},
				{capture: true},
			),
		);
		await editor(page).dispatchEvent("keydown", {key: "Escape", isComposing: true});
		const value = await editor(page).inputValue();
		expect(() => expect(value).toBe("keep this")).toThrow();
	});
	it("plant scenario L19 claiming Saved before acceptance fails the status check", async () => {
		const {page, client} = await admitted();
		await create(page, "status plant");
		await edit(page, "pending acceptance");
		fixture.hold(client, true);
		await editor(page).press("Escape");
		await browserExpect(status(page)).toContainText(/saving/i);
		await status(page).evaluate((element) => {
			element.textContent = "Saved";
		});
		const text = await status(page).textContent();
		expect(() => expect(text).not.toBe("Saved")).toThrow();
		fixture.release(client);
	});
	it("plant scenario L22 removing a folded editor fails the retained-control check", async () => {
		const {page} = await admitted();
		await create(page, "fold plant");
		await edit(page, "retained text");
		await editor(page).evaluate((element) => element.remove());
		const count = await editor(page).count();
		expect(() => expect(count).toBe(1)).toThrow();
	});
	it("plant scenario L25 L28 a dead Retry cannot perform a read", async () => {
		const {page, client} = await admitted();
		await create(page, "read plant");
		await edit(page, "retained draft");
		fixture.failReads(client, true);
		await tile(page).getByRole("button", {name: "History", exact: true}).click();
		const retry = tile(page).getByRole("button", {name: "Retry", exact: true});
		await browserExpect(retry).toBeVisible();
		const before = fixture.requests.filter(
			(r) => r.client === client && r.method === "ledger.read",
		).length;
		await retry.evaluate((element) =>
			element.addEventListener("click", (event) => event.stopImmediatePropagation(), {
				capture: true,
			}),
		);
		await retry.click();
		const after = fixture.requests.filter(
			(r) => r.client === client && r.method === "ledger.read",
		).length;
		expect(() => expect(after).toBeGreaterThan(before)).toThrow();
	});
});
