// P36, next/: local workerd and real Electron only. No network or Cloudflare account is used.
// The Project constructor and app entry paths are provisional P24/P26/P28 contracts. The lead
// reconciles them before build, as the approved plan requires. Never substitute a fake project.
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { Schema } from "effect";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { _electron, type ElectronApplication, type Page } from "playwright";

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
  readonly mails: Mail[];
  readonly url: string;
  readonly call: <A>(path: string, body?: unknown) => Promise<A>;
  readonly close: () => Promise<void>;
}

// P24/P26 test driver contract. Only these private test paths are handled by this wrapper. All
// public email, grant, watch and admission requests run the real Project and P10 door.
const wrapper = (projectPath: string) => `
import {Project} from ${JSON.stringify(projectPath)};
import {Effect, Redacted} from "effect";
let now = ${EPOCH};
export class EmailExam extends Project {
  constructor(ctx, env) {
    super(ctx, {...env, emailClock: Effect.sync(() => now),
      emailSender: {send: (mail) => Effect.tryPromise(() => env.MAIL.fetch(new Request("https://mail.example.test/", {method:"POST", body: JSON.stringify({to: Redacted.value(mail.to), raw: Redacted.value(mail.code)})})))},
      personCheck: Effect.succeed("touch")});
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__test/clock") {now = (await request.json()).at; return Response.json({ok:true});}
    if (url.pathname === "/__test/snapshot") return Response.json(await this.emailTestSnapshot());
    if (url.pathname === "/__test/device") return Response.json(await this.emailTestDevice(await request.json()));
    return super.fetch(request);
  }
}
export default {fetch(request, env) {return env.PROJECT.getByName("p36-test").fetch(request);}};
`;

// These two observation hooks must be installed on the real object by the test wrapper, not
// added to production: tests read its real ledger/storage and found test devices through P10.
// Missing upstream hooks stay red until the lead reconciles the actual public test access.
export async function openInstance(): Promise<Instance> {
  const home = await mkdtemp("/tmp/fh.");
  const mails: Mail[] = [];
  let mf: Miniflare | undefined;

  try {
    const project = resolve(import.meta.dirname, "../../../packages/libfabrika/src/cloudflare/objects.ts");
    const compiled = await build({
      stdin: {
        contents: wrapper(project),
        resolveDir: resolve(import.meta.dirname, ".."),
        sourcefile: "email.test-worker.ts",
        loader: "ts",
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["cloudflare:workers"],
      logLevel: "silent",
    });
    mf = new Miniflare({
      modules: true,
      script: compiled.outputFiles[0]!.text,
      compatibilityDate: "2026-11-08",
      durableObjects: { PROJECT: { className: "EmailExam", useSQLite: true } },
      durableObjectsPersist: join(home, "objects"),
      serviceBindings: {
        MAIL: async (request) => {
          const value: Mail = await request.json();
          mails.push(value);
          return new Response(null, { status: 202 });
        },
      },
      // Every external call is refused. MAIL is the only stand-in send destination.
      outboundService: () => new Response("No network in P36 tests", { status: 502 }),
    });
    const active = mf;
    const url = String(await active.ready);
    return {
      home,
      mails,
      url,
      call: async <A>(path: string, body?: unknown): Promise<A> => {
        const response = await active.dispatchFetch(
          `https://project.example.test${path}`,
          body === undefined
            ? undefined
            : {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              },
        );

        if (!response.ok) {
          throw new Error(`P36 instance refused ${path}: ${response.status}`);
        }

        return (await response.json()) as A;
      },
      close: async () => {
        await active.dispose();
        await rm(home, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await mf?.dispose();
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}

export const mailCode = (instance: Instance) => {
  const mail = instance.mails.at(-1);

  if (mail === undefined) {
    throw new Error("Stand-in sender received no mail");
  }

  const match = /(?:^|\D)(\d{6})(?:\D|$)/.exec(mail.raw);

  if (match === null) {
    throw new Error("Stand-in sender received no six-digit code");
  }

  return match[1]!;
};

export const device = (instance: Instance, label: string): Promise<Session> =>
  instance.call("/__test/device", { label });

export const snapshot = (instance: Instance): Promise<Snapshot> => instance.call("/__test/snapshot");
export const clock = (instance: Instance, at: number) => instance.call("/__test/clock", { at });

export const checkedAddress = async (instance: Instance, session: Session) => {
  const challenge = await instance.call<{ id: string }>("/email/setup", {
    device: session,
    address: "p36@example.test",
  });
  return instance.call("/email/verify", {
    device: session,
    challenge: challenge.id,
    code: mailCode(instance),
  });
};

export const redeem = async (instance: Instance, session: Session, old: "lost" | "kept") => {
  const challenge = await instance.call<{ id: string }>("/email/recovery", { device: session });
  return instance.call<{ id: string; added: string }>("/email/redeem", {
    device: session,
    challenge: challenge.id,
    code: mailCode(instance),
    old,
    check: "touch",
  });
};

export const launch = async (instance: Instance, label: string) => {
  const home = await mkdtemp("/tmp/fh.");

  try {
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      FABRIKA_HOME: home,
      FABRIKA_TEST_INSTANCE: instance.url,
      FABRIKA_TEST_PERSON_CHECK: "touch",
      FABRIKA_TEST_DEVICE_LABEL: label,
    };
    delete env.TYPESAFE_API_KEY;
    delete env.FABRIKA_FOREGROUND;
    const require = createRequire(import.meta.url);
    const executablePath: string = require("electron");
    const app = await _electron.launch({
      executablePath,
      args: [resolve(import.meta.dirname, "../electron/main.ts")],
      env,
    });
    const page = await app.firstWindow();
    return {
      app,
      page,
      home,
      close: async () => {
        await app.close();
        await rm(home, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(home, { recursive: true, force: true });
    throw error;
  }
};

export type Window = {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly home: string;
  readonly close: () => Promise<void>;
};

export const visible = async (page: Page, text: string) => {
  await page.getByText(text, { exact: false }).waitFor({ state: "visible" });
};

export const shots = async (window: Window, state: string) => {
  const folder = join(window.home, "email-shots");
  await mkdir(folder, { recursive: true });

  for (const layout of ["full", "side-by-side", "stacked", "grid", "small"]) {
    await window.page.setViewportSize(layout === "small" ? { width: 1024, height: 700 } : { width: 1440, height: 900 });

    // P28 uses the real desk. These key chords split its tiles, never draw a mock recovery view.
    if (layout === "side-by-side" || layout === "grid") {
      await window.page.keyboard.press("Control+b");
      await window.page.keyboard.press("|");
    }

    if (layout === "stacked" || layout === "grid") {
      await window.page.keyboard.press("Control+b");
      await window.page.keyboard.press("-");
    }

    await window.page.screenshot({ path: join(folder, `${state}-${layout}.png`) });
  }
};
