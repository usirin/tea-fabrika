// P19, next/. The one law on real safeStorage, laptop-only (plan "Tests before implementation"): a
// packaged fixture with its own productName seals both keys through Electron's async safeStorage,
// a second launch reopens the same window key, and the run leaves no Keychain item behind.
//
// Before anything seals, the test checks that its exact Keychain item is absent. Cleanup deletes
// only that item and checks it is gone; a failed cleanup fails the law and names the item left.
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync, rmSync} from "node:fs";
import {NodeServices} from "@effect/platform-node";
import {Effect} from "effect";
import type {Page} from "playwright";
import {describe, expect, it} from "vitest";
import {bootoutLabel, launchP19, testLabel} from "./p19.test-support.ts";

const LAPTOP = process.platform === "darwin" && process.env["CI"] === undefined;
const has = (service: string): boolean =>
	spawnSync("security", ["find-generic-password", "-s", service], {stdio: "ignore"}).status === 0;
const remove = (service: string): void => {
	spawnSync("security", ["delete-generic-password", "-s", service], {stdio: "ignore"});
};
const exposed = (page: Page) =>
	page.evaluate(async () => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const plain = new Set(Object.getOwnPropertyNames(frame.contentWindow));
		frame.remove();
		const name = Object.getOwnPropertyNames(window).find((n) => !plain.has(n));
		const api =
			name === undefined
				? undefined
				: (Reflect.get(window, name) as {identity: () => Promise<{key: string}>});
		return api === undefined ? null : (await api.identity()).key;
	});

describe.runIf(LAPTOP)("P19 real seal, laptop-only", () => {
	it("plant, skip sealing, change the reopened key or leave the test item behind: one real seal reopens the same key and cleans up", async () => {
		const product = `fabrika-p19-seal-${randomBytes(4).toString("hex")}`;
		const item = `${product} Safe Storage`;
		expect(has(item), `${item} existed before the run`).toBe(false);
		const home = mkdtempSync("/tmp/fh.");
		const label = testLabel();
		try {
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const first = yield* launchP19({home, label, seal: "real", brain: "stand-in", product});
						yield* Effect.promise(() => first.page.getByRole("textbox").fill("seal"));
						yield* Effect.promise(() => first.page.getByRole("button", {name: /start/i}).click());
						yield* Effect.promise(() => first.page.waitForURL(/\/electron$/, {timeout: 60_000}));
						expect(has(item), "sealing made no Keychain item of its own product").toBe(true);
						const key = yield* Effect.promise(() => exposed(first.page));
						yield* first.stop;
						const again = yield* launchP19({
							home,
							label,
							seal: "real",
							brain: "stand-in",
							product,
							built: first.built,
						});
						yield* Effect.promise(() => again.page.waitForURL(/\/electron$/, {timeout: 60_000}));
						expect(yield* Effect.promise(() => exposed(again.page))).toBe(key);
						yield* again.stop;
					}),
				).pipe(Effect.provide(NodeServices.layer)),
			);
		} finally {
			remove(item);
			bootoutLabel(label);
			rmSync(home, {recursive: true, force: true});
		}
		expect(has(item), `Keychain item left behind: ${item}`).toBe(false);
	});
});
