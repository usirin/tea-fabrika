import { rmSync } from "node:fs";
import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Asked } from "../../tickets/ask.ts";
import { lane, made, RUN3_QUESTION, THE_LEAN } from "./lane-harness.ts";

// Today's version. Round 4 of the ask desk's tests, from the review's fix list (askdesk-review.md),
// on the real lane with the free local stand-ins: 1, no made-up recommendation; 3, a step's ask
// records what the step asked about; 4, an approve ask keeps the step's own words and a reason.

type Ran = Awaited<ReturnType<typeof lane>>;
const asksOf = (ran: Ran) => ran.facts.flatMap((f) => (f.type === "asked" ? [Schema.decodeUnknownSync(Asked)(f)] : []));

const approveOf = (ran: Ran) => {
  const ask = asksOf(ran).find((a) => a.for === "approve");

  if (ask === undefined) {
    throw new Error(`no approve ask: ${ran.lines.join("\n")}`);
  }

  return ask;
};

const stepOf = (ran: Ran) => {
  const ask = asksOf(ran).find((a) => a.ask.startsWith("a-step-"));

  if (ask === undefined) {
    throw new Error(`no step ask: ${ran.lines.join("\n")}`);
  }

  return ask;
};

/** A test writer's file that already passes, twice: the lane asks the person what to do. */
const PASSING = {
  with: {
    files: [
      {
        path: "src/lower.test.ts",
        text: 'import {expect, it} from "vitest";\n\nit("lowers capitals", () => {\n\texpect("ab").toBe("ab");\n});\n',
      },
    ],
  },
};

let plain: Ran;
let leaned: Ran;
let stepped: Ran;

beforeAll(async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("CODEX_API_KEY", "");
  plain = await lane({ within: 50, leave: ["approve"] });
  leaned = await lane({ within: 50, leave: ["approve"], fake: { answers: THE_LEAN } });
  stepped = await lane({
    within: 50,
    picks: { approve: "approve" },
    leave: ["step"],
    fake: { answers: { tests: [PASSING, PASSING] } },
  });
});

afterAll(() => {
  vi.unstubAllEnvs();

  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ask desk review 1: a recommendation only from a recorded lean", () => {
  // scenario: these read the three real lane runs above, with local agents and temporary git repos.
  it("scenario: a plan with no open question has no lean to recommend from: Rec.none", () => {
    const ask = approveOf(plain);
    expect(ask.rec._tag).toBe("none");
  });
  it("scenario: a step's question has no recorded lean: Rec.none, never its first pick", () => {
    const ask = stepOf(stepped);
    expect(ask.rec._tag).toBe("none");
    expect(JSON.stringify(ask)).not.toContain("The step recommends this answer");
  });
  it("scenario: a plan whose questions all have leans recommends approve, with why and cost from those leans", () => {
    const { rec } = approveOf(leaned);

    if (rec._tag !== "pick") {
      return expect.unreachable(`no rec: ${JSON.stringify(rec)}`);
    }

    expect(rec.pick).toBe("approve");
    expect(rec.sure).toBe(RUN3_QUESTION.sure);
    const cut = (line: string) => line.replace(/…$/, "").trim();
    expect(rec.why).not.toBe("The plan covers the ticket");
    expect(rec.cost).not.toBe("Write and check the change");
    expect([RUN3_QUESTION.why, RUN3_QUESTION.lean].join(" ")).toContain(cut(rec.why));
    expect(RUN3_QUESTION.cost).toContain(cut(rec.cost));
  });
});

describe("ask desk review 3: a step's ask records what it asked about", () => {
  // scenario: the real test writer process returns already_passes and the lane seals its ask.
  it("scenario: for is the step outcome's own `for`, never unknown", () => {
    const outcomes = stepped.facts.flatMap((f) => (f.type === "ended" && f.stage === "test_writer" ? [f.outcome] : []));
    const asked = outcomes.at(-1) as { kind: string; for?: string } | undefined;
    expect(asked).toMatchObject({ kind: "ask", for: "already_passes" });
    expect(stepOf(stepped).for).toBe("already_passes");
  });
});

describe("ask desk review 4: an approve ask keeps the step's own words, and a reason", () => {
  // scenario: the real lane's stored ask is compared with its local planner process's output.
  it("scenario: the plan evidence carries the words the plan step wrote, as text", () => {
    const ask = approveOf(plain);
    const run = plain.facts.findLast((f) => f.type === "started" && f.stage === "plan")?.run;
    const said = plain.facts.flatMap((f) => (f.type === "commented" && f.during === run ? [String(f.body)] : []));
    expect(said).not.toEqual([]);
    const evidence = ask.shows.evidence as { _tag: string; text?: unknown };
    expect(evidence._tag).toBe("plan");
    expect(typeof evidence.text).toBe("string");

    for (const words of said) {
      expect(evidence.text).toContain(words);
    }
  });
  it.each([
    ["the approve ask", () => approveOf(plain)],
    ["a step's ask", () => stepOf(stepped)],
    // scenario: compare the saved ask with the outcome from each of the real lane runs above.
  ])("scenario: %s says why it asks, from the step's outcome", (_, ask) => {
    const { why } = ask();
    expect(typeof why).toBe("string");
    expect(why?.trim()).not.toBe("");
  });
});
