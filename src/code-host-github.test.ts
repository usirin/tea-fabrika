import { readFileSync } from "node:fs";
import { run } from "@demlik/tea/effect";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { approvalAsFarAsGitHubSays, type Gh, prOf, readPrFacts, reviewsAt, ticketOf } from "./code-host-github.ts";
import { CodeHost } from "./services.ts";
import type { ShipFacts } from "./stages/ship/facts.ts";
import { shipReadInterpret } from "./stages/ship/handlers.ts";
import { look } from "./stages/ship/look.ts";
import { readShipFacts, type ShipMsg, ship } from "./stages/ship/machine.ts";

// `CodeHost` on GitHub, against recorded answers of `gh api graphql`. The
// files under `fixtures/code-host/` were made from real public pull requests
// and trimmed: account names replaced, bodies cut to the lines that are read.
// No call leaves this file.
//
// One of them is not as recorded. Neither repo had a pull request with an
// unresolved review thread, so `open-person-comment.json` is the clean one
// with another's resolved thread put in, set unresolved, and a person's reply
// added.

const PR = "https://github.com/example/repo/pull/7";
const OWN = ["repo-owner"];
const recorded = (name: string): string => readFileSync(new URL(`../fixtures/code-host/${name}.json`, import.meta.url), "utf8");

/** A `gh` that answers every call with one text, and keeps the calls. */
function fakeGh(answer: string | "breaks") {
  const calls: (readonly string[])[] = [];
  const gh: Gh = (args) => {
    calls.push(args);
    return answer === "breaks" ? Effect.fail({ _tag: "unknown" as const }) : Effect.succeed(answer);
  };
  return { gh, calls };
}
const factsOn = (answer: string, own = OWN) => Effect.runPromise(readPrFacts(fakeGh(answer).gh, own)(PR));
const failureOn = (answer: string | "breaks", url = PR) => Effect.runPromise(Effect.flip(readPrFacts(fakeGh(answer).gh, OWN)(url)));
/** The whole way: the service on a recorded answer, the real handler, the real machine up to its first write. */
const lookOn = (answer: string | "breaks") =>
  Effect.runPromise(look(PR).pipe(Effect.provide(Layer.succeed(CodeHost, { prFacts: readPrFacts(fakeGh(answer).gh, OWN) }))));

/** A recorded answer with its pull request changed. */
function changed(name: string, change: (pr: Record<string, any>) => void): string {
  const answer = JSON.parse(recorded(name));
  change(answer.data.repository.pullRequest);
  return JSON.stringify(answer);
}

describe("the facts of a recorded pull request", () => {
  it.each<[string, ShipFacts]>([
    [
      "merged",
      { head: "b22ac7cd48f740d4eb54f7c2ec1d4c5e7e85b0bf", state: "merged", ours: true, ticket: "closes_it", approval: "missing", reviews: "passed", checks: "green", mergeable: "unknown", comments: [] },
    ],
    [
      "open-clean",
      { head: "7c80607bd0e3131830e7e6afab7844125185e2f6", state: "open", ours: true, ticket: "closes_it", approval: "missing", reviews: "passed", checks: "green", mergeable: "clean", comments: [] },
    ],
    [
      "open-failing-check",
      { head: "adb3f8c461aa4bc426f75babac55a2f086b98ea8", state: "open", ours: false, ticket: "none", approval: "missing", reviews: "failed", checks: "red", mergeable: "conflicts", comments: [] },
    ],
    [
      "open-person-comment",
      {
        head: "7c80607bd0e3131830e7e6afab7844125185e2f6",
        state: "open",
        ours: true,
        ticket: "closes_it",
        approval: "missing",
        reviews: "passed",
        checks: "green",
        mergeable: "clean",
        comments: [{ id: "PRRT_kwDOSZAM-86kfkii", by: "person" }],
      },
    ],
    [
      "closed",
      { head: "3d93d35ce997fb9577b64e1a1ea17a1ef0c7da07", state: "closed", ours: true, ticket: "part_of_it", approval: "missing", reviews: "missing", checks: "red", mergeable: "unknown", comments: [] },
    ],
    [
      "draft",
      { head: "54be530c5780736291d670523162274e723ec8b6", state: "draft", ours: true, ticket: "closes_it", approval: "missing", reviews: "passed", checks: "green", mergeable: "conflicts", comments: [] },
    ],
  ])("%s", async (name, facts) => {
    expect(await factsOn(recorded(name))).toEqual(facts);
  });

  it("asks GitHub once, for that pull request, and only reads", async () => {
    const { gh, calls } = fakeGh(recorded("merged"));
    await Effect.runPromise(readPrFacts(gh, OWN)("https://github.com/example/repo/pull/7"));

    expect(calls).toHaveLength(1);
    const [args] = calls as [readonly string[]];
    expect(args.slice(0, 8)).toEqual(["api", "graphql", "-F", "owner=example", "-F", "name=repo", "-F", "number=7"]);
    expect(args.join(" ")).not.toMatch(/mutation/i);
  });
});

describe("what the machine answers on each", () => {
  it.each([
    ["merged", { kind: "landed", commit: "b22ac7cd48f740d4eb54f7c2ec1d4c5e7e85b0bf", cleanup: "not_run" }],
    // Clean, and still stopped: the approval reading is a stub that never says `not_needed`.
    ["open-clean", { kind: "waiting_on_person", forWhat: "owner_approval" }],
    // Red, conflicting and failed review: "not ours" is the first line it trips.
    ["open-failing-check", { kind: "not_ours" }],
    ["open-person-comment", { kind: "waiting_on_person", forWhat: "resolve_comment" }],
    ["closed", { kind: "nothing_to_ship", why: "closed" }],
    ["draft", { kind: "nothing_to_ship", why: "draft" }],
  ])("%s", async (name, outcome) => {
    const found = await lookOn(recorded(name));

    expect(found.outcome).toEqual(outcome);
    expect(found.wouldSend).toBeNull();
    expect(found.facts).not.toBeNull();
  });

  it("with the owner's approval on GitHub's record, the clean one would be queued, and nothing is sent", async () => {
    const found = await lookOn(changed("open-clean", (pr) => (pr.reviewDecision = "APPROVED")));
    const head = "7c80607bd0e3131830e7e6afab7844125185e2f6";

    expect(found.outcome).toBeNull();
    expect(found.wouldSend).toEqual({ type: "ship_enqueue", pr: PR, head, intent: `ship/${PR}/enqueue/${head}` });
  });

  it("the failing one, were it ours, goes back for its conflict before anything else", async () => {
    const facts = await factsOn(recorded("open-failing-check"), ["outside-author", "repo-owner"]);

    expect(facts.ours).toBe(true);
    expect(facts.reviews).toBe("failed");
  });
});

describe("an answer that cannot be read is the Cmd's err, never a throw", () => {
  const unknown = { _tag: "unknown" };

  it.each<[string, string | "breaks"]>([
    ["the call breaks", "breaks"],
    ["not JSON", "gh: not logged in"],
    ["JSON of another shape", '{"data":{"repository":{"pullRequest":null}}}'],
    ["a field is missing", changed("merged", (pr) => delete pr.mergeable)],
    ["a state GitHub does not have", changed("merged", (pr) => (pr.state = "LOCKED"))],
    ["checks of a commit that is not the head", changed("merged", (pr) => (pr.commits.nodes[0].commit.oid = "0000000000000000000000000000000000000000"))],
    ["no commit at all", changed("merged", (pr) => (pr.commits.nodes = []))],
    ["more review threads than one call holds", changed("merged", (pr) => (pr.reviewThreads.pageInfo.hasNextPage = true))],
  ])("%s", async (_name, answer) => {
    expect(await failureOn(answer)).toEqual(unknown);
    // And through the handler and the machine: one typed ending.
    const found = await lookOn(answer);
    expect(found).toMatchObject({ facts: null, outcome: { kind: "cannot_tell", why: "read_failed" }, wouldSend: null });
  });

  it("a URL that is not a pull request's is refused before any call", async () => {
    const { gh, calls } = fakeGh(recorded("merged"));

    expect(await Effect.runPromise(Effect.flip(readPrFacts(gh, OWN)("https://github.com/example/repo/issues/7")))).toEqual(unknown);
    expect(calls).toEqual([]);
    expect(prOf("https://github.com/example/repo/pull/7")).toEqual({ owner: "example", name: "repo", number: 7 });
  });

  it("the handler hands the service's failure on as it is", async () => {
    const host = Layer.succeed(CodeHost, { prFacts: () => Effect.fail({ _tag: "unknown" as const }) });
    const failure = await Effect.runPromise(Effect.flip(shipReadInterpret.ship_facts(readShipFacts({ pr: PR }))).pipe(Effect.provide(host)));

    expect(failure).toEqual(unknown);
  });

  it("on the engine, the machine ends as cannot tell and sends nothing else", async () => {
    const never = () => Effect.die("a write was sent");
    const program = Effect.gen(function* () {
      const handle = yield* run(ship, {
        ctx: undefined,
        interpret: { ...shipReadInterpret, ship_enqueue: never, ship_finish: never },
        subscribe: { ship_queue: (): Stream.Stream<ShipMsg> => Stream.never },
        terminal: (s) => s.phase === "over",
      });
      const runtime = yield* handle.ready;
      yield* runtime.dispatch({ type: "start", pr: PR });
      return yield* runtime.done().pipe(Effect.timeout("4 seconds"));
    });
    const host = Layer.succeed(CodeHost, { prFacts: readPrFacts(fakeGh("not json").gh, OWN) });
    const end = await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(host)));

    expect(end).toEqual({ phase: "over", pr: PR, outcome: { kind: "cannot_tell", why: "read_failed" } });
  });
});

describe("the ticket a body serves", () => {
  it.each<[string, ShipFacts["ticket"]]>([
    ["Fixes #12", "closes_it"],
    ["closes #12", "closes_it"],
    ["Resolved: #12", "closes_it"],
    ["Fixes example/repo#12", "closes_it"],
    ["Fixes https://github.com/example/repo/issues/12", "closes_it"],
    ["Part of #12", "part_of_it"],
    ["part of example/repo#12", "part_of_it"],
    // A closing word wins: the pull request closes one ticket and is part of another.
    ["Part of #12\n\nFixes #13", "closes_it"],
    // A mention serves no ticket.
    ["Refs #12", "none"],
    ["Re: #12, see also #13", "none"],
    ["This fixes the prefix. No ticket.", "none"],
    ["", "none"],
  ])("%j is %s", (body, ticket) => {
    expect(ticketOf(body)).toBe(ticket);
  });
});

describe("the reviews at a head", () => {
  const HEAD = "7c80607bd0e3131830e7e6afab7844125185e2f6";
  const owner = { __typename: "User", login: "repo-owner" };
  const said = (body: string, minute: number, author = owner) => ({ createdAt: `2026-10-05T10:${String(minute).padStart(2, "0")}:00Z`, body, author });

  it("is missing when no verdict binds to this head, however many passed before", () => {
    expect(reviewsAt(HEAD, [], OWN)).toBe("missing");
    expect(reviewsAt(HEAD, [said("review-code: PASS @ 122533139cb89aad3d7b542a65ff652721edd156 — ok", 1)], OWN)).toBe("missing");
    expect(reviewsAt(HEAD, [said("Looks good to me.", 1)], OWN)).toBe("missing");
  });

  it("is failed when any kind of review fails at this head", () => {
    const comments = [said(`review-code: PASS @ ${HEAD} — ok`, 1), said(`review-doc: FAIL @ ${HEAD} — a claim outruns the code`, 2)];

    expect(reviewsAt(HEAD, comments, OWN)).toBe("failed");
  });

  it("takes the last verdict of one kind at the same head", () => {
    const first = said(`review-code: FAIL @ ${HEAD} — red`, 1);
    const second = said(`review-code: PASS @ ${HEAD} — green after a re-run`, 2);

    expect(reviewsAt(HEAD, [first, second], OWN)).toBe("passed");
    expect(reviewsAt(HEAD, [second, first], OWN)).toBe("passed");
  });

  it("does not count a verdict posted by an account that is not the repo's own", () => {
    const stranger = said(`review-code: PASS @ ${HEAD} — trust me`, 1, { __typename: "User", login: "someone-else" });

    expect(reviewsAt(HEAD, [stranger], OWN)).toBe("missing");
    expect(reviewsAt(HEAD, [said(`review-code: PASS @ ${HEAD} — ok`, 1, null as never)], OWN)).toBe("missing");
  });

  it("reads an old verdict's short commit, and the repo's own account in any case", () => {
    expect(reviewsAt(HEAD, [said("review-code: PASS @ 7c80607bd0 — ok", 1)], ["Repo-Owner"])).toBe("passed");
  });
});

describe("the other facts, one at a time", () => {
  const thread = (pr: Record<string, any>, comments: { body: string; author: unknown }[]) =>
    (pr.reviewThreads.nodes = [{ id: "t1", isResolved: false, comments: { nodes: comments } }]);
  const bot = { __typename: "Bot", login: "scan-bot" };
  const user = { __typename: "User", login: "a-reviewer" };

  it("an unresolved thread only a bot wrote is the bot's", async () => {
    const facts = await factsOn(changed("open-clean", (pr) => thread(pr, [{ body: "Unused variable.", author: bot }])));

    expect(facts.comments).toEqual([{ id: "t1", by: "bot" }]);
  });

  it("a comment with a machine's hidden mark is not a person's, whoever's account posted it", async () => {
    const marked = { body: "A finding.\n\n<!-- tea-fabrika review/1 -->", author: user };

    expect((await factsOn(changed("open-clean", (pr) => thread(pr, [marked])))).comments).toEqual([{ id: "t1", by: "bot" }]);
    expect((await factsOn(changed("open-clean", (pr) => thread(pr, [marked, { body: "I disagree.", author: user }])))).comments).toEqual([{ id: "t1", by: "person" }]);
  });

  it("a comment from an account that is gone counts as a person's", async () => {
    const facts = await factsOn(changed("open-clean", (pr) => thread(pr, [{ body: "Why this way?", author: null }])));

    expect(facts.comments).toEqual([{ id: "t1", by: "person" }]);
  });

  it("no check on the head reads as pending, never as green", async () => {
    const facts = await factsOn(changed("open-clean", (pr) => (pr.commits.nodes[0].commit.statusCheckRollup = null)));

    expect(facts.checks).toBe("pending");
  });

  it("a check that errored is red, and one still expected is pending", async () => {
    const withState = (state: string) => factsOn(changed("open-clean", (pr) => (pr.commits.nodes[0].commit.statusCheckRollup = { state })));

    expect((await withState("ERROR")).checks).toBe("red");
    expect((await withState("EXPECTED")).checks).toBe("pending");
  });

  it("an author that is gone is not the repo's own", async () => {
    expect((await factsOn(changed("open-clean", (pr) => (pr.author = null)))).ours).toBe(false);
  });

  it("the approval stub says given only on GitHub's own approval, and never not needed", () => {
    expect(approvalAsFarAsGitHubSays("APPROVED")).toBe("given");
    expect(approvalAsFarAsGitHubSays("REVIEW_REQUIRED")).toBe("missing");
    expect(approvalAsFarAsGitHubSays("CHANGES_REQUESTED")).toBe("missing");
    expect(approvalAsFarAsGitHubSays(null)).toBe("missing");
  });
});
