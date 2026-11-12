// P36, next/: real local cloud instance, then three independent Electron homes.
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {
  EPOCH,
  INTEGRATION,
  IntegrationFlow,
  checkedAddress,
  clock,
  device,
  launch,
  mailCode,
  openInstance,
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
  { flow: Arbitrary.schema(IntegrationFlow) },
  ({ flow }) =>
    Effect.tryPromise(async () => {
      const instance = await openInstance();

      try {
        const devices = await Promise.all(
          Array.from({ length: Math.max(3, flow.live) }, (_, n) => device(instance, `old-${n}`)),
        );
        await checkedAddress(instance, devices[0]!);
        const offline = devices.at(-1)!;
        await instance.call("/watch/disconnect", { device: offline });
        const newcomer = await device(instance, flow.label);
        const at = EPOCH + 1;
        await clock(instance, at);
        const receipt = await redeem(instance, newcomer, flow.old);
        const fact = (await snapshot(instance)).added.find((row) => row.id === receipt.added)!;
        expect(fact.arrivedAt).toBe(at);

        for (const [index, old] of devices.entries()) {
          const removed = index === 0 && flow.old === "lost";

          for (let n = 0; n <= flow.reopen; n++) {
            const answer = await instance.call<{ notices: Notice[]; closed: number | null }>("/email/notices", {
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
        await instance.close();
      }
    }),
  INTEGRATION,
);

// P36.17 is kept. Its timing changes with 0138: no timer or alarm is needed.
// Plant after build: leave a removed device's live connection open.
it.effect.prop(
  "P36.17 the added closes removed connections with 4003 and admits the new window through Gateway",
  { flow: Arbitrary.schema(IntegrationFlow) },
  ({ flow }) =>
    Effect.tryPromise(async () => {
      const instance = await openInstance();

      try {
        const old = await device(instance, "old");
        await checkedAddress(instance, old);
        await instance.call("/notes/save", { device: old, text: "same note after recovery" });
        const before = await snapshot(instance);
        const newcomer = await device(instance, flow.label);
        const receipt = await redeem(instance, newcomer, flow.old);
        expect((await instance.call<{ admitted: boolean }>("/initialize", { device: newcomer })).admitted).toBe(true);
        const removed = await instance.call<{ closed: number | null; admitted: boolean }>("/initialize", {
          device: old,
        });
        expect(removed.admitted).toBe(flow.old === "kept");
        expect(removed.closed).toBe(flow.old === "lost" ? 4003 : null);
        const after = await snapshot(instance);
        expect(after.founding).toEqual(before.founding);
        expect(after.person).toBe(before.person);
        expect(after.name).toBe(before.name);
        expect(after.notes).toEqual(before.notes);
        expect(after.rev).toBeGreaterThan(before.rev);
        expect(after.added.filter((row) => row.id === receipt.added)).toHaveLength(1);
      } finally {
        await instance.close();
      }
    }),
  INTEGRATION,
);

// scenario: real Electron, three temporary homes, a stand-in sender and a test clock.
// A person's flow across homes is not generated. The other home must survive the selected drops.
// Plants after build: Cancel button; success before added; missing notice; Remove fails to revoke.
it("scenario: P36.26 setup, immediate recovery, another home's notice and list Remove", async () => {
  const instance = await openInstance();
  const windows: Window[] = [];

  try {
    const a = await launch(instance, "Device A");
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
    await a.page.getByRole("textbox", { name: "Code" }).fill(mailCode(instance));
    await a.page.getByRole("button", { name: "Check code" }).click();
    await visible(a.page, "Email checked");
    // P21/P28's real device linking flow, so the observer has its own live person key.
    const observer = await launch(instance, "Device D");
    windows.push(observer);
    await observer.page.getByRole("button", { name: "Link a device" }).click();
    const linkCode = await observer.page.getByTestId("device-code").textContent();
    await a.page.getByRole("button", { name: "Let a device in" }).click();
    await a.page.getByRole("textbox", { name: "Device code" }).fill(linkCode!);
    await a.page.getByRole("button", { name: "Let in" }).click();
    await visible(observer.page, "same note after recovery");
    const before = await snapshot(instance);
    const b = await launch(instance, "Device B");
    windows.push(b);
    await b.page.getByRole("button", { name: "Email me a code" }).click();
    await b.page.getByRole("textbox", { name: "Code" }).fill(mailCode(instance));
    await b.page.getByRole("button", { name: "Continue" }).click();
    await visible(b.page, "Is your old device lost or stolen?");
    expect(await b.page.getByRole("radio", { name: "Lost or stolen" }).isChecked()).toBe(true);
    await b.page.getByRole("button", { name: "Continue" }).click();
    await visible(b.page, "same note after recovery");
    await shots(b, "in");
    const after = await snapshot(instance);
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
    for (const window of windows.reverse()) {
      await window.close();
    }

    await instance.close();
  }
});
