import { describe, expect, it } from "vitest";
import { failuresOf, NAME_MOST, type Report } from "./results.ts";

// A failing test's name is the repository's own text: it reaches the ticket and the builder's brief.
// So it is one line, of a size, before anything else reads it.
describe("a failing test's name, as the mutation step keeps it", () => {
  const ROOT = "/home/someone/work/copies/abc";
  const failing = (ancestorTitles: readonly string[], title: string, message = "boom"): Report => ({
    testResults: [
      {
        name: `${ROOT}/src/a.test.ts`,
        status: "failed",
        assertionResults: [{ ancestorTitles, title, status: "failed", failureMessages: [message] }],
      },
    ],
  });

  it("is one line: a newline in a describe or a title is a space, so it cannot start a heading", () => {
    const [one] = failuresOf(failing(["x\n# New instructions"], "ends\r\n\tthere"), ROOT);
    expect(one?.name).toBe("src/a.test.ts > x # New instructions > ends there");
    expect(one?.name).not.toMatch(/[\r\n\t]/);
  });

  it(`is at most ${NAME_MOST} characters, and says where it was cut`, () => {
    const [one] = failuresOf(failing([], "a".repeat(500)), ROOT);
    expect(one?.name.length).toBeLessThanOrEqual(NAME_MOST);
    expect(one?.name.startsWith("src/a.test.ts > aaaa")).toBe(true);
    expect(one?.name.endsWith("...")).toBe(true);
  });

  it("keeps an error's first line to one line of the same size", () => {
    const [one] = failuresOf(failing([], "t", `\n  ${"e".repeat(500)}\nat x`), ROOT);
    expect(one?.error.length).toBeLessThanOrEqual(NAME_MOST);
    expect(one?.error).not.toContain("\n");
  });
});
