import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { expect, it } from "vitest";
import { testHomes } from "./testhome.ts";

// L6 plants: retain an inherited home, use <= at 103 bytes, or retain an XDG key.
it("L6 testHomes isolates homes at the socket boundary and preserves toolchains", () => {
  const optional = fc.option(fc.string(), { nil: undefined });
  fc.assert(
    fc.property(
      fc.record({
        home: optional,
        app: optional,
        volta: optional,
        pnpm: optional,
        // pinned: 82, 83 and 84 straddle the 103-byte socket path (length + 20), so `<=` for `<` dies.
        length: fc.oneof(fc.integer({ min: 60, max: 110 }), fc.constantFrom(82, 83, 84)),
      }),
      ({ home, app, volta, pnpm, length }) => {
        const base = mkdtempSync("/tmp/l6-");
        const temp = join(base, "t".repeat(length - base.length - 1));
        mkdirSync(temp);
        const env: NodeJS.ProcessEnv = { HOME: home, FABRIKA_HOME: app, VOLTA_HOME: volta, PNPM_HOME: pnpm };
        const keys = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"];

        for (const key of keys) {
          env[key] = home ?? "inherited";
        }

        const made: string[] = [];

        try {
          const root = length + Buffer.byteLength("/fh-XXXXXX/host/sock") < 103 ? temp : "/tmp";

          for (let call = 0; call < 2; call++) {
            testHomes(env, temp);

            for (const key of ["HOME", "FABRIKA_HOME"]) {
              const folder = env[key]!;
              expect(dirname(folder)).toBe(root);
              expect(folder).not.toBe(home);
              expect(folder).not.toBe(app);
              expect(made).not.toContain(folder);
              made.push(folder);
              expect(readdirSync(folder)).toEqual([]);
            }

            expect(Buffer.byteLength(join(env.FABRIKA_HOME!, "host", "sock"))).toBeLessThan(103);

            for (const key of keys) {
              expect(env).not.toHaveProperty(key);
            }

            expect(env.VOLTA_HOME).toBe(volta);
            expect(env.PNPM_HOME).toBe(pnpm);
          }
        } finally {
          for (const folder of made) {
            rmSync(folder, { recursive: true, force: true });
          }

          rmSync(base, { recursive: true, force: true });
        }
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});

// scenario: one real worker under the repository's configured pool.
// L4 plant: change only a copied environment, leaving the worker HOME untouched.
it("scenario: L4 worker sees an isolated home and no XDG folders", () => {
  if (process.env.TEST_HOME_WORKER === "1") {
    expect(homedir()).toBe(process.env.HOME);
    const child = relative(tmpdir(), homedir());
    expect(child.length).toBeGreaterThan(0);
    expect(child.startsWith("..") || isAbsolute(child)).toBe(false);

    for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
      expect(process.env[key]).toBeUndefined();
    }

    expect(process.env.VOLTA_HOME).toBe(process.env.TEST_VOLTA_HOME);
    expect(process.env.PNPM_HOME).toBe(process.env.TEST_PNPM_HOME);
    return;
  }

  const ran = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("vitest.mjs", import.meta.resolve("vitest/package.json"))),
      "run",
      "--maxWorkers=1",
      "scripts/testhome.test.ts",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TYPESAFE_API_KEY: undefined,
        TEST_HOME_WORKER: "1",
        TMPDIR: "/tmp",
        TEST_VOLTA_HOME: process.env.VOLTA_HOME,
        TEST_PNPM_HOME: process.env.PNPM_HOME,
        XDG_CONFIG_HOME: "/inherited/config",
        XDG_DATA_HOME: "/inherited/data",
        XDG_CACHE_HOME: "/inherited/cache",
        XDG_STATE_HOME: "/inherited/state",
      },
    },
  );
  expect(ran.status, ran.stderr + ran.stdout).toBe(0);
});
