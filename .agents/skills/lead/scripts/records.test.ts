import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { batchTexts, type Folder, inOrder, isRecord, nextNumber, readTop, recordLine } from "./records.ts";

const script = join(import.meta.dirname, "records.ts");
const folders: ReadonlyArray<Folder> = [".decisions", "experiments", ".patterns", "docs/direction"];
const folder = fc.constantFrom(...folders);
const slug = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/);
// One line of frontmatter text: anything with no line break, quotes, colons and backticks included.
const value = fc.string({ minLength: 1 }).filter((s) => !/[\r\n]/.test(s) && s.trim() === s);

describe("nextNumber", () => {
  it("property: the next number is the highest record's number plus one, padded, and never a number already there", () =>
    fc.assert(
      fc.property(fc.constantFrom<Folder>(".decisions", "experiments"), fc.array(fc.nat({ max: 9999 })), (at, ns) => {
        const width = at === ".decisions" ? 4 : 2;
        const paths = ns.map((n) => `${at}/${String(n).padStart(width, "0")}-x.md`);
        const next = nextNumber(at, paths) ?? "";
        expect(next).toBe(String(Math.max(0, ...ns) + 1).padStart(width, "0"));
        expect(ns).not.toContain(Number(next));
      }),
    ));

  it("property: a gap below the highest number is never handed out again", () =>
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 900 }), (top) => {
        const paths = [`experiments/01-a.md`, `experiments/${top}-b.md`];
        expect(Number(nextNumber("experiments", paths))).toBe(top + 1);
      }),
    ));

  it("property: files that are not records take no number", () =>
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 500 }), { minLength: 1 }), (ns) => {
        const paths = ns.map((n) => `experiments/${n}-x.md`);
        const noise = [
          "experiments/README.md",
          "experiments/open-questions.md",
          "experiments/999-x.json",
          "elsewhere/998-x.md",
        ];
        expect(nextNumber("experiments", [...paths, ...noise])).toBe(nextNumber("experiments", paths));
      }),
    ));

  it("scenario: an empty folder that was read is number 1, and an unnumbered folder has no next number", () => {
    expect(nextNumber(".decisions", [])).toBe("0001");
    expect(nextNumber(".patterns", [".patterns/a.md"])).toBeUndefined();
    expect(nextNumber("docs/direction", [])).toBeUndefined();
  });
});

describe("inOrder", () => {
  it("property: numbered records come by number, whatever order git lists them in, and every record stays once", () =>
    fc.assert(
      fc.property(fc.uniqueArray(fc.nat({ max: 999 }), { minLength: 1 }), (ns) => {
        const paths = ns.map((n) => `experiments/${n}-x.md`);
        const ordered = inOrder("experiments", [...paths].sort());
        expect(ordered.map((p) => Number(/\/(\d+)-/.exec(p)?.[1]))).toEqual([...ns].sort((a, b) => a - b));
      }),
    ));

  it("scenario: a record with no number comes after the numbered ones, and a folder with no numbers goes by name", () => {
    expect(
      inOrder("experiments", ["experiments/open-questions.md", "experiments/203-x.md", "experiments/65-y.md"]),
    ).toEqual(["experiments/65-y.md", "experiments/203-x.md", "experiments/open-questions.md"]);
    expect(inOrder(".patterns", [".patterns/b.md", ".patterns/README.md", ".patterns/a.md"])).toEqual([
      ".patterns/a.md",
      ".patterns/b.md",
    ]);
  });
});

describe("isRecord", () => {
  it("property: a folder's README is never a record, and a Markdown file beside it is, decisions only with a number", () =>
    fc.assert(
      fc.property(folder, slug, (at, name) => {
        expect(isRecord(at, `${at}/README.md`)).toBe(false);
        expect(isRecord(at, `${at}/${name}.md`)).toBe(at !== ".decisions" || /^\d+[a-z]?-/.test(name));
        expect(isRecord(at, `${at}/0001-${name}.md`)).toBe(true);
        expect(isRecord(at, `${at}/${name}.json`)).toBe(false);
      }),
    ));

  it("scenario: only docs/direction counts a subfolder's README, as follows/README.md", () => {
    expect(isRecord("docs/direction", "docs/direction/follows/README.md")).toBe(true);
    expect(isRecord("docs/direction", "docs/direction/follows/otp.md")).toBe(false);
    expect(isRecord("experiments", "experiments/results/README.md")).toBe(false);
  });
});

describe("readTop", () => {
  it("property: a value written as a JSON string reads back the same, whatever it holds", () =>
    fc.assert(
      fc.property(value, value, (summary, when) => {
        const text = `---\nsummary: ${JSON.stringify(summary)}\nwhen: ${JSON.stringify(when)}\n---\n\n# Title\n`;
        const top = readTop(text);
        expect(top.fields.get("summary")).toBe(summary);
        expect(top.fields.get("when")).toBe(when);
        expect(top.heading).toBe("Title");
      }),
    ));

  it("format: a decision's plain frontmatter reads as written, a bracketed status included", () => {
    const text = [
      "---",
      "id: 0008",
      "title: Decision discovery is the AGENTS.md contract alone",
      "status: amended-in-part by [0522](0522-no-folder-keeps-an-index-table.md)",
      "tags: [decisions, discovery]",
      "---",
      "",
      "# 0008: Decision discovery is the AGENTS.md contract alone",
    ].join("\n");
    const top = readTop(text);
    expect(top.fields.get("title")).toBe("Decision discovery is the AGENTS.md contract alone");
    expect(top.fields.get("status")).toBe("amended-in-part by [0522](0522-no-folder-keeps-an-index-table.md)");
  });

  it("scenario: a file with no frontmatter has no fields and still has its heading; a heading inside the block is not it", () => {
    expect(readTop("# 79. Inputs over time\n\nScripted runs only.\n")).toEqual({
      fields: new Map(),
      heading: "79. Inputs over time",
    });
    expect(readTop("no heading at all").heading).toBeUndefined();
  });
});

describe("recordLine", () => {
  it("property: a line is one line, starts with the record's id and holds each value it prints", () =>
    fc.assert(
      fc.property(fc.nat({ max: 999 }), value, value, (n, title, summary) => {
        const path = `experiments/${n}-x.md`;
        const text = `---\ndate: "2026-11-13"\nsummary: ${JSON.stringify(summary)}\n---\n\n# ${n}. ${title}\n`;
        const line = recordLine("experiments", path, text);
        expect(line).not.toContain("\n");
        expect(line.startsWith(`${n}  2026-11-13  `)).toBe(true);
        expect(line).toContain(`summary: ${summary.replace(/\s+/g, " ").trim()}`);
      }),
    ));

  it("format: one line per folder, in the shape each folder prints", () => {
    expect(
      recordLine(
        ".decisions",
        ".decisions/0522-no-index.md",
        "---\nid: 0522\ntitle: No index\nstatus: accepted\n---\n",
      ),
    ).toBe("0522  accepted  No index");
    expect(
      recordLine(
        "experiments",
        "experiments/75d-pipe-ack.md",
        '---\ndate: "2026-10-17"\nsummary: "Yes."\n---\n\n# 75d. An ack on the pipe\n',
      ),
    ).toBe("75d  2026-10-17  An ack on the pipe  summary: Yes.");
    expect(
      recordLine(
        ".patterns",
        ".patterns/settings.md",
        '---\nwhere: "next/ settings"\nwhen: "Adding a setting"\n---\n\n# One declaration\n',
      ),
    ).toBe("settings  next/ settings  One declaration  when: Adding a setting");
    expect(
      recordLine(
        "docs/direction",
        "docs/direction/follows/README.md",
        '---\nsummary: "One table per model."\n---\n\n# Follows\n',
      ),
    ).toBe("follows/README  Follows  summary: One table per model.");
  });

  it("scenario: a record with no frontmatter says what it lacks instead of printing nothing", () => {
    expect(recordLine("experiments", "experiments/79-inputs.md", "# 79. Inputs over time\n")).toBe(
      "79  (no date)  Inputs over time  summary: (no summary)",
    );
    expect(recordLine(".patterns", ".patterns/x.md", "")).toBe("x  (no where)  (no title)  when: (no when)");
  });
});

describe("batchTexts", () => {
  it("property: each object's text comes back whole and in order, multibyte text and newlines included", () =>
    fc.assert(
      fc.property(fc.array(fc.string()), (texts) => {
        const encoder = new TextEncoder();
        const parts = texts.flatMap((text) => {
          const bytes = encoder.encode(text);
          return [encoder.encode(`abc123 blob ${bytes.length}\n`), bytes, encoder.encode("\n")];
        });
        const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        parts.reduce((at, p) => {
          all.set(p, at);
          return at + p.length;
        }, 0);
        expect(batchTexts(all)).toEqual(texts);
      }),
    ));

  it("format: a missing object is undefined in its place", () => {
    const bytes = new TextEncoder().encode("origin/main:x.md missing\nabc blob 2\nhi\n");
    expect(batchTexts(bytes)).toEqual([undefined, "hi"]);
  });
});

describe("records.ts on a real clone", () => {
  const root = mkdtempSync(join(tmpdir(), "records-"));
  const git = (cwd: string, ...args: Array<string>) => {
    const ran = spawnSync("git", args, { cwd, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);
  };
  const put = (repo: string, path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const records = (cwd: string, ...args: Array<string>) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const origin = join(root, "origin.git");
  const clone = join(root, "clone");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, clone);
  git(clone, "config", "user.email", "test@example.com");
  git(clone, "config", "user.name", "test");
  git(clone, "config", "commit.gpgsign", "false");
  put(clone, "experiments/README.md", "# Experiment log\n");
  put(clone, "experiments/01-first.md", '---\ndate: "2026-10-04"\nsummary: "No."\n---\n\n# 1. Is it noise?\n');
  put(clone, "experiments/07-seventh.md", "# 7. The test writer\n");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "two experiments");
  git(clone, "push", "-q", "origin", "main");

  it("scenario: an unpushed file, committed or not, takes no number and no line; main's records do", () => {
    put(clone, "experiments/08-local-only.md", "# 8. Only here\n");
    git(clone, "add", ".");
    git(clone, "commit", "-q", "-m", "local only");
    put(clone, "experiments/09-untracked.md", "# 9. Untracked\n");
    const listed = records(clone, "list", "experiments");
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout).toBe(
      "01  2026-10-04  Is it noise?  summary: No.\n07  (no date)  The test writer  summary: (no summary)\nnext 08\n",
    );
    const next = records(clone, "next", "experiments/");
    expect([next.status, next.stdout]).toEqual([0, "08\n"]);
  });

  it("scenario: a number pushed by someone else counts once fetched, which the command does itself", () => {
    const other = join(root, "other");
    git(root, "clone", "-q", origin, other);
    git(other, "config", "user.email", "test@example.com");
    git(other, "config", "user.name", "test");
    git(other, "config", "commit.gpgsign", "false");
    put(other, "experiments/12-pushed.md", "# 12. Pushed elsewhere\n");
    git(other, "add", ".");
    git(other, "commit", "-q", "-m", "pushed");
    git(other, "push", "-q", "origin", "main");
    expect(records(clone, "next", "experiments").stdout).toBe("13\n");
  });

  it("scenario: when origin/main cannot be read, it says unknown and exits 1, never 0 records or a number", () => {
    const lone = join(root, "lone");
    git(root, "init", "-q", "-b", "main", lone);
    const listed = records(lone, "list", ".decisions");
    expect(listed.status).toBe(1);
    expect(listed.stdout).toBe("");
    expect(listed.stderr).toContain("unknown, never 0 records");
  });

  it("scenario: a folder that is not one of the four, or next on a folder with no numbers, exits 2", () => {
    expect(records(clone, "list", "field").status).toBe(2);
    expect(records(clone, "next", ".patterns").status).toBe(2);
  });
});
