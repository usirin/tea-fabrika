// T331, next/. L27 is a real outside scenario beside the generated library laws, not a property.
// P19/P21/P26 paths and accessible names must be reconciled by tests before build.
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, it} from "@effect/vitest";
import {Effect} from "effect";
import {
	absent,
	call,
	click,
	confirmWords,
	enterWords,
	ledger,
	openDevice,
	pictures,
	sealedMetadata,
	startStage,
	visible,
} from "./recovery.test-support.ts";

describe("P28 outside checks", () => {
	it.effect("scenario: L27 check 6, nine Electron steps on one stage and disposable homes", () =>
		Effect.gen(function* () {
			const stage = yield* startStage();
			// 1. Found once, save a note, admit an ordinary tab and an agent, then make a sheet.
			const a = yield* openDevice(stage.url);
			yield* call(() => a.page.getByLabel("Name", {exact: true}).fill("Recovery fixture"));
			yield* click(a.page, "Set up fabrika");
			yield* call(() => a.page.getByRole("textbox", {name: "Note"}).fill("The same saved note"));
			yield* click(a.page, "Save note");
			yield* click(a.page, "Open test tab");
			yield* click(a.page, "Approve");
			yield* click(a.page, "Connect test agent");
			yield* click(a.page, "Approve");
			yield* click(a.page, "Make backup sheet");
			yield* click(a.page, "Print");
			expect(existsSync(resolve(a.home, "printed-sheet.pdf"))).toBe(true);
			yield* confirmWords(a.page);
			yield* click(a.page, "Keep this sheet");
			yield* pictures(a.page, "live-sheet");
			const before = yield* ledger(stage.url);
			expect(before.notes).toHaveLength(1);
			// Electron apps run one at a time on the laptop. Reopen A after B recovers for the notice.
			yield* call(() => a.app.close());
			// 2. B selects recovery, enters address and words, keeps the default lost answer.
			const b = yield* openDevice(stage.url);
			yield* click(b.page, "I have a backup sheet");
			yield* call(() => b.page.getByLabel("Address", {exact: true}).fill(stage.url));
			yield* enterWords(b.page);
			yield* click(b.page, "Continue");
			expect(
				yield* call(() =>
					b.page.getByRole("radio", {name: "Yes, remove it and everything it let in"}).isChecked(),
				),
			).toBe(true);
			yield* pictures(b.page, "preview-lost");
			yield* click(b.page, "Recover");
			// 3. Same founded, person, name, old note authors and increasing ledger rev.
			yield* visible(b.page, "The same saved note");
			const after = yield* ledger(stage.url);
			expect(after.founded).toEqual(before.founded);
			expect(after.name).toBe(before.name);
			expect(after.notes).toEqual(before.notes);
			expect(after.rev).toBeGreaterThan(before.rev);
			yield* pictures(b.page, "recovered");
			// 4. The live transport's close code and old-client writes are asserted by L19.
			// P26's stage keeps the old tab/agent transports open while the Electron app is closed.
			const old = yield* call(async () => (await fetch(`${stage.url}/test/old-clients`)).json());
			expect(old).toMatchObject({
				close: 4003,
				tabWrite: "not_granted",
				agentWrite: "not_granted",
				reason: "recovery",
			});
			// 5. Quiet no-sheet row. Repeating the sheet gets the preview's one refusal line.
			yield* visible(b.page, "No backup sheet.");
			yield* call(() => b.app.close());
			const oldMac = yield* openDevice(stage.url, "test", a.home);
			yield* visible(oldMac.page, "This Mac was removed by your backup sheet just now.");
			yield* pictures(oldMac.page, "old-device-removed");
			yield* call(() => oldMac.app.close());
			const c = yield* openDevice(stage.url);
			yield* click(c.page, "I have a backup sheet");
			yield* enterWords(c.page);
			yield* click(c.page, "Continue");
			yield* visible(
				c.page,
				"This sheet does not open this fabrika. It may be for another one, already used, or replaced by a newer sheet.",
			);
			yield* pictures(c.page, "refused-sheet");
			// 6. No sheet gives waiting and no protected note.
			yield* click(c.page, "Ask to join");
			yield* visible(c.page, "Waiting for approval");
			expect(yield* absent(c.page, "The same saved note")).toBe(0);
			yield* pictures(c.page, "waiting");
			yield* call(() => c.app.close());
			// 7. Local setup warning appears once, and only for a setup without a copy.
			const local = yield* openDevice("local");
			yield* visible(local.page, "Your notes live only on this Mac.");
			yield* click(local.page, "I understand");
			yield* call(() => local.page.reload());
			expect(yield* absent(local.page, "Your notes live only on this Mac.")).toBe(0);
			yield* call(() => local.app.close());
			// 8. Corrupt only a disposable sealed public-test fixture. Never read or copy a key file.
			// P19 owns this test failure switch, so it goes through real startup/unseal handling.
			const sealedBefore = sealedMetadata(a.home);
			expect(sealedBefore.length).toBeGreaterThan(0);
			yield* Effect.sync(() => writeFileSync(resolve(a.home, "test-fail-unseal"), "injected"));
			const restored = yield* openDevice(stage.url, "test", a.home);
			yield* visible(restored.page, "This Mac's keys did not come across.");
			expect(yield* absent(restored.page, "Set up fabrika")).toBe(0);
			expect((yield* ledger(stage.url)).founded).toEqual(before.founded);
			expect(sealedMetadata(a.home)).toEqual(sealedBefore);
			yield* pictures(restored.page, "failed-unseal");
			yield* call(() => restored.app.close());
			// 9. P21's live-device route admits D without spending another sheet, then removes its tab.
			const d = yield* openDevice(stage.url);
			yield* click(d.page, "Ask another device");
			const request = yield* call(() => d.page.getByLabel("Device request code").textContent());
			yield* call(() => d.app.close());
			const approver = yield* openDevice(stage.url, "test", b.home);
			yield* call(() => approver.page.getByLabel("Device request code").fill(request!));
			yield* click(approver.page, "Approve device");
			expect((yield* ledger(stage.url)).spent).toEqual(after.spent);
			yield* click(approver.page, "Open device test tab");
			yield* click(approver.page, "Remove device");
			const removed = yield* call(async () =>
				(await fetch(`${stage.url}/test/removed-device`)).json(),
			);
			expect(removed).toMatchObject({device: "not_granted", tab: "not_granted"});
			yield* pictures(approver.page, "peer-removed");
		}),
	);
	it.effect("scenario: L28 real finger, physical print and second-home recovery", () =>
		Effect.sync(() => {
			// Person-operated outside check. Missing evidence fails, never skips or claims a pass.
			const path = process.env.P28_PERSON_EVIDENCE;
			expect(
				path,
				"lead must run physical print/Touch ID and provide the disposable run's evidence",
			).toBeDefined();
			const evidence = JSON.parse(readFileSync(path!, "utf8"));
			expect(evidence).toMatchObject({
				testPersonCheck: false,
				testPrinter: false,
				physicalPrint: true,
				touchId: true,
				secondHomeRecovery: true,
				sameLedger: true,
			});
			expect(evidence.homeA).not.toBe(evidence.homeB);
			expect(evidence.homeA).toMatch(/^\/tmp\/fh\./);
			expect(evidence.homeB).toMatch(/^\/tmp\/fh\./);
			expect(evidence.screenshots).toHaveLength(5);
		}),
	);
});
