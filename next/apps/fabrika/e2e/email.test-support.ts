// P36, next/. Scoped Alchemy runtime and real Electron. No live sender or account.
import { Effect, FileSystem, Path, Schema } from "effect";
import type { Page } from "playwright";
import { launch as launchWindow, type TestWindow } from "../test-window.ts";
import { startWorker } from "./email-worker.test-support.ts";

export const EPOCH = 1_800_000_000_000;

export const IntegrationFlow = Schema.Struct({
  live: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 })),
  requests: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 })),
  reopen: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  offset: Schema.Literals([-1, 0, 1]),
  old: Schema.Literals(["lost", "kept"]),
  label: Schema.String.check(Schema.isMaxLength(64)),
});

export const INTEGRATION = {
  arbitrary: { seed: 119120, runs: 30, size: 40, maxDiscards: 500, maxShrinks: 200, concurrency: 1 },
};

export type IntegrationFlow = typeof IntegrationFlow.Type;
export type Mail = { readonly to: string; readonly raw: string };

export type Snapshot = {
  readonly founding: unknown;
  readonly person: string;
  readonly name: string;
  readonly notes: unknown;
  readonly rev: number;
  readonly members: ReadonlyArray<string>;
  readonly added: ReadonlyArray<{
    readonly id: string;
    readonly arrivedAt: number;
    readonly label: string;
    readonly location: string;
  }>;
  readonly outputs: Record<string, ReadonlyArray<unknown>>;
};

export type Session = { readonly id: string; readonly key: string; readonly token: string };

export interface Instance {
  readonly home: string;
  readonly url: string;
  readonly call: <A>(path: string, body?: unknown) => Effect.Effect<A, unknown>;
}

// The response boundary is private to this exam; the law checks every observed result.
const request = Effect.fn("emailExam.request")(function* <A>(url: string, path: string, body?: unknown) {
  // oxlint-disable-next-line fabrika/no-promises -- edge: the HTTP fetch boundary returns a Promise
  const response = yield* Effect.tryPromise(() =>
    fetch(
      new URL(path, url),
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    ),
  );

  if (!response.ok) {
    return yield* Effect.fail(new Error("P36 instance refused request"));
  }

  // oxlint-disable-next-line fabrika/no-promises -- edge: a web Response decodes JSON through a Promise
  const value: unknown = yield* Effect.tryPromise(() => response.json());
  return value as A;
});

export const openInstance = Effect.fn("emailExam.openInstance")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* fs.makeTempDirectoryScoped({ directory: "/tmp", prefix: "fh." });
  const url = yield* startWorker(home);
  return { home, url, call: <A>(path: string, body?: unknown) => request<A>(url, path, body) } satisfies Instance;
});

export const mailCode = Effect.fn("emailExam.mailCode")(function* (instance: Instance) {
  const mails = yield* instance.call<ReadonlyArray<Mail>>("/__test/mail");
  const mail = mails.at(-1);

  if (mail === undefined) {
    return yield* Effect.fail(new Error("Stand-in sender received no mail"));
  }

  const match = /(?:^|\D)(\d{6})(?:\D|$)/.exec(mail.raw);

  if (match === null || match[1] === undefined) {
    return yield* Effect.fail(new Error("Stand-in sender received no six-digit code"));
  }

  return match[1];
});

export const device = (instance: Instance, label: string) => instance.call<Session>("/__test/device", { label });
export const snapshot = (instance: Instance) => instance.call<Snapshot>("/__test/snapshot");
export const clock = (instance: Instance, at: number) => instance.call("/__test/clock", { at });

export const checkedAddress = Effect.fn("emailExam.checkedAddress")(function* (instance: Instance, session: Session) {
  const challenge = yield* instance.call<{ id: string }>("/email/setup", {
    device: session,
    address: "p36@example.test",
  });
  return yield* instance.call("/email/verify", {
    device: session,
    challenge: challenge.id,
    code: yield* mailCode(instance),
  });
});

export const redeem = Effect.fn("emailExam.redeem")(function* (
  instance: Instance,
  session: Session,
  old: "lost" | "kept",
) {
  const challenge = yield* instance.call<{ id: string }>("/email/recovery", { device: session });
  return yield* instance.call<{ id: string; added: string }>("/email/redeem", {
    device: session,
    challenge: challenge.id,
    code: yield* mailCode(instance),
    old,
    check: "touch",
  });
});

export const launch = (instance: Instance, label: string) => launchWindow({ instance: instance.url, label });
export type Window = TestWindow;

// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright exposes renderer operations through Promise APIs
export const play = <A>(action: () => PromiseLike<A>) => Effect.tryPromise(() => action());

export const visible = (page: Page, text: string) =>
  play(() => page.getByText(text, { exact: false }).waitFor({ state: "visible" }));

export const shots = Effect.fn("emailExam.shots")(function* (window: Window, state: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(window.home, "email-shots");
  yield* fs.makeDirectory(folder, { recursive: true });

  for (const layout of ["full", "side-by-side", "stacked", "grid", "small"]) {
    yield* play(() =>
      window.page.setViewportSize(layout === "small" ? { width: 1024, height: 700 } : { width: 1440, height: 900 }),
    );

    if (layout === "side-by-side" || layout === "grid") {
      yield* play(() => window.page.keyboard.press("Control+b"));
      yield* play(() => window.page.keyboard.press("|"));
    }

    if (layout === "stacked" || layout === "grid") {
      yield* play(() => window.page.keyboard.press("Control+b"));
      yield* play(() => window.page.keyboard.press("-"));
    }

    yield* play(() => window.page.screenshot({ path: path.join(folder, `${state}-${layout}.png`) }));
  }
});
