// P14, next/ (Tier 1, ticket 286): the first browser window, on the real stage with real Chromium
// (check 1, p29 and the key, storage, Strict Mode and shot laws of the plan's "Laws" and "Browser
// checks, measurements and shots"). Written before the window, so each test is red until the built
// page exists. It starts the real `dev.ts` and drives the real buttons; it installs no client in the
// page and fulfils no page. Run it with the command the plan gives:
//   nice -n 19 pnpm exec vitest run --maxWorkers=1 --root next/apps/fabrika/e2e --fileParallelism=false \
//     --testTimeout=120000 --hookTimeout=120000 first-window.test.ts
// Every test here is a scenario: real WebCrypto, IndexedDB, grant signing, reload and a 4003 close
// cannot be had without the built tab and OS processes.
import { readFileSync } from "node:fs";
import { ClientRow } from "@kampus/libfabrika";
import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanup,
  connection,
  counts,
  grant,
  openProfile,
  otherKey,
  press,
  readWaiting,
  revoke,
  runGrant,
  shot,
  startStage,
  until,
  type Stage,
} from "./p14.test-support.ts";

let stage: Stage;
const profiles: Array<() => Promise<void>> = [];

beforeAll(async () => {
  stage = await startStage("p14-first");
}, 180_000);

afterAll(async () => {
  for (const close of profiles.splice(0)) {
    await close().catch(() => undefined);
  }

  await stage?.stop();

  if (stage !== undefined) {
    cleanup(stage.home);
  }
});

const profile = async (dir?: string) => {
  const p = await openProfile(dir);
  profiles.push(p.close);
  return p;
};

const waiting = (page: import("playwright").Page) => page.getByTestId("grant-code").first();
const isClientRow = Schema.is(ClientRow);

/** Presses each tile's real "Back to zero" until every count reads 0. A repeated counter is reset once. */
const zero = async (page: import("playwright").Page): Promise<void> => {
  for (let i = 0; i < (await counts(page)).length; i++) {
    if ((await counts(page))[i] !== 0) {
      await press(page, "Back to zero", i);
      await until(`tile ${i} to read 0`, async () => ((await counts(page))[i] === 0 ? true : undefined));
    }
  }
};

const counters = (page: import("playwright").Page) => page.getByRole("region", { name: /^counter/i });

describe("check 1 and p29: one code, a real grant, entry without a reload, a stable key", () => {
  it("scenario: two tabs show one code, one command grants both, a reload asks nothing, a wrong signer is refused, a removed key says so and Ask again starts a new wait", async () => {
    const dir = `${stage.home}/profile-a`;
    const p = await profile(dir);
    const one = await p.tab(stage.url);
    const two = await p.tab(stage.url);
    const w1 = await readWaiting(stage, one);
    const w2 = await readWaiting(stage, two);
    expect(w2.code, "both tabs share the profile key, so one code").toBe(w1.code);
    expect(w2.fingerprint).toBe(w1.fingerprint);
    expect(w1.command).toContain(`grant.ts client`);
    expect(w1.command).toContain(w1.fingerprint);
    expect(w1.command).toContain(w1.code);

    // A signer the person never trusted is refused, and the tabs stay waiting.
    const stranger = otherKey(stage.home, "stranger");
    await expect(runGrant(stage, w1.fingerprint, w1.code, stranger)).rejects.toThrow();
    expect(await waiting(one.page).isVisible(), "the tab still waits").toBe(true);

    // The real command grants both tabs at once, with no reload.
    let navigations = 0;
    one.page.on("framenavigated", () => navigations++);
    two.page.on("framenavigated", () => navigations++);
    const granted = await grant(stage, one);
    await counters(two.page).first().waitFor({ timeout: 30_000 });
    expect(navigations, "entry needs no reload").toBe(0);
    expect(await counts(one.page)).toEqual([0, 0]);
    expect(await connection(one.page)).toMatch(/online/i);

    // A reload shows no approval screen and keeps the same key.
    await one.page.reload();
    await counters(one.page).first().waitFor({ timeout: 30_000 });
    expect(await waiting(one.page).count(), "no approval screen after a reload").toBe(0);

    // The removed key: a close 4003 shows the words and stops reconnecting with that key.
    await revoke(stage, granted);
    await one.page.getByText("This window was removed").waitFor({ timeout: 30_000 });
    const sockets = one.urls.filter((u) => u.startsWith("ws")).length;
    await new Promise((done) => setTimeout(done, 3_000));
    expect(one.urls.filter((u) => u.startsWith("ws")).length, "no reconnect with a removed key").toBe(sockets);
    await shot(one.page, "frame", "removed", "one");

    // Ask again replaces only the rejected identity and starts a fresh wait with a new fingerprint.
    await one.page.getByRole("button", { name: /ask again/i }).click();
    const fresh = await readWaiting(stage, one);
    expect(fresh.fingerprint).not.toBe(granted.fingerprint);
    await two.page.reload();
    expect((await readWaiting(stage, two)).fingerprint, "a concurrent tab reuses the replacement").toBe(
      fresh.fingerprint,
    );
    await grant(stage, one);
    expect(await counts(one.page)).toEqual([0, 0]);
  });

  it("scenario: the key survives a browser restart, and it is not extractable or wrappable", async () => {
    const dir = `${stage.home}/profile-b`;
    const first = await openProfile(dir);
    const tab = await first.tab(stage.url);
    const granted = await grant(stage, tab);
    // Read-only inspection of whatever the page stored: one key pair, and the private half refuses export.
    const report = await tab.page.evaluate(async () => {
      const found: Array<{
        db: string;
        store: string;
        extractable: boolean | null;
        exportRefused: boolean;
        wrapRefused: boolean;
      }> = [];

      for (const info of await indexedDB.databases()) {
        const db = await new Promise<IDBDatabase>((done, fail) => {
          const open = indexedDB.open(info.name ?? "");
          open.onsuccess = () => done(open.result);
          open.onerror = () => fail(open.error);
        });

        for (const store of Array.from(db.objectStoreNames)) {
          const rows = await new Promise<Array<unknown>>((done, fail) => {
            const all = db.transaction(store).objectStore(store).getAll();
            all.onsuccess = () => done(all.result);
            all.onerror = () => fail(all.error);
          });

          for (const row of rows) {
            const pair = [row, ...(typeof row === "object" && row !== null ? Object.values(row) : [])].find(
              (v): v is CryptoKeyPair => typeof v === "object" && v !== null && "privateKey" in v,
            );

            if (pair === undefined) {
              continue;
            }

            const refuse = (work: () => Promise<unknown>) =>
              work().then(
                () => false,
                () => true,
              );
            found.push({
              db: info.name ?? "",
              store,
              extractable: pair.privateKey.extractable,
              exportRefused: await refuse(() => crypto.subtle.exportKey("pkcs8", pair.privateKey)),
              wrapRefused: await refuse(async () =>
                crypto.subtle.wrapKey(
                  "raw",
                  pair.privateKey,
                  await crypto.subtle.generateKey("AES-KW", false, ["wrapKey"]),
                  "AES-KW",
                ),
              ),
            });
          }
        }

        db.close();
      }

      return found;
    });
    expect(report, "exactly one key pair is stored").toHaveLength(1);
    expect(report[0]).toMatchObject({ extractable: false, exportRefused: true, wrapRefused: true });
    await first.close();
    // A new browser on the same profile directory: same key, no approval.
    const second = await profile(dir);
    const again = await second.tab(stage.url);
    await counters(again.page).first().waitFor({ timeout: 30_000 });
    expect(await waiting(again.page).count(), "no approval after a browser restart").toBe(0);
    void granted;
  });

  it("scenario: a failed key store is a visible blocked screen, and no key is made or kept in readable storage", async () => {
    const p = await profile();
    await p.context.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", {
        value: {
          open: () => {
            throw new DOMException("denied", "SecurityError");
          },
          databases: () => Promise.resolve([]),
        },
      });
    });
    const tab = await p.tab(stage.url);
    await tab.page
      .getByText(/blocked/i)
      .first()
      .waitFor({ timeout: 30_000 });
    const stored = await tab.page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        cookie: document.cookie,
      }),
    );
    expect(stored).not.toMatch(/PRIVATE|pkcs8|"d":/);
    expect(await waiting(tab.page).count(), "a blocked tab shows no grant code").toBe(0);
  });
});

describe("Strict Mode and the selector hook", () => {
  it("scenario: one live client per tab under Strict Mode, current typed counts, and a clean console", async () => {
    const p = await profile();
    const tab = await p.tab(stage.url);
    await grant(stage, tab);
    const sockets = tab.urls.filter((u) => u.startsWith("ws")).length;
    expect(sockets, "Strict Mode starts one socket, not two").toBe(1);
    // The stage is shared by this file's cases, so the counts start where an earlier case left them.
    const [one = 0, two = 0] = await counts(tab.page);
    await press(tab.page, "Add one", 0);
    await press(tab.page, "Add one", 0);
    await press(tab.page, "Take one away", 1);
    await until("the counts to settle", async () =>
      (await counts(tab.page)).join() === `${one + 2},${two - 1}` ? true : undefined,
    );
    await press(tab.page, "Back to zero", 0);
    await until("the reset", async () => ((await counts(tab.page)).join() === `0,${two - 1}` ? true : undefined));

    for (const n of await counts(tab.page)) {
      expect(Number.isInteger(n)).toBe(true);
    }

    expect(
      tab.console.filter((l) => /^(error|warning|pageerror)/.test(l)),
      "no console failure",
    ).toEqual([]);
    expect(tab.urls.filter((u) => u.startsWith("ws")).length).toBe(1);
  });
});

// P14, the tab's half of the plan's law "Browser records survive failed delivery until durable
// acknowledgement, retain safe measurements and are idempotent" (its door half is in
// src/door-spans.test.ts). The shape this holds the page to: the browser adapter keeps each
// unacknowledged `ClientRow` (app/client.ts) in IndexedDB, the press row before its letter is sent,
// and deletes a row only when `client.record` acknowledges its id. The test reads every IndexedDB
// store read-only and keeps the values that decode as a `ClientRow`; it assumes no database or
// store name. The queue is plain data, not a machine (0037's T2): no stored value decides which
// add, send or acknowledgement is legal next.
describe("browser records: the tab keeps its rows until the door acknowledges them", () => {
  /** Every value in every IndexedDB store of the page that decodes as a ClientRow, read only. */
  const queued = async (page: import("playwright").Page): Promise<ReadonlyArray<ClientRow>> => {
    const values = await page.evaluate(async () => {
      const found: Array<unknown> = [];

      for (const info of await indexedDB.databases()) {
        const db = await new Promise<IDBDatabase>((done, fail) => {
          const open = indexedDB.open(info.name ?? "");
          open.onsuccess = () => done(open.result);
          open.onerror = () => fail(open.error);
        });

        for (const store of Array.from(db.objectStoreNames)) {
          const rows = await new Promise<Array<unknown>>((done, fail) => {
            const all = db.transaction(store).objectStore(store).getAll();
            all.onsuccess = () => done(all.result);
            all.onerror = () => fail(all.error);
          });

          for (const row of rows) {
            for (const v of [row, ...(typeof row === "object" && row !== null ? Object.values(row) : [])]) {
              if (typeof v === "object" && v !== null && "id" in v && "record" in v) {
                found.push(JSON.parse(JSON.stringify(v)));
              }
            }
          }
        }

        db.close();
      }

      return found;
    });
    return values.filter(isClientRow);
  };
  const pressRows = (rows: ReadonlyArray<ClientRow>) => rows.filter((r) => r.record._tag === "press");

  // Plant: a ClientRow put into a throwaway database must be found by the same read.
  it("scenario: the read finds a row planted in any IndexedDB store", async () => {
    const p = await profile();
    const tab = await p.tab(stage.url);
    const planted: ClientRow = {
      id: "row_planted",
      tab: "tab_planted",
      build: "test",
      sentAt: "2026-11-10T00:00:00.000Z",
      record: { _tag: "persist", result: "granted" },
    };
    await tab.page.evaluate(
      (row) =>
        new Promise<void>((done, fail) => {
          const open = indexedDB.open("p14-plant");
          open.onupgradeneeded = () => open.result.createObjectStore("rows", { keyPath: "id" });
          open.onsuccess = () => {
            const tx = open.result.transaction("rows", "readwrite");
            tx.objectStore("rows").put(row);
            tx.oncomplete = () => {
              open.result.close();
              done();
            };
            tx.onerror = () => fail(tx.error);
          };
          open.onerror = () => fail(open.error);
        }),
      planted,
    );
    expect((await queued(tab.page)).map((r) => r.id)).toContain("row_planted");
  });

  // The plan's "What P14 records": `client.key` outcomes go through the client record queue, as
  // key reuse or rotation. Before admission the door keeps nothing for a stranger, so a waiting tab
  // still holds its key rows, where this read sees them. Scenario: only real WebCrypto, IndexedDB and
  // a reload of the built tab make a key and then reuse it.
  it("scenario: a waiting tab keeps its key row as created, a reload keeps one as reused, and both leave once the tab is granted", async () => {
    const p = await profile(`${stage.home}/profile-key-rows`);
    const tab = await p.tab(stage.url);
    await waiting(tab.page).waitFor({ timeout: 30_000 });
    const keyRows = async () =>
      (await queued(tab.page)).filter((r): r is ClientRow & { record: { _tag: "key" } } => r.record._tag === "key");
    const made = await until("the key row to be kept", async () => {
      const rows = await keyRows();
      return rows.length > 0 ? rows : undefined;
    });
    expect(
      made.map((r) => r.record.result),
      "a first load makes the key, once",
    ).toEqual(["created"]);
    await tab.page.reload();
    await waiting(tab.page).waitFor({ timeout: 30_000 });
    const both = await until("the reload's key row to be kept", async () => {
      const rows = await keyRows();
      return rows.length > 1 ? rows : undefined;
    });
    expect(both.map((r) => r.record.result).sort(), "a reload reuses the stored key and says so").toEqual([
      "created",
      "reused",
    ]);
    expect(new Set(both.map((r) => r.id)).size, "each row has its own id").toBe(2);
    await grant(stage, tab);
    await until(
      "the key rows to be delivered and acknowledged",
      async () => {
        const ids = (await queued(tab.page)).map((r) => r.id);
        return both.every((r) => !ids.includes(r.id)) ? true : undefined;
      },
      60_000,
    );
  });

  it("scenario: a press made while the stage is down stays queued through the outage and a closed browser, and leaves once delivered", async () => {
    const dir = `${stage.home}/profile-records`;
    const first = await profile(dir);
    const tab = await first.tab(stage.url);
    await grant(stage, tab);
    await stage.stop();
    let held: ReadonlyArray<string> = [];

    // The stage is shared by this file's cases, so it starts again however this part ends.
    try {
      await until("the frame to say so", async () =>
        /offline|reconnecting/i.test(await connection(tab.page)) ? true : undefined,
      );
      await press(tab.page, "Add one", 0);
      held = await until("the press row to be stored", async () => {
        const rows = pressRows(await queued(tab.page));
        return rows.length > 0 ? rows.map((r) => r.id) : undefined;
      });
      // Failed delivery: the rows stay while the brain is down. Plant: drop a row on a failed send.
      await new Promise((done) => setTimeout(done, 3_000));
      expect(
        (await queued(tab.page)).map((r) => r.id),
        "the outage drops no row",
      ).toEqual(expect.arrayContaining(held));
      await first.close();
    } finally {
      await stage.start();
    }

    // A new browser on the same profile delivers what the closed one kept, and deletes each row
    // only once it is acknowledged.
    const second = await profile(dir);
    const again = await second.tab(stage.url);
    await counters(again.page).first().waitFor({ timeout: 30_000 });
    await until(
      "the kept rows to be delivered and acknowledged",
      async () => {
        const ids = (await queued(again.page)).map((r) => r.id);
        return held.every((id) => !ids.includes(id)) ? true : undefined;
      },
      60_000,
    );
  });
});

describe("[secrets] private key data and control credentials stay out of every output", () => {
  // A flow over made-up sentinels: the person's throwaway private key body, its encoded forms, and
  // each output the page and stage produce. The check is planted on each output below.
  const forms = (s: string): ReadonlyArray<string> => [
    s,
    Buffer.from(s).toString("base64"),
    encodeURIComponent(s),
    Buffer.from(s).toString("hex"),
  ];
  const leaks = (sentinels: ReadonlyArray<string>, outputs: Readonly<Record<string, string>>): ReadonlyArray<string> =>
    Object.entries(outputs).flatMap(([name, text]) =>
      sentinels.flatMap((s) =>
        forms(s)
          .filter((f) => f.length >= 12 && text.includes(f))
          .map(() => name),
      ),
    );

  it("scenario: the page, script, URLs, console, storage and stage output hold none of the key", async () => {
    const p = await profile();
    const tab = await p.tab(stage.url);
    await grant(stage, tab);
    await press(tab.page, "Add one", 0);
    const body = readFileSync(stage.key, "utf8")
      .split("\n")
      .filter((l) => l.length > 20 && !l.startsWith("-----"));
    const html = await tab.page.content();
    const script = await (await fetch(`${stage.url}/window.js`)).text();
    const storage = await tab.page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    );
    const outputs = {
      html,
      script,
      urls: tab.urls.join("\n"),
      console: tab.console.join("\n"),
      storage,
      stage: stage.output(),
    };
    expect(leaks(body, outputs)).toEqual([]);

    // The planted leak: the same check on each output with one sentinel put into it must name it.
    for (const name of Object.keys(outputs)) {
      expect(
        leaks(body, {
          ...outputs,
          [name]: `${outputs[name as keyof typeof outputs]}\n${body[0] ?? ""}`,
        }),
        `a leak planted in ${name}`,
      ).toContain(name);
    }
  });
});

describe("shots: the built page at five arrangements", () => {
  const layouts = [
    ["one", "one", { width: 1280, height: 800 }],
    ["side", "row", { width: 1280, height: 800 }],
    ["stacked", "col", { width: 1280, height: 800 }],
    ["grid", "grid", { width: 1280, height: 800 }],
    ["small", "grid", { width: 1024, height: 700 }],
  ] as const;

  for (const [name, query, size] of layouts) {
    it(`scenario: waiting, granted at zero and after a press, at ${name}`, async () => {
      const p = await profile();
      const tab = await p.tab(`${stage.url}/?layout=${query}`, size);
      await waiting(tab.page).waitFor({ timeout: 30_000 });
      await shot(tab.page, "frame", "waiting", name);
      await grant(stage, tab);
      expect(await counts(tab.page)).toHaveLength(query === "one" ? 1 : query === "grid" ? 4 : 2);
      // The shot is "granted with the counter at zero"; earlier cases on this stage moved the counts.
      await zero(tab.page);
      await shot(tab.page, "counter", "granted", name);
      await press(tab.page, "Add one", 0);
      await until("the press", async () => ((await counts(tab.page))[0] === 1 ? true : undefined));
      await shot(tab.page, "counter", "pressed", name);

      // Counts, actions and status stay usable at every size: each button is visible and inside the tab.
      for (const button of await tab.page.getByRole("button", { name: /Add one|Take one away|Back to zero/ }).all()) {
        const box = await button.boundingBox();
        expect(box, "a button is on screen").not.toBeNull();
        expect((box?.x ?? -1) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width + 1);
        expect((box?.y ?? -1) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height + 1);
      }
    });
  }

  it("scenario: a light look and forced colors keep the counts and actions in view", async () => {
    const p = await profile();
    const tab = await p.tab(stage.url);
    await grant(stage, tab);

    for (const media of [{ colorScheme: "light" }, { forcedColors: "active" }] as const) {
      await tab.page.emulateMedia(media);

      for (const button of await tab.page.getByRole("button", { name: /Add one|Take one away|Back to zero/ }).all()) {
        expect(await button.isVisible(), `${JSON.stringify(media)}: a button is visible`).toBe(true);
      }

      expect(await tab.page.getByTestId("count").first().isVisible(), "the count is visible").toBe(true);
      await shot(tab.page, "frame", `${Object.keys(media)[0]}`, "one");
    }
  });
  it("scenario: a stopped stage shows the disconnected frame with the last count kept", async () => {
    const p = await profile();
    const tab = await p.tab(stage.url);
    await grant(stage, tab);
    // The stage is shared by this file's cases, so the press is counted from where it starts.
    const start = (await counts(tab.page))[0] ?? Number.NaN;
    await press(tab.page, "Add one", 0);
    await until("the press", async () => ((await counts(tab.page))[0] === start + 1 ? true : undefined));
    await stage.stop();
    await until("the frame to say so", async () =>
      /offline|reconnecting/i.test(await connection(tab.page)) ? true : undefined,
    );
    expect((await counts(tab.page))[0], "the last checked count stays visible").toBe(start + 1);
    await shot(tab.page, "frame", "disconnected", "one");
    await stage.start();
    await until(
      "the tab to recover",
      async () => (/online/i.test(await connection(tab.page)) ? true : undefined),
      60_000,
    );
  });
});
