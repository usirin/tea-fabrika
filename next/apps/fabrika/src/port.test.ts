// next/, the laws of the test port helper. An instance test's port must not be one the OS, or another
// test process, can be given while the instance is still starting.
import { createServer } from "node:net";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { heldPort } from "./port.test-support.ts";

// What another process sees when it tries the same port: the error code, or null when it binds.
const refused = (port: number) =>
  new Promise<string | null>((done) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => done(error.code ?? "error"));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(() => done(null)));
  });

it("scenario: ports held at the same time are all different, below the OS-assigned ranges, and free to bind", async () => {
  // scenario: the kernel's port table is the thing under test, so the ports are real ones.
  const held = await Promise.all(Array.from({ length: 8 }, () => Effect.runPromise(heldPort())));

  try {
    expect(new Set(held.map((h) => h.port)).size).toBe(held.length);

    for (const h of held) {
      // Linux hands out 32768 and up by default, macOS 49152 and up.
      expect(h.port).toBeGreaterThanOrEqual(20000);
      expect(h.port).toBeLessThan(32768);
      expect(await refused(h.port)).toBeNull();
    }
  } finally {
    await Promise.all(held.map((h) => Effect.runPromise(h.release)));
  }
});

it("scenario: a held pair refuses a second taker until it is released", async () => {
  // scenario: a second listener on the lock port stands in for another test process.
  const held = await Effect.runPromise(heldPort());

  try {
    expect(await refused(held.port - 1)).toBe("EADDRINUSE");
  } finally {
    await Effect.runPromise(held.release);
  }

  expect(await refused(held.port - 1)).toBeNull();
});

it("scenario: a released pair is not the next one handed out in the same process", async () => {
  // scenario: an in-process instance leaves the runtime's 30-second note on its port, so a test
  // that got the same port right after would be refused.
  const first = await Effect.runPromise(heldPort());
  await Effect.runPromise(first.release);
  const second = await Effect.runPromise(heldPort());
  await Effect.runPromise(second.release);
  expect(second.port).not.toBe(first.port);
});
