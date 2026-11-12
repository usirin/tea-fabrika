// P36, next/: real local cloud stage, then three independent Electron homes.
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {
  EPOCH,
  STAGE,
  StageFlow,
  checkedAddress,
  clock,
  device,
  launch,
  mailCode,
  openStage,
  redeem,
  shots,
  snapshot,
  visible,
  type Window,
} from "./email.test-support.ts";

type Notice = {
  readonly added: string;
  readonly label: string;
  readonly location: string;
  readonly at: number;
  readonly actions: ReadonlyArray<unknown>;
};

// Plants after build: tell only the asking device; keep the notice only in memory; skip reconnect.
it.effect.prop(
  "P36.16 live devices see an email-added notice once, reconnect reads the fact, dropped devices get removal",
  { flow: Arbitrary.schema(StageFlow) },
  ({ flow }) =>
    Effect.tryPromise(async () => {
      const stage = await openStage();
      try {
        const devices = await Promise.all(
          Array.from({ length: Math.max(3, flow.live) }, (_, n) => device(stage, `old-${n}`)),
        );
        await checkedAddress(stage, devices[0]!);
        const offline = devices.at(-1)!;
        await stage.call("/watch/disconnect", { device: offline });
        const newcomer = await device(stage, flow.label);
        const at = EPOCH + 1;
        await clock(stage, at);
        const receipt = await redeem(stage, newcomer, flow.old);
        const fact = (await snapshot(stage)).added.find((row) => row.id === receipt.added)!;
        expect(fact.arrivedAt).toBe(at);
        for (const [index, old] of devices.entries()) {
          const removed = index === 0 && flow.old === "lost";
          for (let n = 0; n <= flow.reopen; n++) {
            const answer = await stage.call<{ notices: Notice[]; closed: number | null }>("/email/notices", {
              device: old,
              reconnect: old === offline || n > 0,
            });
            expect(answer.closed).toBe(removed ? 4003 : null);
            const notices = answer.notices.filter((notice) => notice.added === receipt.added);
            expect(notices).toHaveLength(removed ? 0 : 1);
            for (const notice of notices) {
              expect(notice).toMatchObject({
                label: fact.label,
                location: fact.location,
                at,
                actions: [],
              });
            }
          }
        }
      } finally {
        await stage.close();
      }
    }),
  STAGE,
);

// P36.17 is kept. Its timing changes with 0138: no timer or alarm is needed.
// Plant after build: leave a removed device's live connection open.
it.effect.prop(
  "P36.17 the added closes removed connections with 4003 and admits the new window through Gateway",
  { flow: Arbitrary.schema(StageFlow) },
  ({ flow }) =>
    Effect.tryPromise(async () => {
      const stage = await openStage();
      try {
        const old = await device(stage, "old");
        await checkedAddress(stage, old);
        await stage.call("/notes/save", { device: old, text: "same note after recovery" });
        const before = await snapshot(stage);
        const newcomer = await device(stage, flow.label);
        const receipt = await redeem(stage, newcomer, flow.old);
        expect((await stage.call<{ admitted: boolean }>("/initialize", { device: newcomer })).admitted).toBe(true);
        const removed = await stage.call<{ closed: number | null; admitted: boolean }>("/initialize", { device: old });
        expect(removed.admitted).toBe(flow.old === "kept");
        expect(removed.closed).toBe(flow.old === "lost" ? 4003 : null);
        const after = await snapshot(stage);
        expect(after.founding).toEqual(before.founding);
        expect(after.person).toBe(before.person);
        expect(after.name).toBe(before.name);
        expect(after.notes).toEqual(before.notes);
        expect(after.rev).toBeGreaterThan(before.rev);
        expect(after.added.filter((row) => row.id === receipt.added)).toHaveLength(1);
      } finally {
        await stage.close();
      }
    }),
  STAGE,
);

// scenario: real Electron, three temporary homes, a stand-in sender and a test clock.
// A person's flow across homes is not generated. The other home must survive the selected drops.
// Plants after build: Cancel button; success before added; missing notice; Remove fails to revoke.
it("scenario: P36.26 setup, immediate recovery, another home's notice and list Remove", async () => {
  const stage = await openStage();
  const windows: Window[] = [];
  try {
    const a = await launch(stage, "Device A");
    windows.push(a);
    await a.page.getByRole("button", { name: "Cloudflare" }).click();
    await a.page.getByRole("textbox", { name: "Name" }).fill("test home");
    await a.page.getByRole("button", { name: "Create" }).click();
    await a.page.getByRole("textbox", { name: "Note" }).fill("same note after recovery");
    await a.page.getByRole("button", { name: "Save" }).click();
    await a.page.getByRole("button", { name: "Email recovery" }).click();
    await a.page.getByRole("textbox", { name: "Email address" }).fill("p36@example.test");
    await a.page.getByRole("button", { name: "Send code" }).click();
    await shots(a, "setup");
    await a.page.getByRole("textbox", { name: "Code" }).fill("not-code");
    await a.page.getByRole("button", { name: "Check code" }).click();
    await visible(a.page, "Check the code");
    await shots(a, "code-error");
    await a.page.getByRole("textbox", { name: "Code" }).fill(mailCode(stage));
    await a.page.getByRole("button", { name: "Check code" }).click();
    await visible(a.page, "Email checked");
    // P21/P28's real device linking flow, so the observer has its own live person key.
    const observer = await launch(stage, "Device D");
    windows.push(observer);
    await observer.page.getByRole("button", { name: "Link a device" }).click();
    const linkCode = await observer.page.getByTestId("device-code").textContent();
    await a.page.getByRole("button", { name: "Let a device in" }).click();
    await a.page.getByRole("textbox", { name: "Device code" }).fill(linkCode!);
    await a.page.getByRole("button", { name: "Let in" }).click();
    await visible(observer.page, "same note after recovery");
    const before = await snapshot(stage);
    const b = await launch(stage, "Device B");
    windows.push(b);
    await b.page.getByRole("button", { name: "Email me a code" }).click();
    await b.page.getByRole("textbox", { name: "Code" }).fill(mailCode(stage));
    await b.page.getByRole("button", { name: "Continue" }).click();
    await visible(b.page, "Is your old device lost or stolen?");
    expect(await b.page.getByRole("radio", { name: "Lost or stolen" }).isChecked()).toBe(true);
    await b.page.getByRole("button", { name: "Continue" }).click();
    await visible(b.page, "same note after recovery");
    await shots(b, "in");
    const after = await snapshot(stage);
    const added = after.added.filter((row) => !before.added.some((old) => old.id === row.id));
    expect(added).toHaveLength(1);
    expect(added[0]!.arrivedAt).toBe(EPOCH);
    await visible(a.page, "removed");
    await visible(observer.page, "A device came back by email");
    await visible(observer.page, added[0]!.label);
    await visible(observer.page, added[0]!.location);
    expect(await observer.page.getByRole("button", { name: /Cancel|Not me/i }).count()).toBe(0);
    expect(await b.page.getByText(/24 hours|Waiting/).count()).toBe(0);
    await shots(observer, "notice");
    await observer.page.getByRole("button", { name: "Devices" }).click();
    const row = observer.page.getByRole("row").filter({ hasText: "Device B" });
    await row.getByRole("button", { name: "Remove" }).click();
    await visible(b.page, "removed");
    expect(after.founding).toEqual(before.founding);
    expect(after.person).toBe(before.person);
    expect(after.name).toBe(before.name);
    expect(after.notes).toEqual(before.notes);
  } finally {
    for (const window of windows.reverse()) await window.close();
    await stage.close();
  }
});
