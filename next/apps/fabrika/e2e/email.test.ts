// P36, next/: real local cloud instance, then three independent Electron homes.
import { NodeServices } from "@effect/platform-node";
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
  play,
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
    Effect.gen(function* () {
      const instance = yield* openInstance();

      const devices = yield* Effect.forEach(
        Array.from({ length: Math.max(3, flow.live) }, (_, n) => n),
        (n) => device(instance, `old-${n}`),
        { concurrency: 1 },
      );
      yield* checkedAddress(instance, devices[0]!);
      const offline = devices.at(-1)!;
      yield* instance.call("/watch/disconnect", { device: offline });
      const newcomer = yield* device(instance, flow.label);
      const at = EPOCH + 1;
      yield* clock(instance, at);
      const receipt = yield* redeem(instance, newcomer, flow.old);
      const fact = (yield* snapshot(instance)).added.find((row) => row.id === receipt.added)!;
      expect(fact.arrivedAt).toBe(at);

      for (const [index, old] of devices.entries()) {
        const removed = index === 0 && flow.old === "lost";

        for (let n = 0; n <= flow.reopen; n++) {
          const answer = yield* instance.call<{ notices: Notice[]; closed: number | null }>("/email/notices", {
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
    }).pipe(Effect.provide(NodeServices.layer)),
  INTEGRATION,
);

// P36.17 is kept. Its timing changes with 0138: no timer or alarm is needed.
// Plant after build: leave a removed device's live connection open.
it.effect.prop(
  "P36.17 the added closes removed connections with 4003 and admits the new window through Gateway",
  { flow: Arbitrary.schema(IntegrationFlow) },
  ({ flow }) =>
    Effect.gen(function* () {
      const instance = yield* openInstance();

      const old = yield* device(instance, "old");
      yield* checkedAddress(instance, old);
      yield* instance.call("/notes/save", { device: old, text: "same note after recovery" });
      const before = yield* snapshot(instance);
      const newcomer = yield* device(instance, flow.label);
      const receipt = yield* redeem(instance, newcomer, flow.old);
      expect((yield* instance.call<{ admitted: boolean }>("/initialize", { device: newcomer })).admitted).toBe(true);
      const removed = yield* instance.call<{ closed: number | null; admitted: boolean }>("/initialize", {
        device: old,
      });
      expect(removed.admitted).toBe(flow.old === "kept");
      expect(removed.closed).toBe(flow.old === "lost" ? 4003 : null);
      const after = yield* snapshot(instance);
      expect(after.founding).toEqual(before.founding);
      expect(after.person).toBe(before.person);
      expect(after.name).toBe(before.name);
      expect(after.notes).toEqual(before.notes);
      expect(after.rev).toBeGreaterThan(before.rev);
      expect(after.added.filter((row) => row.id === receipt.added)).toHaveLength(1);
    }).pipe(Effect.provide(NodeServices.layer)),
  INTEGRATION,
);

// scenario: real Electron, three temporary homes, a stand-in sender and a test clock.
// A person's flow across homes is not generated. The other home must survive the selected drops.
// Plants after build: Cancel button; success before added; missing notice; Remove fails to revoke.
it.effect("scenario: P36.26 setup, immediate recovery, another home's notice and list Remove", () =>
  Effect.gen(function* () {
    const instance = yield* openInstance();
    const a = yield* launch(instance, "Device A");
    yield* play(() => a.page.getByRole("button", { name: "Cloudflare" }).click());
    yield* play(() => a.page.getByRole("textbox", { name: "Name" }).fill("test home"));
    yield* play(() => a.page.getByRole("button", { name: "Create" }).click());
    yield* play(() => a.page.getByRole("textbox", { name: "Note" }).fill("same note after recovery"));
    yield* play(() => a.page.getByRole("button", { name: "Save" }).click());
    yield* play(() => a.page.getByRole("button", { name: "Email recovery" }).click());
    yield* play(() => a.page.getByRole("textbox", { name: "Email address" }).fill("p36@example.test"));
    yield* play(() => a.page.getByRole("button", { name: "Send code" }).click());
    yield* shots(a, "setup");
    yield* play(() => a.page.getByRole("textbox", { name: "Code" }).fill("not-code"));
    yield* play(() => a.page.getByRole("button", { name: "Check code" }).click());
    yield* visible(a.page, "Check the code");
    yield* shots(a, "code-error");
    const setupCode = yield* mailCode(instance);
    yield* play(() => a.page.getByRole("textbox", { name: "Code" }).fill(setupCode));
    yield* play(() => a.page.getByRole("button", { name: "Check code" }).click());
    yield* visible(a.page, "Email checked");
    // P21/P28's real device linking flow, so the observer has its own live person key.
    const observer = yield* launch(instance, "Device D");
    yield* play(() => observer.page.getByRole("button", { name: "Link a device" }).click());
    const linkCode = yield* play(() => observer.page.getByTestId("device-code").textContent());
    yield* play(() => a.page.getByRole("button", { name: "Let a device in" }).click());
    yield* play(() => a.page.getByRole("textbox", { name: "Device code" }).fill(linkCode!));
    yield* play(() => a.page.getByRole("button", { name: "Let in" }).click());
    yield* visible(observer.page, "same note after recovery");
    const before = yield* snapshot(instance);
    const b = yield* launch(instance, "Device B");
    yield* play(() => b.page.getByRole("button", { name: "Email me a code" }).click());
    const recoveryCode = yield* mailCode(instance);
    yield* play(() => b.page.getByRole("textbox", { name: "Code" }).fill(recoveryCode));
    yield* play(() => b.page.getByRole("button", { name: "Continue" }).click());
    yield* visible(b.page, "Is your old device lost or stolen?");
    expect(yield* play(() => b.page.getByRole("radio", { name: "Lost or stolen" }).isChecked())).toBe(true);
    yield* play(() => b.page.getByRole("button", { name: "Continue" }).click());
    yield* visible(b.page, "same note after recovery");
    yield* shots(b, "in");
    const after = yield* snapshot(instance);
    const added = after.added.filter((row) => !before.added.some((old) => old.id === row.id));
    expect(added).toHaveLength(1);
    expect(added[0]!.arrivedAt).toBe(EPOCH);
    yield* visible(a.page, "removed");
    yield* visible(observer.page, "A device came back by email");
    yield* visible(observer.page, added[0]!.label);
    yield* visible(observer.page, added[0]!.location);
    expect(yield* play(() => observer.page.getByRole("button", { name: /Cancel|Not me/i }).count())).toBe(0);
    expect(yield* play(() => b.page.getByText(/24 hours|Waiting/).count())).toBe(0);
    yield* shots(observer, "notice");
    yield* play(() => observer.page.getByRole("button", { name: "Devices" }).click());
    const row = observer.page.getByRole("row").filter({ hasText: "Device B" });
    yield* play(() => row.getByRole("button", { name: "Remove" }).click());
    yield* visible(b.page, "removed");
    expect(after.founding).toEqual(before.founding);
    expect(after.person).toBe(before.person);
    expect(after.name).toBe(before.name);
    expect(after.notes).toEqual(before.notes);
  }).pipe(Effect.provide(NodeServices.layer)),
);
