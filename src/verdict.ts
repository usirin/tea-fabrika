// A review verdict of today's fabrika, read back from the comment it was
// posted as. The reviewer posts one comment per namespace (`review-code`,
// `review-doc`, `review-skill`, `review-ui`, `governance`). Its first line is
// a marker that binds the verdict to a commit or a range:
//
//   review-code: FAIL @ <40-hex head> content:<digest> — <one-line reason>
//   review-doc: PASS range:<base>..<tip> content:<digest> — <one-line reason>
//
// A re-post at the same head keeps the old verdict in the same comment, under
// a `## Superseded verdict — <date>` heading. This file only reads text: the
// marker, the verdicts one comment holds, and the findings one failed verdict
// lists. Experiment 54 counts over them.

export const NAMESPACES = ["review-code", "review-doc", "review-skill", "review-ui", "governance"] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** The first line of a verdict. */
export interface Marker {
  readonly namespace: Namespace;
  readonly polarity: "PASS" | "FAIL";
  /** The commit the verdict binds to, as written (40 hex, or shorter in old verdicts). `null` on a range verdict. */
  readonly head: string | null;
  /** On an epic child: the range the verdict binds to. */
  readonly range: { readonly base: string; readonly tip: string } | null;
  /** The reviewer's one-line reason, after the dash. */
  readonly clause: string;
}

const MARKER = new RegExp(
  `^(${NAMESPACES.join("|")}): (PASS|FAIL)(?: @ ([0-9a-f]{7,40})| range:([0-9a-f]{7,40})\\.\\.([0-9a-f]{7,40}))?(?: content:[0-9a-f]+)?(?:\\s+[—-]+\\s*(.*))?$`,
);

/** A marker line, or `null` when the line is not one. */
export function parseMarker(line: string): Marker | null {
  const m = MARKER.exec(line.trim());
  if (m === null) return null;
  const [, namespace, polarity, head, base, tip, clause] = m;
  return {
    namespace: namespace as Namespace,
    polarity: polarity as "PASS" | "FAIL",
    head: head ?? null,
    range: base !== undefined && tip !== undefined ? { base, tip } : null,
    clause: (clause ?? "").trim(),
  };
}

/** One verdict inside a comment. */
export interface Verdict {
  readonly marker: Marker;
  /** The text under the marker line. */
  readonly body: string;
  /** Retired by a later verdict in the same comment. */
  readonly superseded: boolean;
  /** The date on the `Superseded verdict` heading, when it has one. */
  readonly retiredOn: string | null;
}

const SUPERSEDED = /^## Superseded verdict(?:\s+[—-]+\s*(\S+))?\s*$/;

/**
 * The verdicts one comment holds: the standing one first, then each one it
 * retired, in the order the comment lists them. A comment that does not open
 * with a marker holds none.
 */
export function verdictsIn(comment: string): readonly Verdict[] {
  const lines = comment.replace(/\r\n/g, "\n").split("\n");
  const first = parseMarker(lines[0] ?? "");
  if (first === null) return [];
  // Each part: where its marker line is, and the heading that retired it.
  const parts: { at: number; marker: Marker; retiredOn: string | null; superseded: boolean }[] = [
    { at: 0, marker: first, retiredOn: null, superseded: false },
  ];
  const cuts: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const heading = SUPERSEDED.exec(lines[i] as string);
    if (heading === null) continue;
    // The retired verdict's marker is the first line with text under the heading.
    let j = i + 1;
    while (j < lines.length && (lines[j] as string).trim() === "") j++;
    const marker = parseMarker(lines[j] ?? "");
    if (marker === null) continue;
    cuts.push(i);
    parts.push({ at: j, marker, retiredOn: heading[1] ?? null, superseded: true });
    i = j;
  }
  return parts.map((part, index) => {
    const end = cuts[index] ?? lines.length;
    const body = lines
      .slice(part.at + 1, end)
      .filter((line) => line.trim() !== "<!-- fabrika:superseded -->")
      .join("\n")
      .trim();
    return { marker: part.marker, body, superseded: part.superseded, retiredOn: part.retiredOn };
  });
}

// ---------------------------------------------------------------- verdicts over a comment's life

/** A comment as the tracker serves it. Times are ms. */
export interface CommentText {
  readonly id: number;
  readonly url: string;
  readonly at: number;
  readonly editedAt: number | null;
  readonly body: string;
}

/** One text a comment has held, and when it was given that text. */
export interface CommentVersion {
  readonly at: number;
  readonly body: string;
}

/** One verdict as it was posted: which comment, when, and its text. */
export interface Posted {
  readonly commentId: number;
  readonly url: string;
  readonly marker: Marker;
  readonly body: string;
  readonly at: number;
}

/**
 * Every verdict a comment has stood for. With the comment's earlier texts
 * (`versions`, oldest first) that is the standing verdict of each text, at
 * the moment the text was written: a FAIL that a later PASS overwrote is
 * still there. Without them it is what the last text shows: the standing
 * verdict at the last edit, and the oldest retired one at the comment's
 * creation. A retired verdict between those two has no known time and is
 * left out.
 */
export function postedIn(comment: CommentText, versions: readonly CommentVersion[] | null): readonly Posted[] {
  const base = { commentId: comment.id, url: comment.url };
  if (versions !== null && versions.length > 0) {
    return versions.flatMap((version) => {
      const [standing] = verdictsIn(version.body);
      return standing === undefined ? [] : [{ ...base, marker: standing.marker, body: standing.body, at: version.at }];
    });
  }
  const verdicts = verdictsIn(comment.body);
  const [standing] = verdicts;
  if (standing === undefined) return [];
  const out: Posted[] = [{ ...base, marker: standing.marker, body: standing.body, at: comment.editedAt ?? comment.at }];
  const oldest = verdicts.at(-1);
  if (verdicts.length > 1 && oldest !== undefined) out.push({ ...base, marker: oldest.marker, body: oldest.body, at: comment.at });
  return out;
}

/**
 * The verdicts one lane event stands for. The reviewer posts its comments and
 * then writes the lane line, so they sit after the task's event before this
 * one (`since`) and no later than a moment after the line (`until`, plus
 * `slack` for two clocks). When a comment was re-posted inside that window,
 * its last text is the one that counts.
 */
export function verdictsBetween(posted: readonly Posted[], since: number, until: number, slack = 2 * 60_000): readonly Posted[] {
  const last = new Map<number, Posted>();
  for (const p of posted) {
    if (p.at <= since || p.at > until + slack) continue;
    const seen = last.get(p.commentId);
    if (seen === undefined || p.at >= seen.at) last.set(p.commentId, p);
  }
  return [...last.values()].sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- the findings in one failed verdict

/** One finding as the reviewer wrote it. */
export interface FindingText {
  /** Its first line, with the markdown taken off. */
  readonly title: string;
  /** The whole item. */
  readonly text: string;
  /** `false` when the reviewer said it does not block: a note, a nit, something filed for later. */
  readonly blocking: boolean;
  /** How the splitter found it. */
  readonly from: "section" | "item" | "row" | "paragraph";
}

interface Section {
  readonly level: number;
  readonly title: string;
  readonly lines: readonly string[];
}

/** A verdict's body as its `##` to `####` sections, in order. Text above the first heading is a section with no title. */
function sectionsOf(body: string): Section[] {
  const out: { level: number; title: string; lines: string[] }[] = [{ level: 0, title: "", lines: [] }];
  let fenced = false;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{2,4})\s+(.*\S)\s*$/.exec(line);
    if (heading === null) (out.at(-1) as { lines: string[] }).lines.push(line);
    else out.push({ level: (heading[1] as string).length, title: heading[2] as string, lines: [] });
  }
  return out;
}

/** The reviewer saying a point does not block: a note, a nit, or a thing filed for later. Read on a heading or an item's opening words. */
const SOFT =
  /non[- ]?blocking|not[- ]blocking|not a blocker|do(?:es)? not block|doesn't block|not (?:a |part of (?:the|this) )?(?:finding|fail)|\bno finding\b|\bnotes?\b|\bnoted\b|\bnits?\b|\bcraft\b|\badvisory\b|\bobservations?\b|filed separately|\bout of scope\b|\bnot graded\b|for the record/i;
/** A heading that opens the reviewer's findings. */
const FINDING_TITLE = /\bfindings?\b|\bblock(?:er|ers|ing|s)?\b|\bwhy\b.*\bfails?\b|\bthe (?:defect|gap|miss|problem|contradiction)\b|\bwhat (?:fails|is wrong|is missing|blocks)\b/i;
/** A heading that opens a list of findings, not one. */
const PLURAL = /\bfindings\b|\bblockers\b|\bdefects\b|\bgaps\b|\bproblems\b/i;
/** A heading about an earlier round's findings, or the fix: not a finding of this verdict. */
const NOT_OURS = /round[- ]\d+(?:'s)? findings?|findings? (?:from|of) round|earlier findings?|prior findings?|\brepair\b|\bremedy\b|\bfix\b|what i (?:read|checked|ran)/i;

/** Where an item of a list of findings starts: `1.`, `**1 —`, `**Finding 2.**`, `- **`, `F1.`. */
const ITEM = /^(?:\*\*\s*(?:finding\s+|f)?\d+\b|(?:finding\s+|f)?\d+[.)]\s+\S|[-*]\s+\*\*|\*\*\s*(?:finding|blocking)\b)/i;

const plain = (text: string) => text.replace(/[*_`#>]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
const titleOf = (text: string) => {
  const first = plain(text.split("\n").find((line) => line.trim() !== "") ?? "");
  return first.length > 200 ? `${first.slice(0, 197)}...` : first;
};

/** A section's lines as its list items, or as one item when it has no list. */
function itemsOf(lines: readonly string[]): string[] {
  const items: string[][] = [];
  let fenced = false;
  let preamble: string[] = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && ITEM.test(line)) items.push([line]);
    else if (items.length > 0) (items.at(-1) as string[]).push(line);
    else preamble.push(line);
  }
  if (items.length === 0) {
    preamble = preamble.join("\n").trim() === "" ? [] : preamble;
    return preamble.length === 0 ? [] : [preamble.join("\n").trim()];
  }
  return items.map((item) => item.join("\n").trim());
}

/**
 * The findings a failed verdict lists. Reviewers write free prose, so this
 * goes by the shapes they use most: a section whose heading says "finding",
 * "blocking" or "why this fails", split into its list items; failing that, a
 * `FAIL` row of a criteria table or a `[FAIL]` list item; failing that, a
 * paragraph that opens with a bold `FAIL`. An empty answer means none of
 * those shapes is there: the caller has the verdict's one-line reason to fall
 * back on.
 */
export function findingsIn(body: string): readonly FindingText[] {
  const sections = sectionsOf(body);
  const ours = (s: Section) => s.title !== "" && FINDING_TITLE.test(s.title) && !NOT_OURS.test(s.title);
  // A heading in the plural ("Findings") opens a list. One in the singular ("The finding", "Why FAIL") is one finding,
  // and a list inside it is that finding's reasons. Where a verdict has both, the list is the fuller account.
  const listed = sections.some((s) => ours(s) && PLURAL.test(s.title));
  const out: FindingText[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i] as Section;
    if (!ours(section)) continue;
    const plural = PLURAL.test(section.title);
    if (listed && !plural) continue;
    const soft = SOFT.test(section.title);
    const children: Section[] = [];
    for (let j = i + 1; j < sections.length && (sections[j] as Section).level > section.level; j++) children.push(sections[j] as Section);
    const own = itemsOf(section.lines);
    if (!plural) {
      // The whole section, its deeper headings included, is one finding.
      const text = [section.title, section.lines.join("\n").trim(), ...children.map((c) => `${c.title}\n${c.lines.join("\n").trim()}`)].join("\n").trim();
      out.push({ title: titleOf(section.lines.join("\n").trim() === "" ? section.title : section.lines.join("\n")), text, blocking: !soft, from: "section" });
      i += children.length;
      continue;
    }
    // Deeper headings under a plural heading are its findings, one each.
    if (children.length > 0 && own.length <= 1) {
      for (const child of children) {
        if (NOT_OURS.test(child.title)) continue;
        const text = `${child.title}\n${child.lines.join("\n").trim()}`;
        out.push({ title: plain(child.title), text, blocking: !soft && !SOFT.test(child.title), from: "section" });
      }
      i += children.length;
      continue;
    }
    for (const item of own) {
      // "None." under a findings heading is the reviewer saying there are none.
      if (own.length === 1 && /^(?:none|nothing|no (?:new )?findings?)\b/i.test(plain(item))) continue;
      const lead = item.slice(0, 110);
      out.push({ title: titleOf(item), text: item, blocking: !soft && !SOFT.test(lead), from: own.length === 1 ? "section" : "item" });
    }
  }
  if (out.length > 0) return out;

  // No findings section: the failing rows of a criteria table, or `[FAIL]` list items.
  let fenced = false;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const row = /^\s*\|/.test(line) && /\|\s*(?:\*\*)?\[?(?:FAIL|unmet|not met)\]?(?:\*\*)?\s*\|/i.test(line);
    const item = /^\s*(?:[-*]|\d+[.)])\s/.test(line) && /(?:\[FAIL\]|\*\*FAIL\*\*|—\s*FAIL\b)/.test(line);
    if (row || item) out.push({ title: titleOf(line.replace(/\|/g, " ")), text: line.trim(), blocking: true, from: "row" });
  }
  if (out.length > 0) return out;

  // Nothing listed: paragraphs that open with a bold FAIL.
  for (const paragraph of body.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    if (/^\s*\*\*\s*(?:FAIL|FINDING|Blocking)\b/i.test(paragraph)) out.push({ title: titleOf(paragraph), text: paragraph.trim(), blocking: true, from: "paragraph" });
  }
  return out;
}
