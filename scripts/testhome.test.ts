import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, relative } from "node:path";
import { expect, it } from "vitest";

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
    "nice",
    [
      "-n",
      "19",
      "volta",
      "run",
      "--node",
      "26.13.0",
      "pnpm",
      "exec",
      "vitest",
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
