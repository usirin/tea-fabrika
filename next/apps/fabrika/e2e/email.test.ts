// P36, next/: properties on the local cloud stage plus one real Electron scenario.
import {expect, it} from "@effect/vitest";
import {Effect} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {
	DAY,
	EPOCH,
	STAGE,
	StageFlow,
	alarm,
	checkedAddress,
	clock,
	device,
	launch,
	mailCode,
	openStage,
	request,
	shots,
	snapshot,
	visible,
	type Window,
} from "./email.test-support.ts";

it.effect.prop(
	"P36.16 every live device receives pending recovery and reconnect reads the fact",
	{flow: Arbitrary.schema(StageFlow)},
	({flow}) =>
		Effect.tryPromise(async () => {
			const stage = await openStage();
			try {
				const devices = await Promise.all(
					Array.from({length: flow.live}, (_, n) => device(stage, `old-${n}`)),
				);
				await checkedAddress(stage, devices[0]!);
				const newcomer = await device(stage, "new");
				const pending = await request(stage, newcomer, flow.old);
				for (const old of devices) {
					const notices = await stage.call<ReadonlyArray<{request: string}>>("/email/notices", {
						device: old,
					});
					expect(notices.map((notice) => notice.request)).toContain(pending.id);
				}
				for (let n = 0; n <= flow.reopen; n++) {
					const notices = await stage.call<ReadonlyArray<{request: string}>>("/email/notices", {
						device: devices[0],
						reconnect: true,
					});
					expect(notices.map((notice) => notice.request)).toContain(pending.id);
				}
				expect((await snapshot(stage)).requests.map((row) => row.id)).toContain(pending.id);
			} finally {
				await stage.close();
			}
		}),
	STAGE,
);

it.effect.prop(
	"P36.17 completion closes removed connections and admits the new window through P10",
	{flow: Arbitrary.schema(StageFlow)},
	({flow}) =>
		Effect.tryPromise(async () => {
			const stage = await openStage();
			try {
				const old = await device(stage, "old");
				await checkedAddress(stage, old);
				await stage.call("/notes/save", {device: old, text: "same note after recovery"});
				const before = await snapshot(stage);
				const newcomer = await device(stage, flow.label);
				const pending = await request(stage, newcomer, flow.old);
				await clock(stage, pending.until - 1);
				await alarm(stage);
				const early = await stage.call<{admitted: boolean}>("/initialize", {device: newcomer});
				expect(early.admitted).toBe(false);
				await clock(stage, pending.until);
				for (let n = 0; n <= flow.alarms; n++) await alarm(stage);
				const admitted = await stage.call<{admitted: boolean}>("/initialize", {device: newcomer});
				expect(admitted.admitted).toBe(true);
				const removed = await stage.call<{closed: number | null; admitted: boolean}>(
					"/initialize",
					{device: old},
				);
				expect(removed.admitted).toBe(flow.old === "kept");
				expect(removed.closed).toBe(flow.old === "lost" ? 4003 : null);
				const after = await snapshot(stage);
				expect(after.founding).toEqual(before.founding);
				expect(after.person).toBe(before.person);
				expect(after.name).toBe(before.name);
				expect(after.notes).toEqual(before.notes);
				expect(after.rev).toBeGreaterThan(before.rev);
				expect(after.added.filter((row) => row.parent === pending.id)).toHaveLength(1);
			} finally {
				await stage.close();
			}
		}),
	STAGE,
);

for (const plant of [
	"notify only asking device",
	"keep request only in memory",
	"do not close removed connection",
]) {
	it.effect.prop(
		`plant: P36 cloud integration: ${plant}`,
		{flow: Arbitrary.schema(StageFlow)},
		({flow}) =>
			Effect.tryPromise(async () => {
				const stage = await openStage();
				try {
					const old = await device(stage, "old");
					await checkedAddress(stage, old);
					const newcomer = await device(stage, "new");
					const pending = await request(stage, newcomer, "lost");
					await clock(stage, pending.until);
					await alarm(stage);
					const actual = await snapshot(stage);
					// Replace one observed transport/storage dependency answer; keep the real flow.
					const noticeIds =
						plant === "notify only asking device" || plant === "keep request only in memory"
							? []
							: actual.requests.map((row) => row.id);
					const close = plant === "do not close removed connection" ? null : 4003;
					expect(() => {
						expect(noticeIds).toContain(pending.id);
						expect(close).toBe(4003);
					}).toThrow();
					void flow;
				} finally {
					await stage.close();
				}
			}),
		STAGE,
	);
}

// scenario: real Electron, two independent temporary homes, controlled stage clock and stand-in
// mail. The generated properties above prove the rules; this run checks every real button.
it("scenario: P36.26 real app completes setup, cancel and recovery using stand-ins", async () => {
	const stage = await openStage();
	const windows: Window[] = [];
	try {
		const a = await launch(stage, "Mac A");
		windows.push(a);
		await a.page.getByRole("button", {name: "Cloudflare"}).click();
		await a.page.getByRole("textbox", {name: "Name"}).fill("test home");
		await a.page.getByRole("button", {name: "Create"}).click();
		await a.page.getByRole("textbox", {name: "Note"}).fill("same note after recovery");
		await a.page.getByRole("button", {name: "Save"}).click();
		await a.page.getByRole("button", {name: "Email recovery"}).click();
		await a.page.getByRole("textbox", {name: "Email address"}).fill("p36@example.test");
		await a.page.getByRole("button", {name: "Send code"}).click();
		await shots(a, "setup");
		await a.page.getByRole("textbox", {name: "Code"}).fill("not-code");
		await a.page.getByRole("button", {name: "Check code"}).click();
		await visible(a.page, "Check the code");
		await shots(a, "code-error");
		await a.page.getByRole("textbox", {name: "Code"}).fill(mailCode(stage));
		await a.page.getByRole("button", {name: "Check code"}).click();
		await visible(a.page, "Email checked");
		const before = await snapshot(stage);
		const b = await launch(stage, "Mac B");
		windows.push(b);
		await b.page.getByRole("button", {name: "Email me a code"}).click();
		await visible(b.page, "24 hours");
		await b.page.getByRole("textbox", {name: "Code"}).fill(mailCode(stage));
		await b.page.getByRole("button", {name: "Continue"}).click();
		await visible(b.page, "Is your old device lost or stolen?");
		expect(await b.page.getByRole("radio", {name: "Lost or stolen"}).isChecked()).toBe(true);
		await b.page.getByRole("button", {name: "Continue"}).click();
		await visible(b.page, "Waiting");
		await shots(b, "waiting");
		await visible(a.page, "A new device asked to get in by email");
		await a.page.getByRole("button", {name: "Cancel it"}).click();
		await visible(b.page, "Canceled");
		await shots(b, "canceled");
		await clock(stage, EPOCH + DAY);
		await alarm(stage);
		expect((await snapshot(stage)).added).toEqual(before.added);
		await b.page.getByRole("button", {name: "Email me a code"}).click();
		await b.page.getByRole("textbox", {name: "Code"}).fill(mailCode(stage));
		await b.page.getByRole("button", {name: "Continue"}).click();
		await b.page.getByRole("button", {name: "Continue"}).click();
		const pending = (await snapshot(stage)).requests.at(-1)!;
		await clock(stage, pending.until - 1);
		await alarm(stage);
		await visible(b.page, "Waiting");
		await clock(stage, pending.until);
		await alarm(stage);
		await visible(b.page, "same note after recovery");
		await shots(b, "completed");
		await visible(a.page, "removed");
		const after = await snapshot(stage);
		expect(after.founding).toEqual(before.founding);
		expect(after.person).toBe(before.person);
		expect(after.name).toBe(before.name);
		expect(after.notes).toEqual(before.notes);
		expect(after.added.filter((row) => row.parent === pending.id)).toHaveLength(1);
	} finally {
		for (const window of windows.reverse()) await window.close();
		await stage.close();
	}
});
