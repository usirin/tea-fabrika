import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Today's tooling (ticket 652). Git and the leak grep are real, on disposable repos. The signer,
// botpush and gh are stubs that say what they were asked. The stub signer adds a real
// note to HEAD, so a rollback can be seen in refs/notes/fabrika.
const script = join(import.meta.dirname, "land.ts");
const planted = "plantedleakword652";

const node = `#!/bin/sh
case "$1" in
*botpush.mjs)
  echo "push $3 $4" >>"$LAND_CALLS"
  # The fixture's origin takes the push, as GitHub would, so the queue step can fetch the head.
  git -C "$2" push -q origin "$4:refs/heads/$3" ;;
*commits.ts)
  echo "sign $(git rev-parse HEAD) $*" >>"$LAND_CALLS"
  [ "\${LAND_SIGN:-0}" = 0 ] || exit 1
  # A note is written by someone: name the fixture, as the real signer's caller has an identity.
  git -c user.name=Fixture -c user.email=fixture@example.test notes --ref=fabrika add -f -m '{"step":"lead"}' HEAD ;;
*) echo "unexpected node $*" >>"$LAND_CALLS"; exit 99 ;;
esac
`;

// GitHub as the queue step reads it: the pull request at the lane's pushed head, ready and into
// main, and \`ci-required\` at that head as LAND_REQUIRED says (success unless a law sets it).
const gh = `#!/bin/sh
echo "gh $*" >>"$LAND_CALLS"
head=$(git -C "$LAND_LANE" rev-parse HEAD)
case "$1 $2" in
"pr list") echo "\${LAND_OPEN:-}" ;;
"pr create") echo "https://github.com/owner/repo/pull/77" ;;
"pr view") printf '{"number":%s,"headRefName":"fabrikalfa/t652-fixture","headRefOid":"%s","baseRefName":"main","state":"%s","isDraft":false,"title":"%s","body":"What the lane did.","mergeCommit":null}\\n' "$3" "$head" "\${LAND_STATE:-OPEN}" "\${LAND_TITLE:-T652 fixture: one lane}" ;;
"api -i") printf 'HTTP/2.0 200 OK\\n\\r\\n{"check_runs":[{"id":1,"status":"completed","conclusion":"%s","app":{"slug":"github-actions"}}]}' "\${LAND_REQUIRED:-success}" ;;
esac
`;

const plancheck = `#!/bin/sh
echo '{"lane.txt": "build", "next/": "tests"}'
`;

type World = {
  /** Main moved after the lane left it, in a file of its own. */
  readonly behind: boolean;
  /** Main moved in the lane's own file, so merging it conflicts. */
  readonly conflict: boolean;
  /** The tree holds a change nobody committed when the lead runs. */
  readonly dirty: boolean;
  /** A lane commit adds a private word. */
  readonly leak: boolean;
  /** The sign script refuses. */
  readonly signFails: boolean;
  /** The lane agent made a lead commit of its own and names it. */
  readonly leadCommit: boolean;
  readonly open?: string;
  readonly wip?: boolean;
  /** `ci-required` failed at the pushed head. */
  readonly red?: boolean;
};

const land = (world: World) => {
  const dir = mkdtempSync(join(tmpdir(), "land-"));

  try {
    const env = {
      ...process.env,
      PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
      HOME: join(dir, "home"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      // As on a CI machine (PR 816): git has no identity to guess from this machine's user or
      // host, and none from the caller's environment, so every git call that writes one names it.
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.useConfigOnly",
      GIT_CONFIG_VALUE_0: "true",
      GIT_AUTHOR_NAME: undefined,
      GIT_AUTHOR_EMAIL: undefined,
      GIT_COMMITTER_NAME: undefined,
      GIT_COMMITTER_EMAIL: undefined,
      EMAIL: undefined,
      MAIN: join(dir, "main"),
      BOXES: join(dir, "boxes"),
      REMOTE: join(dir, "origin"),
      GH_REPO: "owner/repo",
      FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
      FABRIKA_LEAK_WORDS: join(dir, "words"),
      LAND_CALLS: join(dir, "calls"),
      LAND_SIGN: world.signFails ? "1" : "0",
      LAND_OPEN: world.open ?? "",
      LAND_LANE: join(dir, "lane"),
      LAND_REQUIRED: world.red ? "failure" : "success",
      TYPESAFE_API_KEY: undefined,
    };
    const git = (at: string, ...args: string[]) => {
      const got = spawnSync(
        "/usr/bin/git",
        ["-C", at, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
        { encoding: "utf8", env, timeout: 10_000 },
      );
      expect(got.status, got.stderr).toBe(0);
      return got.stdout.trim();
    };
    const script_ = (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { cwd: lane, encoding: "utf8", env, timeout: 60_000 });
    const origin = join(dir, "origin");
    const lane = join(dir, "lane");

    for (const folder of ["bin", "home", "origin", "boxes", "main/.agents/skills/plan/scripts"]) {
      mkdirSync(join(dir, folder), { recursive: true });
    }

    writeFileSync(join(dir, "bin/node"), node, { mode: 0o755 });
    writeFileSync(join(dir, "bin/gh"), gh, { mode: 0o755 });
    writeFileSync(join(dir, "main/.agents/skills/plan/scripts/plancheck.sh"), plancheck, { mode: 0o755 });
    writeFileSync(join(dir, "words"), `${planted}\n`);
    git(origin, "init", "-q", "--initial-branch=main");
    writeFileSync(join(origin, "lane.txt"), "base\n");
    git(origin, "add", ".");
    git(origin, "commit", "-qm", "base");
    // GitHub serves a commit by its sha; a plain repo does only when told to.
    git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    git(dir, "clone", "-q", origin, lane);
    git(lane, "checkout", "-q", "-b", "fabrikalfa/t652-fixture");
    writeFileSync(join(lane, "lane.txt"), world.leak ? `the lane, with ${planted}\n` : "the lane\n");
    git(lane, "add", ".");
    git(lane, "commit", "-qm", "the lane's step");
    git(lane, "notes", "--ref=fabrika", "add", "-m", '{"step":"build"}', "HEAD");
    const lead: string[] = [];

    if (world.leadCommit) {
      writeFileSync(join(lane, "rows.jsonl"), '{"row":1}\n');
      git(lane, "add", ".");
      git(lane, "commit", "-qm", "the lane's field rows, unsigned");
      lead.push("--lead", git(lane, "rev-parse", "HEAD"));
    }

    for (const [name, text] of [
      ["body.md", "T652 fixture: one lane\n\nWhat the lane did.\n\nfabrika close ticket 652\n"],
      ["loosening.out", "loosening: 0 hits\n"],
    ] as const) {
      writeFileSync(join(dir, name), text);
    }

    const said = script_(
      "ready",
      "t652f",
      "--tree",
      lane,
      // A mid-lane handover names no PR files.
      ...(world.wip ? [] : ["--body", join(dir, "body.md"), "--loosening", join(dir, "loosening.out")]),
      "--plan",
      join(dir, "plan.md"),
      ...lead,
    );
    expect(said.status, said.stderr).toBe(0);

    if (world.behind) {
      writeFileSync(join(origin, "other.txt"), "main moved\n");
    }

    if (world.conflict) {
      writeFileSync(join(origin, "lane.txt"), "main, in the lane's file\n");
    }

    if (world.behind || world.conflict) {
      git(origin, "add", ".");
      git(origin, "commit", "-qm", "main moved");
    }

    if (world.dirty) {
      writeFileSync(join(lane, "lane.txt"), "an edit nobody committed\n");
    }

    const before = [git(lane, "rev-parse", "HEAD"), git(lane, "rev-parse", "refs/notes/fabrika")];
    const ran = script_("run", "t652f", "652");
    expect(ran.error).toBeUndefined();
    const calls = existsSync(env.LAND_CALLS) ? readFileSync(env.LAND_CALLS, "utf8").trim().split("\n") : [];
    const head = git(lane, "rev-parse", "HEAD");
    return {
      code: ran.status,
      err: ran.stderr,
      out: ran.stdout,
      calls,
      before,
      after: [head, git(lane, "rev-parse", "refs/notes/fabrika")],
      parents: git(lane, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length - 1,
      subject: git(lane, "log", "-1", "--format=%s"),
      status: git(lane, "status", "--porcelain"),
      lead: lead[1],
      // The lane's own lead commit carries a note once the run is over.
      leadNoted:
        lead[1] !== undefined &&
        spawnSync("/usr/bin/git", ["-C", lane, "notes", "--ref=fabrika", "show", lead[1]], { env }).status === 0,
      state: readFileSync(join(dir, "boxes/state/t652f.md"), "utf8"),
      head,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const fine: World = { behind: false, conflict: false, dirty: false, leak: false, signFails: false, leadCommit: false };

describe("land.ts, today's tooling", () => {
  it("T652 property: a lane lands only with no fault, and a refused run changes nothing and pushes nothing", () => {
    fc.assert(
      fc.property(
        fc.record({
          behind: fc.boolean(),
          conflict: fc.boolean(),
          dirty: fc.boolean(),
          leak: fc.boolean(),
          signFails: fc.boolean(),
          leadCommit: fc.boolean(),
        }),
        (world) => {
          const got = land(world);
          // Signing is reached only when there is something to sign.
          const signs = world.behind || world.conflict || world.leadCommit;
          const faulted = world.dirty || world.conflict || world.leak || (world.signFails && signs);

          const sent = got.calls.filter((c) => /^(push|gh)/.test(c));
          expect(got.code === 0, got.err).toBe(!faulted);
          // A refused run leaves HEAD and the notes as they were, and sends nothing anywhere.
          expect(faulted ? got.after : got.before).toEqual(got.before);
          expect(faulted ? sent : []).toEqual([]);
          // A clean one ends in the one pinned squash that adds it to the queue.
          const queued = `gh pr merge 77 -R owner/repo --squash --match-head-commit ${got.head}`;
          expect(faulted ? queued : got.calls.at(-1)).toBe(queued);
          expect(got.calls.filter((c) => c.startsWith("gh pr merge"))).toHaveLength(faulted ? 0 : 1);
        },
      ),
      { seed: 652, numRuns: 10 },
    );
  }, 300_000);

  it("T652 scenario: behind main with no conflict lands, the merge and the lane's own lead commit signed, oldest first", () => {
    const got = land({ ...fine, behind: true, leadCommit: true });
    expect(got.code, got.err).toBe(0);
    expect(got.parents).toBe(2);
    expect(got.subject).toBe("Merge main into fabrikalfa/t652-fixture");
    const signs = got.calls.filter((c) => c.startsWith("sign "));
    expect(signs.map((c) => c.split(" ")[1])).toEqual([got.lead, got.head]);
    expect(signs.every((c) => c.includes("--step lead --ticket 652 --key ") && c.includes("/main/next/"))).toBe(true);
    expect(got.leadNoted).toBe(true);
    expect(got.calls.filter((c) => !c.startsWith("sign "))).toEqual([
      "push fabrikalfa/t652-fixture HEAD",
      "gh pr list -R owner/repo --head fabrikalfa/t652-fixture --state open --json number -q .[0].number",
      expect.stringMatching(
        /^gh pr create -R owner\/repo --head fabrikalfa\/t652-fixture --title T652 fixture: one lane --body-file /,
      ),
      "gh pr view 77 -R owner/repo --json number,headRefName,headRefOid,state,isDraft,baseRefName,title,body,mergeCommit",
      expect.stringMatching(
        /^gh api -i repos\/owner\/repo\/commits\/[0-9a-f]{40}\/check-runs .*check_name=ci-required/,
      ),
      `gh pr merge 77 -R owner/repo --squash --match-head-commit ${got.head}`,
    ]);
    expect(got.state).toContain("lane agent: ready to land");
    // It says queued, never merged or landed: GitHub's queue merges it later.
    expect(got.state).toContain(`land.ts: pr 77: queued at ${got.head}`);
    expect(got.state).not.toMatch(/landed|merged PR/);
  });

  it("T652 scenario: a conflict with main stops, names each file and its owning step, and leaves the tree as it was", () => {
    const got = land({ ...fine, conflict: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("refused at the merge check");
    expect(got.err).toContain("  lane.txt: build");
    expect(got.after).toEqual(got.before);
    expect(got.status).toBe("");
    expect(got.calls).toEqual([]);
  });

  it("T652 scenario: a dirty tree refuses before anything runs, and the edit stays", () => {
    const got = land({ ...fine, behind: true, dirty: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("refused at the check check: the tree has changes");
    expect(got.status).toBe("M lane.txt");
    expect(got.calls).toEqual([]);
  });

  it("T652 scenario: a leak grep hit in a lane commit fails closed, the merge undone, nothing signed or pushed", () => {
    const got = land({ ...fine, behind: true, leak: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("refused at the leak check");
    expect(got.err).not.toContain(planted);
    expect(got.after).toEqual(got.before);
    expect(got.calls).toEqual([]);
  });

  it("T652 scenario: the sign script failing refuses, and the merge and its notes are undone", () => {
    const got = land({ ...fine, behind: true, signFails: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("refused at the sign check: the sign script refused the merge of main");
    expect(got.after).toEqual(got.before);
    expect(got.calls.filter((c) => !c.startsWith("sign "))).toEqual([]);
  });

  it("T652 scenario: an open PR is updated through the REST API, never gh pr edit (AGENTS.md)", () => {
    const got = land({ ...fine, open: "41" });
    expect(got.code, got.err).toBe(0);
    expect(got.calls).toContainEqual(
      expect.stringMatching(/^gh api -X PATCH repos\/owner\/repo\/pulls\/41 -f title=T652 fixture: one lane -F body=@/),
    );
    expect(got.calls.at(-1)).toBe(`gh pr merge 41 -R owner/repo --squash --match-head-commit ${got.head}`);
  });

  // Plant: ask the merge on a head whose required check is not green, which arms auto-merge.
  it("scenario: a red ci-required at the pushed head refuses at the queue check, and no merge is asked", () => {
    const got = land({ ...fine, red: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("refused at the queue check: pr 77: ci-required is failure at");
    expect(got.calls.filter((c) => c.startsWith("gh pr merge"))).toEqual([]);
  });

  it("T652 scenario: a mid-lane handover (no PR files) merges main, signs and pushes the -wip backup, then stops with no PR and nothing queued", () => {
    const got = land({ ...fine, behind: true, wip: true });
    expect(got.code, got.err).toBe(0);
    expect(got.calls.filter((c) => !c.startsWith("sign "))).toEqual(["push fabrikalfa/t652-fixture-wip HEAD"]);
  });
});
