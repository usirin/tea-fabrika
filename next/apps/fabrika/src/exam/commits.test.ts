// next/, P32 and ticket 251: pure laws p83 to p87 and p89.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Option } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Answer,
  annotate,
  chain,
  check,
  type Commit,
  decodeExam,
  decodeLink,
  decodeNote,
  examMatcher,
  inScope,
  keysProblem,
  type Logged,
  type Note,
  plain,
  type PullRequest,
  ROLES,
  type Role,
  signedText,
  staleSteps,
} from "./commits.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const runs = { seed: 119120, numRuns: 100 };
const sha = fc.stringMatching(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const ticket = fc.stringMatching(/^[0-9]{1,12}$/);
const id = fc.stringMatching(/^[A-Za-z0-9._:-]{1,24}$/);
const filename = fc.stringMatching(/^[a-z][a-z0-9_-]{0,16}$/);
const role = fc.constantFrom(...ROLES);

const anyNote = fc.record({
  _tag: fc.constant("attested" as const),
  step: role,
  ticket,
  version: fc.integer({ min: 1, max: 10000 }),
  from: sha,
  to: sha,
  key: fc.string(),
  sig: fc.string(),
});

const anyLink = fc.record({
  _tag: fc.constant("attested" as const),
  step: fc.constantFrom(...ROLES, "person" as const),
  ticket,
  version: fc.integer({ min: 1 }),
  from: fc.stringMatching(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  to: fc.stringMatching(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  key: fc.string(),
  sig: fc.string(),
  by: fc.string(),
  arrivedAt: fc.string(),
  parent: fc.option(fc.string(), { nil: null }),
  traceId: fc.string(),
  commit: sha,
  pr: fc.string(),
  base: sha,
  squash: sha,
  keys: sha,
});

const signed = (note: Note, signer: Role | null = note.step) => ({ note, signer });

const commit = (n: Note, paths: string[] = []): Commit => ({
  sha: n.to,
  tree: n.to,
  parentTree: n.from,
  paths,
  exam: EXAM_ROWS,
  signed: signed(n),
});

const pr = (commits: Commit[], more: Partial<PullRequest> = {}): PullRequest => ({
  head: "head",
  changed: commits.flatMap((c) => c.paths),
  commits,
  notes: commits.flatMap((c) => (c.signed === null ? [] : [c.signed])),
  ...more,
});

const EXAM_ROWS = [
  { glob: "exam-paths.json", reason: "" },
  { glob: "boundary-rules.json", reason: "" },
  { glob: ".github/**", reason: "" },
  { glob: "next/apps/fabrika/src/exam/**", reason: "" },
  { glob: "next/**/*.test.ts", reason: "" },
  { glob: "fixtures/next/**", reason: "" },
];

const EXAM = examMatcher(EXAM_ROWS);

const answers = (p: PullRequest) => check(p, EXAM).answers;
const DONE = { _tag: "done" as const };

const stuck = (reason: string, sha: string, more: object = {}) => ({
  _tag: "stuck",
  reason,
  sha,
  ...more,
});

const ask = (paths: string[]): Answer => ({ _tag: "ask", to: "owner", for: "exam_read", paths });

const examPaths = fc
  .uniqueArray(filename, { minLength: 1, maxLength: 8 })
  .map((names) => names.map((name) => `next/${name}.test.ts`));

describe("signedText", () => {
  // format: v2 is the byte-exact text existing step signatures verify against.
  it("format: v2 signed link bytes", () => {
    expect(
      signedText({
        step: "build",
        ticket: "229",
        version: 3,
        from: "a".repeat(40),
        to: "b".repeat(40),
      }),
    ).toBe(
      `fabrika-step attested v2\nstep build\nticket 229\nversion 3\nfrom ${"a".repeat(40)}\nto ${"b".repeat(40)}\n`,
    );
  });
  // Plant: include key in the signed text.
  it("P01: signs exactly the generated link fields, independent of note metadata", () => {
    fc.assert(
      fc.property(anyNote, fc.string(), fc.string(), (n, key, sig) => {
        const expected = `fabrika-step attested v2\nstep ${n.step}\nticket ${n.ticket}\nversion ${n.version}\nfrom ${n.from}\nto ${n.to}\n`;
        expect(signedText(n)).toBe(expected);
        expect(signedText({ ...n, key, sig } as Note)).toBe(expected);
        expect(signedText(n)).not.toContain("commit");
      }),
      runs,
    );
  });
});

describe("decoders", () => {
  // Plant: reject every note.
  it("P02: every generated attested note round-trips", () => {
    fc.assert(
      fc.property(anyNote, (n) => {
        expect(decodeNote(JSON.stringify(n))).toEqual(Option.some(n));
      }),
      runs,
    );
  });
  // Plant: remove the positive whole-number constraint on version.
  it("P03: malformed notes are refused for every generated valid starting note", () => {
    fc.assert(
      fc.property(anyNote, fc.string(), fc.nat({ max: 39 }), (n, text, length) => {
        for (const bad of [
          `!${text}`,
          JSON.stringify({ ...n, _tag: `other:${text}` }),
          JSON.stringify({ ...n, step: `owner:${text}` }),
          JSON.stringify({ ...n, ticket: `${n.ticket}\nstep ${n.step}` }),
          JSON.stringify({ ...n, version: 0 }),
          JSON.stringify({ ...n, version: n.version + 0.5 }),
          JSON.stringify({ ...n, from: n.from.slice(0, length) }),
          JSON.stringify({ ...n, to: `${n.to}\n${text}` }),
          JSON.stringify({ ...n, sig: undefined }),
        ]) {
          expect(decodeNote(bad)).toEqual(Option.none());
        }
      }),
      runs,
    );
  });
  // Plant: reject every logged link.
  it("P04: a link with parent and traceId decodes to itself", () => {
    fc.assert(
      fc.property(anyLink, (value) => {
        expect(decodeLink(value)).toEqual(Option.some(value));
      }),
      runs,
    );
  });
  // Plant: allow excess fields in decodeLink.
  it("P05: a link carrying cause is refused, with or without parent", () => {
    fc.assert(
      fc.property(anyLink, fc.anything(), fc.boolean(), (value, cause, keepParent) => {
        const { parent: _, ...old } = value;
        expect(decodeLink({ ...(keepParent ? value : old), cause })).toEqual(Option.none());
      }),
      runs,
    );
  });
  // Plant: make parent optional.
  it("P06: a link missing any required field is refused", () => {
    fc.assert(
      fc.property(anyLink, (value) => {
        for (const field of Object.keys(value)) {
          const missing: Record<string, unknown> = { ...value };
          delete missing[field];
          expect(decodeLink(missing)).toEqual(Option.none());
        }
      }),
      runs,
    );
  });
});

const key = fc
  .array(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), {
    minLength: 43,
    maxLength: 43,
  })
  .map((chars) => `AAAAC3NzaC1lZDI1NTE5AAAAI${chars.join("")}`);

const line = (principal: string, key: string, ns = "fabrika-step") =>
  `${principal} namespaces="${ns}" ssh-ed25519 ${key}`;

const keyFile = fc
  .tuple(
    fc.uniqueArray(key, { minLength: 6, maxLength: 12 }),
    fc.uniqueArray(id, { minLength: 3, maxLength: 3 }),
    fc.boolean(),
  )
  .chain(([keys, people, newline]) => {
    const lines = keys.map((key, i) =>
      i < 3 ? line(ROLES[i]!, key) : i < 6 ? line(`person:${people[i - 3]}`, key, "git") : line(ROLES[i % 3]!, key),
    );
    return fc.shuffledSubarray(lines, { minLength: lines.length, maxLength: lines.length }).map((ordered) => ({
      keys,
      people,
      lines: ordered,
      text: ordered.join("\n") + (newline ? "\n" : ""),
    }));
  });

describe("keysProblem (p87, p87b)", () => {
  // Plant: reject a repeated step principal, breaking key rotation.
  it("P07: valid step and person lines pass in any order, with rotations and either final newline", () => {
    fc.assert(
      fc.property(keyFile, (file) => {
        expect(keysProblem(file.text)).toBeNull();
        const steps = file.keys.slice(0, 3).map((key, i) => line(ROLES[i]!, key));
        expect(keysProblem(steps.join("\n"))).toBeNull();
        expect(keysProblem([...steps, line("build", file.keys[3]!)].join("\n"))).toBeNull();
        expect(
          keysProblem([...steps, line(`person:${file.people[0]}Az09._:-`, file.keys[3]!, "git")].join("\n")),
        ).toBeNull();
      }),
      runs,
    );
  });
  // Plant: accept malformed lines.
  it("P08: a malformed line names that exact line in any generated keys file", () => {
    fc.assert(
      fc.property(keyFile, fc.nat(), fc.string(), (file, at, text) => {
        const person = line(`person:${file.people[0]}`, file.keys[0]!, "git");
        const badLines = [
          `lead namespaces="fabrika-step" ecdsa-sha2-nistp256 ${file.keys[0]}`,
          `lead ssh-ed25519 ${file.keys[0]}`,
          `lead cert-authority,namespaces="fabrika-step" ssh-ed25519 ${file.keys[0]}`,
          `lead valid-after="20260101",namespaces="fabrika-step" ssh-ed25519 ${file.keys[0]}`,
          line("lead", file.keys[0]!, `other:${JSON.stringify(text)}`),
          "",
          line("lead", file.keys[0]!.slice(0, 60)),
          `PLACEHOLDER ${JSON.stringify(text)}`,
          `ignored ${person}`,
          `${person} ignored`,
          person.slice(0, -1),
          `${person}D`,
          `build oops${JSON.stringify(text)}`,
        ];

        for (const bad of badLines) {
          const lines = [...file.lines];
          lines.splice(at % lines.length, 0, bad);
          expect(keysProblem(lines.join("\n"))).toBe(`refused line ${JSON.stringify(bad)}`);
        }
      }),
      runs,
    );
  });
  // Plant: stop checking literal person ids.
  it("P09: ambiguous principals, reused keys, wrong namespaces and missing roles fail with a reason", () => {
    fc.assert(
      fc.property(keyFile, id, role, (file, name, step) => {
        const steps = file.keys.slice(0, 3).map((key, i) => line(ROLES[i]!, key));
        const person = line(`person:${name}`, file.keys[3]!, "git");
        const files = [
          null,
          [...steps, line("build", file.keys[0]!)].join("\n"),
          [...steps, line(`owner:${name}`, file.keys[3]!)].join("\n"),
          [...steps, line(`personish:${name}`, file.keys[3]!, "git")].join("\n"),
          [...steps, line(step, file.keys[3]!, "git")].join("\n"),
          [...steps, line(`person:${name}`, file.keys[3]!)].join("\n"),
          steps.filter((_, i) => ROLES[i] !== step).join("\n"),
          [...steps, person, line(`person:${name}`, file.keys[4]!, "git")].join("\n"),
          [...steps, line(`person:${name}`, file.keys[0]!, "git")].join("\n"),
          [...steps, person, line(`person:${name}:other`, file.keys[3]!, "git")].join("\n"),
          ...["", `${name},*`, `${name}*`, `${name}?`, `!${name}`].map((bad) =>
            [...steps, person, line(`person:${bad}`, file.keys[4]!, "git")].join("\n"),
          ),
        ];

        for (const text of files) {
          expect(keysProblem(text)).toEqual(expect.stringMatching(/\S/));
        }
      }),
      runs,
    );
  });
});

describe("exam paths and scope", () => {
  // Plant: treat dots in globs as regex wildcards.
  it("P10: generated paths match only the listed globs or a control character", () => {
    fc.assert(
      fc.property(
        filename,
        fc.array(filename, { maxLength: 5 }),
        fc.integer({ min: 0, max: 32 }),
        (name, dirs, control) => {
          const folder = dirs.length === 0 ? "" : `${dirs.join("/")}/`;

          for (const path of [
            "exam-paths.json",
            "boundary-rules.json",
            `.github/${folder}${name}.yaml`,
            `next/apps/fabrika/src/exam/${name}.ts`,
            `next/${folder}${name}.test.ts`,
            `next/${folder}.${name}/${name}.test.ts`,
            `fixtures/next/${folder}${name}`,
            `docs/${name}${String.fromCharCode(control === 32 ? 127 : control)}.md`,
          ]) {
            expect(EXAM(path)).toBe(true);
          }

          for (const path of [
            `next/${folder}${name}.ts`,
            `next/${name}.test.tsx`,
            "boundary-rules.json.bak",
            "x/boundary-rules.json",
            `fixtures/nextx/${name}`,
            "exam-pathsxjson",
            `docs/${name}.md`,
          ]) {
            expect(EXAM(path)).toBe(false);
          }
        },
      ),
      runs,
    );
  });
  // Plant: omit next/ from the scope rule.
  it("P11: only a next/ file or exam path brings any generated change into scope", () => {
    fc.assert(
      fc.property(fc.array(filename, { maxLength: 10 }), filename, (names, name) => {
        const outside = names.map((n) => `docs/${n}.md`);
        expect(inScope(outside, EXAM)).toBe(false);
        expect(inScope([...outside, `next/${name}.ts`], EXAM)).toBe(true);
        expect(inScope([...outside, "boundary-rules.json"], EXAM)).toBe(true);
        expect(inScope([], EXAM)).toBe(false);
      }),
      runs,
    );
  });
  // Plant: reject every exam list.
  it("P12: generated exam lists decode, and the real list protects every listed check", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ glob: filename, reason: fc.string() })), filename, (rows, name) => {
        const encoded = rows.map(({ glob, reason }) =>
          Object.fromEntries([
            ["glob", glob],
            ["why", reason],
          ]),
        );
        expect(decodeExam(JSON.stringify(encoded))).toEqual(Option.some(rows));
        const list = Option.getOrThrow(decodeExam(readFileSync(join(ROOT, "exam-paths.json"), "utf8")));
        expect(list.every((row) => row.reason.length > 0)).toBe(true);
        const isExam = examMatcher(list);

        for (const path of [
          `next/apps/fabrika/src/exam/${name}.ts`,
          `next/${name}.test.ts`,
          `next/${name}.test.tsx`,
          `.github/workflows/${name}.yaml`,
          `fixtures/next/${name}`,
          "allowed_signers",
          "exam-paths.json",
          // 0524: a list file is an exam path until it is deleted, and so are code-graph's names.
          "next-ledger.json",
          "agents-ledger.json",
          "unreachable-ledger.json",
          "node-kinds.json",
        ]) {
          expect(isExam(path)).toBe(true);
        }
      }),
      runs,
    );
  });
});

const route = fc
  .tuple(fc.uniqueArray(sha, { minLength: 4, maxLength: 10 }), ticket, fc.array(role, { minLength: 10, maxLength: 10 }))
  .map(([trees, ticket, roles]) => {
    const versions = { tests: 0, build: 0, lead: 0 };
    const notes = trees.slice(1).map((to, i): Note => ({
      _tag: "attested",
      step: roles[i]!,
      ticket,
      version: ++versions[roles[i]!],
      from: trees[i]!,
      to,
      key: `key-${i}`,
      sig: `sig-${i}`,
    }));
    return { trees, notes, commits: notes.map((n) => commit(n)) };
  });

describe("check (p83 to p86)", () => {
  // Plant: report unsigned even for a fitting verified note.
  it("P13: any chain signed by its step keys passes and names its ticket", () => {
    fc.assert(
      fc.property(route, filename, ({ notes, commits }, name) => {
        expect(check(pr(commits.map((c) => ({ ...c, paths: [`next/${name}.ts`] }))), EXAM)).toEqual({
          ticket: notes[0]!.ticket,
          answers: [DONE],
        });
      }),
      runs,
    );
  });
  // Plant: accept a note without comparing its trees.
  it("P14: every absent, unverified, wrong-role or wrong-tree note is unsigned, before checking its files", () => {
    fc.assert(
      fc.property(route, examPaths, ({ notes }, paths) => {
        const n = notes[0]!;
        const c = commit(n, paths);
        const wrongRole = ROLES.find((step) => step !== n.step)!;

        for (const bad of [
          { ...c, signed: null },
          { ...c, signed: signed(n, null) },
          { ...c, signed: signed(n, wrongRole) },
          { ...c, signed: signed({ ...n, from: n.to }) },
          { ...c, signed: signed({ ...n, to: n.from }) },
        ]) {
          expect(answers(pr([bad], { changed: [] }))).toEqual([stuck("unsigned_commit", c.sha)]);
        }

        const unsigned = notes.map((n) => ({ ...commit(n), signed: null }));
        expect(answers(pr(unsigned))).toEqual(unsigned.map((c) => stuck("unsigned_commit", c.sha)));
      }),
      runs,
    );
  });
  // Plant: ignore a commit's ticket when choosing its role.
  it("P15: a fitting link from another ticket is unsigned", () => {
    fc.assert(
      fc.property(route, ({ notes }) => {
        const first = commit(notes[0]!);
        const other = commit({ ...notes[1]!, ticket: `${notes[0]!.ticket}0` });
        expect(answers(pr([first, other]))).toEqual([stuck("unsigned_commit", other.sha)]);
      }),
      runs,
    );
  });
  // Plant: allow build to touch the exam.
  it("P16: build refuses every exam path, sorted, while tests and lead ask the owner", () => {
    fc.assert(
      fc.property(anyNote, examPaths, filename, (n, paths, name) => {
        const sorted = [...paths].sort();

        for (const step of ROLES) {
          const c = commit({ ...n, step }, [`next/${name}.ts`, ...paths]);
          expect(answers(pr([c]))).toEqual(
            step === "build" ? [stuck("build_touched_exam", c.sha, { paths: sorted }), ask(sorted)] : [ask(sorted)],
          );
        }
      }),
      runs,
    );
  });
  // Plant: use commit files for exam_read instead of the PR's change.
  it("P17: the PR's change alone asks once per sorted path, beside every stuck", () => {
    fc.assert(
      fc.property(route, examPaths, ({ notes }, paths) => {
        const c = commit({ ...notes[0]!, step: "tests" }, paths);
        expect(answers(pr([c], { changed: ["next/x.ts"] }))).toEqual([DONE]);
        expect(answers(pr([{ ...c, signed: null }], { changed: [...paths, ...paths].reverse() }))).toEqual([
          stuck("unsigned_commit", c.sha),
          ask([...paths].sort()),
        ]);
      }),
      runs,
    );
  });
  // 0098: where a branch stands against main is no input, so no pull request is broken for it; a gap
  // in its links is a commit whose note does not fit, unsigned_commit. Plant: answer broken_chain at
  // the head again.
  it("P18: no pull request, signed or not, is broken_chain at pull request time", () => {
    const drops = fc.array(fc.boolean(), { minLength: 10, maxLength: 10 });
    fc.assert(
      fc.property(route, sha, drops, ({ commits }, head, drop) => {
        const mixed = commits.map((c, i) => (drop[i] === true ? { ...c, signed: null } : c));
        const reasons = answers(pr(mixed, { head })).flatMap((a) => (a._tag === "stuck" ? [a.reason] : []));
        expect(reasons).not.toContain("broken_chain");
        expect(reasons).toEqual(mixed.flatMap((c) => (c.signed === null ? ["unsigned_commit"] : [])));
      }),
      runs,
    );
  });
});

describe("newest links (p89)", () => {
  // Plant: count the newest link anywhere in the used order, instead of requiring it last.
  it("P30: every generated ordering counts only when the newest link comes last", () => {
    const ordered = route.chain((r) =>
      fc
        .shuffledSubarray(r.notes, { minLength: r.notes.length, maxLength: r.notes.length })
        .map((notes) => ({ ...r, notes })),
    );
    fc.assert(
      fc.property(ordered, role, (r, step) => {
        const notes = r.notes.map((n) => ({ ...n, step }));
        // Give each original link a unique version even if its original role differed.
        const unique = notes.map((n) => ({ ...n, version: r.trees.indexOf(n.to) }));
        const expected = unique.at(-1)!.version === unique.length ? new Set() : new Set([step]);
        expect(
          staleSteps(
            notes[0]!.ticket,
            unique.map((n) => signed(n)),
            unique,
          ),
        ).toEqual(expected);
      }),
      runs,
    );
  });
  // Plant: ignore versions in staleSteps.
  it("P19: missing newest links, ties and older-after-newest links make every step commit stale", () => {
    fc.assert(
      fc.property(route, role, ({ notes, trees }, step) => {
        const n = { ...notes[0]!, step };
        const c = commit(n);
        const newer = signed({ ...n, to: trees[2]!, version: n.version + 1 });
        const tie = signed({ ...n, to: trees[2]! });

        for (const extra of [newer, tie]) {
          expect(answers(pr([c], { notes: [signed(n), extra] }))).toEqual([stuck("stale_link", c.sha, { step })]);
        }

        const older = commit({ ...notes[1]!, step, version: n.version });
        const newest = commit({ ...n, version: n.version + 1 });
        expect(answers(pr([newest, older]))).toEqual([
          stuck("stale_link", newest.sha, { step }),
          stuck("stale_link", older.sha, { step }),
        ]);
        const absent = ROLES.find((r) => r !== step)!;
        expect(answers(pr([c], { notes: [signed(n), signed({ ...n, step: absent })] }))).toEqual([
          stuck("stale_link", "head", { step: absent }),
        ]);
      }),
      runs,
    );
  });
  // Plant: count unverified notes when finding the newest link.
  it("P20: invalid and other-ticket notes never stale a valid ordered chain", () => {
    fc.assert(
      fc.property(route, ({ notes, commits }) => {
        const noise = notes.flatMap((n) => [
          signed({ ...n, version: n.version + 100 }, null),
          signed(
            { ...n, version: n.version + 100 },
            ROLES.find((r) => r !== n.step)!,
          ),
          signed({ ...n, version: n.version + 100, ticket: `${n.ticket}0` }),
        ]);
        expect(answers(pr(commits, { notes: [...noise, ...notes.map((n) => signed(n))] }))).toEqual([DONE]);
        expect(staleSteps(notes[0]!.ticket, [], [])).toEqual(new Set());
      }),
      runs,
    );
  });
  // Plant: report stale_link before build_touched_exam.
  it("P21: build touching the exam takes precedence over a stale link", () => {
    fc.assert(
      fc.property(anyNote, examPaths, (n, paths) => {
        const b = { ...n, step: "build" as const };
        const c = commit(b, paths);
        expect(answers(pr([c], { changed: [], notes: [signed(b), signed({ ...b, version: b.version + 1 })] }))).toEqual(
          [stuck("build_touched_exam", c.sha, { paths: [...paths].sort() })],
        );
      }),
      runs,
    );
  });
});

const logged = (n: Note, base: string, squash: string): Logged => ({
  link: {
    ...n,
    by: "agent:test-writer",
    arrivedAt: "2026-11-07T10:00:00-08:00",
    parent: null,
    traceId: n.ticket,
    commit: n.to,
    pr: "fixture/repo#1",
    base,
    squash,
    keys: base,
  },
  signer: n.step,
});

const chainData = fc
  .tuple(route, fc.uniqueArray(sha, { minLength: 3, maxLength: 3 }))
  .filter(([r, ids]) => !r.trees.includes(ids[2]!))
  .map(([r, [base, squash, other]]) => ({
    ...r,
    base: base!,
    squash: squash!,
    other: other!,
    rows: r.notes.map((n) => logged(n, base!, squash!)),
    trees: new Map([
      [base!, r.trees[0]!],
      [squash!, r.trees.at(-1)!],
    ]),
    placed: { onMain: true, before: new Set([base!]), head: null },
  }));

describe("chain (p86 and p89 after merge)", () => {
  // Plant: reject all whole chains.
  it("P22: generated step chains, including lead links and one empty person link, reach the squash", () => {
    fc.assert(
      fc.property(chainData, fc.nat(), (d, at) => {
        expect(chain(d.squash, d.rows, d.trees, d.placed)).toEqual([DONE]);
        const i = at % d.rows.length;
        const n = d.rows[i]!.link;
        const person = {
          link: { ...n, step: "person" as const, to: n.from },
          signer: "person" as const,
        };
        expect(chain(d.squash, [...d.rows.slice(0, i), person, ...d.rows.slice(i)], d.trees, d.placed)).toEqual([DONE]);
      }),
      runs,
    );
  });
  // Plant: omit adjacency checks.
  it("P23: gaps, wrong signers, mixed tickets, missing endpoints and reused trees break any chain", () => {
    fc.assert(
      fc.property(chainData, (d) => {
        const first = d.rows[0]!;
        const second = d.rows[1]!;
        const last = d.rows.at(-1)!;
        const bad: Logged[][] = [
          [],
          d.rows.slice(1),
          [{ ...first, signer: null }, ...d.rows.slice(1)],
          [{ ...first, signer: ROLES.find((r) => r !== first.link.step)! }, ...d.rows.slice(1)],
          [{ ...first, link: { ...first.link, from: d.other } }, ...d.rows.slice(1)],
          [...d.rows.slice(0, -1), { ...last, link: { ...last.link, to: d.other } }],
          [first, { ...second, link: { ...second.link, from: d.other } }, ...d.rows.slice(2)],
          [first, { ...second, link: { ...second.link, ticket: `${first.link.ticket}0` } }, ...d.rows.slice(2)],
          [
            first,
            logged({ ...first.link, step: "lead", from: first.link.to, to: first.link.from }, d.base, d.squash),
            ...d.rows,
          ],
        ];

        for (const rows of bad) {
          expect(chain(d.squash, rows, d.trees, d.placed)).toEqual([stuck("broken_chain", d.squash)]);
        }

        for (const missing of [d.base, d.squash]) {
          const trees = new Map(d.trees);
          trees.delete(missing);
          expect(chain(d.squash, d.rows, trees, d.placed)).toEqual([stuck("broken_chain", d.squash)]);
        }
      }),
      runs,
    );
  });
  // Plant: remove visited-tree and duplicate-empty-link checks.
  it("P24: empty person links cannot hide a duplicate link or a return to a visited tree", () => {
    fc.assert(
      fc.property(chainData, (d) => {
        const first = d.rows[0]!;
        const empty = {
          link: { ...first.link, step: "person" as const, from: first.link.to },
          signer: "person" as const,
        };
        expect(chain(d.squash, [first, empty, empty, ...d.rows.slice(1)], d.trees, d.placed)).toEqual([
          stuck("broken_chain", d.squash),
        ]);
        const end = d.rows.at(-1)!.link.to;
        const back = logged({ ...first.link, step: "lead", from: end, to: first.link.to }, d.base, d.squash);
        expect(
          chain(d.squash, [...d.rows, back, empty], new Map(d.trees).set(d.squash, first.link.to), d.placed),
        ).toEqual([stuck("broken_chain", d.squash)]);
      }),
      runs,
    );
  });
  // Plant: ignore placement on main.
  it("P25: every base precedes a squash on main", () => {
    fc.assert(
      fc.property(chainData, fc.nat(), (d, at) => {
        for (const placed of [
          { ...d.placed, onMain: false },
          { ...d.placed, before: new Set<string>() },
        ]) {
          expect(chain(d.squash, d.rows, d.trees, placed)).toEqual([stuck("broken_chain", d.squash)]);
        }

        const rows = d.rows.map((r, i) =>
          i === at % d.rows.length ? { ...r, link: { ...r.link, base: d.other } } : r,
        );
        expect(chain(d.squash, rows, d.trees, d.placed)).toEqual([stuck("broken_chain", d.squash)]);
      }),
      runs,
    );
  });
  // Plant: scan only this squash's rows for newest links.
  it("P26: other squashes affect freshness only for verified links of the same ticket", () => {
    fc.assert(
      fc.property(chainData, (d) => {
        const n = d.notes.at(-1)!;
        const extra = logged({ ...n, version: n.version + 100, to: d.other }, d.base, d.other);
        expect(chain(d.squash, [...d.rows, extra], d.trees, d.placed)).toEqual([
          stuck("stale_link", d.squash, { step: n.step }),
        ]);

        for (const noise of [
          { ...extra, signer: null },
          { ...extra, link: { ...extra.link, ticket: `${n.ticket}0` } },
        ]) {
          expect(chain(d.squash, [noise, ...d.rows], d.trees, d.placed)).toEqual([DONE]);
        }
      }),
      runs,
    );
  });
  // 0098: a squash that landed behind main has its own tree, and the chain ends at the head's tree.
  // Plant: end at the squash's tree only; or accept any end once a head is given.
  it("P31: a chain ends at the head's tree when the squash landed behind main, and only there", () => {
    fc.assert(
      fc.property(chainData, (d) => {
        const end = d.rows.at(-1)!.link.to;
        const behind = new Map(d.trees).set(d.squash, d.other);
        const atHead = { ...d.placed, head: end };
        expect(chain(d.squash, d.rows, behind, atHead)).toEqual([DONE]);
        expect(chain(d.squash, d.rows, behind, d.placed)).toEqual([stuck("broken_chain", d.squash)]);
        expect(chain(d.squash, d.rows.slice(0, -1), behind, atHead)).toEqual([stuck("broken_chain", d.squash)]);
        expect(chain(d.squash, d.rows.slice(1), behind, atHead)).toEqual([stuck("broken_chain", d.squash)]);
        expect(chain(d.squash, d.rows, behind, { ...atHead, onMain: false })).toEqual([
          stuck("broken_chain", d.squash),
        ]);
      }),
      runs,
    );
  });
});

describe("printed lines", () => {
  // Plant: stop JSON-quoting paths.
  it("P27: every generated path is quoted without raw control bytes, backticks, markup openers or bars", () => {
    fc.assert(
      fc.property(fc.string(), (path) => {
        const input = `${path}\n::add-mask::\r|` + "`<>%";
        const text = plain(ask([input]));
        expect(text).not.toMatch(/[\n\r`<|]/);
        expect(JSON.parse(text.slice("ask owner exam_read ".length))).toBe(input);
      }),
      runs,
    );
  });
  // Plant: omit CR escaping.
  it("P28: annotation escaping preserves generated text and escapes percent, CR and LF exactly once", () => {
    fc.assert(
      fc.property(fc.string(), (path) => {
        const raw = plain(ask([`${path}\n::add-mask::\r%`]), (p) => p);
        const text = annotate(raw);
        expect(text).not.toMatch(/[\n\r]/);
        expect(text.replaceAll("%0A", "\n").replaceAll("%0D", "\r").replaceAll("%25", "%")).toBe(raw);
      }),
      runs,
    );
  });
  // Plant: omit the step from a stuck line.
  it("P29: printed answers retain every generated step and reason", () => {
    fc.assert(
      fc.property(
        role,
        sha,
        fc.constantFrom("stale_link", "unsigned_commit", "broken_chain", "build_touched_exam"),
        (step, sha, reason) => {
          expect(plain({ _tag: "stuck", reason, sha, step })).toBe(`stuck ${reason} ${sha} step ${step}`);
          expect(plain({ _tag: "stuck", reason, sha })).toBe(`stuck ${reason} ${sha}`);
          expect(plain(DONE)).toBe("done");
        },
      ),
      runs,
    );
  });
});

describe("trusted config files", () => {
  // format: pin every byte of the trusted list, including all previously protected rows and reasons.
  it("format: exam-paths.json bytes", () => {
    // A snapshot is one template, so no comment fits beside the one line that quotes today's app.
    // oxlint-disable fabrika/no-stage-word -- the pinned bytes quote today's app, which keeps its pipeline words
    expect(readFileSync(join(ROOT, "exam-paths.json"), "utf8")).toMatchInlineSnapshot(`
      "[
        { "glob": "exam-paths.json", "why": "this list: dropping a row is changing the exam" },
        { "glob": "allowed_signers", "why": "the step keys: who may sign as which step (p87)" },
        { "glob": ".github/**", "why": "the workflows that run the checks" },
        {
          "glob": "next/apps/fabrika/src/exam/**",
          "why": "the exam's own programs and tests, this check included"
        },
        { "glob": "next/**/*.test.ts", "why": "next/'s tests" },
        { "glob": "next/**/*.test.tsx", "why": "next/'s tests" },
        { "glob": "next/**/*Test.ts", "why": "next/'s shared suites, read as RecordPartTest.suite(open) (0062)" },
        { "glob": "next/**/*.test-support.ts", "why": "next/'s test support: the stores and fixtures laws run on" },
        {
          "glob": "next/**/tsconfig.json",
          "why": "next/'s type checks, including Node's erasable syntax"
        },
        { "glob": "next/packages/libfabrika/src/node/build/compiler.ts", "why": "the shared Compiler check" },
        { "glob": "next/packages/libfabrika/src/Id.test-support.ts", "why": "the generated ID fixtures" },
        {
          "glob": "next/apps/fabrika/src/port.test-support.ts",
          "why": "the port an instance test hands to dev.ts"
        },
        { "glob": "fixtures/next/**", "why": "saved letters and vectors the tests read" },
        { "glob": "**/*.ask-desk.test.ts", "why": "today's ask-desk PR 1 laws" },
        {
          "glob": "programs/tracker/src/ask-window.laws.test.ts",
          "why": "the shared ask editor, attention and status laws"
        },
        {
          "glob": "packages/pipeline/src/ask-desk.test-support.ts",
          "why": "the ask-desk properties' test runner and input constraints"
        },
        { "glob": "fixtures/ask-desk/**", "why": "ask-desk saved cases, vectors and mutation plants" },
        { "glob": "apps/fabrika/e2e.ts", "why": "today's real-app checks and their routing" },
        { "glob": "apps/fabrika/e2e/**", "why": "today's real-app checks and captures" },
        { "glob": "programs/tracker/package.json", "why": "the shared ask-view subpath" },
        { "glob": "next/apps/fabrika/e2e.ts", "why": "the end-to-end runner" },
        { "glob": "next/apps/fabrika/e2e/**", "why": "the end-to-end tests" },
        {
          "glob": "apps/fabrika/src/**/*.test.ts",
          "why": "today's app tests, including configurable keys"
        },
        { "glob": "apps/fabrika/e2e.ts", "why": "today's app end-to-end runner and screenshot checks" },
        { "glob": "apps/fabrika/projects-e2e.ts", "why": "T276 real project flows and capture steps" },
        { "glob": "apps/fabrika/summon-e2e.ts", "why": "the real fake-agent summon capture steps" },
        { "glob": "apps/fabrika/src/project.test-support.ts", "why": "T276 generated project fixtures and plant checks" },
        { "glob": "apps/fabrika/src/host/settings.shared.fixture.ts", "why": "T276 cross-process shared-settings worker" },
        { "glob": "fixtures/keybindings/**", "why": "hand-written keybinding files used by the exam" },
        { "glob": ".oxlintrc.json", "why": "the lint rules" },
        { "glob": ".oxfmtrc.json", "why": "the format settings" },
        { "glob": "stylelint.config.ts", "why": "the CSS lint rules and their known lists" },
        { "glob": "oxlint-plugins/**", "why": "the custom lint rules and the lint runner" },
        { "glob": "vitest.config.ts", "why": "which tests run, and their time limit" },
        {
          "glob": ".agents/skills/*/scripts/*.test.ts",
          "why": "the step scripts' laws and planted breaks"
        },
        {
          "glob": ".agents/skills/lead/scripts/skillscheck.sh",
          "why": "the shared skills' source-and-link lint check"
        },
        { "glob": ".agents/skills/lead/scripts/leakgrep.sh", "why": "the added-text check before push" },
        { "glob": "scripts/*.test.ts", "why": "today's tooling limits and script laws" },
        {
          "glob": ".agents/skills/lead/scripts/loosening.sh",
          "why": "the check for removed, muted or narrowed laws"
        },
        { "glob": "layer-rules.json", "why": "which way imports may point" },
        { "glob": "boundary-rules.json", "why": "which package may import which" },
        { "glob": "pnpm-workspace.yaml", "why": "the packages and the catalog's versions" },
        {
          "glob": "compiler-ledger.json",
          "why": "the owner's ledger of functions left out of the React Compiler"
        },
        { "glob": "unreachable-ledger.json", "why": "the owner's ledger of dead exports" },
        { "glob": "next-ledger.json", "why": "next/'s list of old lint breaks, which only shrinks (0524)" },
        { "glob": "agents-ledger.json", "why": "lead tooling's list of old lint breaks, which only shrinks (0524)" },
        { "glob": "node-kinds.json", "why": "names code-graph treats as used; each must be bound by that name (0524)" },
        { "glob": "package.json", "why": "the root scripts: lint, test, typecheck and this check" },
        { "glob": "pnpm-lock.yaml", "why": "the exact dependencies the tests and checks run" },
        { "glob": "tsconfig.base.json", "why": "the type checker's strictness" },
        { "glob": "patches/**", "why": "the Effect checks patched into tsgo" },
        {
          "glob": "packages/fabrika-design/tokens/**",
          "why": "the token files: each step, its owner, what it sits on and its floor"
        },
        { "glob": "packages/fabrika-design/src/build/schema.ts", "why": "what a token file may say" },
        {
          "glob": "packages/fabrika-design/src/build/contrast.ts",
          "why": "the contrast checker the floors are judged by"
        },
        { "glob": "packages/fabrika-design/src/**/*.test.ts", "why": "the design package's laws" },
        { "glob": "apps/fabrika/src/window/colors.test.ts", "why": "the app's color laws" },
        { "glob": "apps/fabrika/src/pipes.test.ts", "why": "the pipe color laws" },
        { "glob": "apps/fabrika/e2e.ts", "why": "today's app's keyboard focus laws and capture stages" },
        { "glob": "apps/fabrika/aria/**", "why": "the approved ARIA snapshots" }
      ]
      "
    `);
    // oxlint-enable fabrika/no-stage-word
  });
});

const parentLists = fc.uniqueArray(filename, { minLength: 3, maxLength: 9 }).chain((folders) =>
  fc.record({
    left: fc.constant(folders.slice(0, 1).map((f) => ({ glob: `${f}/**`, reason: "" }))),
    right: fc.constant(folders.slice(1, -1).map((f) => ({ glob: `${f}/**`, reason: "" }))),
    paths: fc.array(
      fc.tuple(fc.constantFrom(...folders), filename).map(([f, n]) => `${f}/${n}.ts`),
      { minLength: 1, maxLength: 8 },
    ),
  }),
);

const refusals = (cs: Commit[], main = EXAM) => check(pr(cs), main).answers.filter((a) => a._tag === "stuck");

describe("0053 parent exam lists", () => {
  // Plant: use main's matcher, or union main and parent.
  it("t1: build paths use only its parent list", () => {
    fc.assert(
      fc.property(anyNote, parentLists, (n, { left, right, paths }) => {
        const c = { ...commit({ ...n, step: "build" }, paths), exam: left };
        const matched = paths.filter(examMatcher(left)).sort();
        const expected = matched.length ? [stuck("build_touched_exam", c.sha, { paths: matched })] : [];
        expect(refusals([c], examMatcher(right))).toEqual(expected);
        expect(refusals([c], examMatcher(left))).toEqual(expected);
      }),
      runs,
    );
  });
  // Plant: ask from parent lists, or their union with main.
  it("t2: owner read uses main and changed alone", () => {
    fc.assert(
      fc.property(route, parentLists, ({ commits }, { left, right, paths }) => {
        const main = examMatcher(right);
        const matched = [...new Set(paths.filter(main))].sort();

        for (const exam of [left, right]) {
          const result = check(
            pr(
              commits.map((c) => ({ ...c, exam, paths: ["unrelated/file.ts"] })),
              { changed: paths },
            ),
            main,
          );
          expect(result.answers.filter((a) => a._tag === "ask")).toEqual(matched.length ? [ask(matched)] : []);
        }
      }),
      runs,
    );
  });
  // Plant: null is empty, falls back to main, or skips the commit.
  it("t3: missing build list fails closed even without paths", () => {
    fc.assert(
      fc.property(route, fc.array(filename), ({ commits }, paths) => {
        const cs = commits.map((c) => ({ ...c, paths, exam: c.signed?.note.step === "build" ? null : c.exam }));
        const expected = cs.filter((c) => c.signed?.note.step === "build").map((c) => stuck("no_exam_list", c.sha));
        expect(refusals(cs)).toEqual(expected);
      }),
      runs,
    );
  });
  // Plant: stale first, or no_exam_list before unsigned.
  it("t4: unsigned then missing list then stale", () => {
    fc.assert(
      fc.property(anyNote, (n) => {
        const note = { ...n, step: "build" as const };
        const c = { ...commit(note), exam: null };
        const newer = signed({ ...note, version: note.version + 1 });
        expect(check(pr([c], { notes: [signed(note), newer] }), EXAM).answers).toEqual([stuck("no_exam_list", c.sha)]);
        expect(refusals([{ ...c, signed: null }])).toEqual([stuck("unsigned_commit", c.sha)]);
      }),
      runs,
    );
  });
  // Plant: refuse every missing list, including tests, lead and person.
  it("t5: non-build commits ignore missing parent lists", () => {
    fc.assert(
      fc.property(route, ({ commits }) => {
        const cs = commits.filter((c) => c.signed?.note.step !== "build");
        const people = commits.map((c): Commit => ({ ...c, signed: null, person: true }));

        for (const group of [cs, people]) {
          expect(refusals(group.map((c) => ({ ...c, exam: null })))).toEqual(refusals(group));
        }
      }),
      runs,
    );
  });
  // Plant: use the first or last commit's list for all commits.
  it("t6: another commit list cannot change this commit answer", () => {
    fc.assert(
      fc.property(route, parentLists, ({ commits }, { left, right, paths }) => {
        const cs = commits.slice(0, 5).map((c) => ({ ...c, paths, exam: left }));

        for (let i = 0; i < cs.length; i++) {
          const changed = cs.map((c, j) => ({ ...c, exam: i === j ? right : left }));
          expect(refusals(changed).filter((a) => a.sha !== cs[i]?.sha)).toEqual(
            refusals(cs).filter((a) => a.sha !== cs[i]?.sha),
          );
        }
      }),
      runs,
    );
  });
});
