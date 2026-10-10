import { RawIssue } from "./issue.ts";

/** A GitHub issue named as `owner/repo#number`. */
export interface IssueRef {
  readonly repo: string;
  readonly number: number;
}

/** `kamp-us/demlik#558` as its repo and number; anything else is refused. */
export function parseIssueRef(text: string): IssueRef {
  const match = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(text.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`"${text}" is not an issue: write it as owner/repo#number`);
  }
  return { repo: match[1], number: Number(match[2]) };
}

/** An issue as `gh issue view --json title,body,author` prints it. */
export interface GitHubIssue {
  readonly title: string;
  readonly body: string;
  readonly author: { readonly login: string; readonly is_bot: boolean };
}

/** Where fabrika keeps the report as it was filed, under its own rewrite. */
const ORIGINAL = "<details>\n<summary>Original report (verbatim)</summary>";
/** The marker fabrika puts between its rewrite and the original. */
const MARKER = "<!-- fabrika:enriched";
/** The footer a report filed by an agent ends with. */
const BY_AN_AGENT = "<sub>Filed by an agent";

/**
 * A body fabrika's triage already rewrote, split into the report as it was
 * filed and fabrika's rewrite above it. `null` when the body holds no
 * original report: it is the report itself.
 */
export function splitEnriched(body: string): { readonly report: string; readonly enriched: string } | null {
  const text = body.replace(/\r\n/g, "\n");
  const start = text.indexOf(ORIGINAL);
  const end = text.lastIndexOf("</details>");
  if (start === -1 || end < start) return null;
  const marker = text.indexOf(MARKER);
  const cut = marker !== -1 && marker < start ? marker : start;
  return {
    report: text.slice(start + ORIGINAL.length, end).trim(),
    enriched: text.slice(0, cut).trim().replace(/\n-{3,}$/, "").trim(),
  };
}

/**
 * The ticket triage starts from: the original report when fabrika already
 * rewrote the issue, so our own enricher does that work again, and the whole
 * body otherwise. It was filed by an agent when the report says so in
 * fabrika's footer or a bot account opened it.
 */
export function rawIssueFrom(id: string, issue: GitHubIssue): RawIssue {
  const split = splitEnriched(issue.body);
  const body = split === null ? issue.body.trim() : split.report;
  return RawIssue.parse({
    id,
    title: issue.title,
    body,
    filedBy: issue.author.is_bot || body.includes(BY_AN_AGENT) ? "agent" : "human",
  });
}
