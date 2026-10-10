import { Cmd } from "@demlik/tea";
import { z } from "zod";

// Facts: what the code says about the names and paths a report mentions, found
// by code, never guessed. Triage gathers them before the enricher writes, so
// the enricher starts from where `replay` is defined and what it takes instead
// of digging for it. Everything here is pure; the layer that reads a repo is
// `src/code-facts.ts`.

/** What a report points at: names in backticks, file paths, and issue refs. */
export const Mentions = z.object({
  names: z.array(z.string()).readonly(),
  paths: z.array(z.string()).readonly(),
  /** `#N` refs, as written. Kept, not read: reading another issue is the tracker's. */
  refs: z.array(z.string()).readonly(),
});
export type Mentions = z.infer<typeof Mentions>;

/** Words a report puts in backticks that name no code of the repo's own. */
const NOT_CODE = new Set([
  "true", "false", "null", "undefined", "void", "never", "unknown", "any", "object", "string", "number",
  "boolean", "bigint", "symbol", "this", "new", "return", "const", "let", "var", "function", "class",
  "type", "interface", "import", "export", "default", "async", "await", "yield", "if", "else", "for",
  "while", "switch", "case", "break", "continue", "throw", "try", "catch", "finally", "typeof",
  "instanceof", "in", "of", "extends", "implements", "keyof", "readonly", "as", "is", "NaN", "Infinity",
]);

/** The extensions a mentioned file may have, so `machine.init` is not read as a file. */
const FILE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json", "jsonc", "md", "mdx", "yaml", "yml",
  "toml", "css", "html", "sh", "txt", "sql",
]);

/** A span that is one path: no spaces, path-like segments, a known extension or a trailing slash. */
function asPath(span: string): string | null {
  const bare = span.replace(/:\d+(?::\d+)?$/, "").replace(/^\.\//, "");
  if (!/^[\w@.$/-]+$/.test(bare) || bare.includes("//")) return null;
  const last = bare.split("/").filter((s) => s !== "").at(-1) ?? "";
  const dot = last.lastIndexOf(".");
  const known = dot > 0 && FILE_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
  if (known) return bare;
  return bare.includes("/") && bare.endsWith("/") ? bare : null;
}

/** The identifier a span names: `replay`, `CtxArg<Ctx>` and `replay(m, {})` all name their head. */
function asName(span: string): string | null {
  const head = /^([A-Za-z_$][\w$]*)(?:<[^]*>)?(?:\([^]*\))?$/.exec(span)?.[1];
  if (head === undefined || head.length < 2 || NOT_CODE.has(head)) return null;
  return head;
}

const unique = (items: readonly string[]) => [...new Set(items)];

/**
 * What a report points at, in the order it says it. A backticked span is a
 * path when it looks like one, otherwise a name when it is one identifier
 * (a generic or a call names its head). A path outside backticks counts too;
 * a URL does not. Keywords, literals and one-letter names are left out.
 */
export function mentionsOf(text: string): Mentions {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => (m[1] ?? "").trim());
  const outside = text.replace(/`[^`\n]*`/g, " ").replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, " ");
  const barePaths = [...outside.matchAll(/(?:^|[\s(["'])((?:[\w@.-]+\/)+[\w@.-]+)(?=$|[\s)\]"',.:;!?])/gm)].map(
    (m) => m[1] ?? "",
  );
  const paths: string[] = [];
  const names: string[] = [];
  for (const span of spans) {
    const path = asPath(span);
    if (path !== null) paths.push(path);
    else {
      const name = asName(span);
      if (name !== null) names.push(name);
    }
  }
  for (const candidate of barePaths) {
    const path = asPath(candidate);
    if (path !== null) paths.push(path);
  }
  const refs = [...outside.matchAll(/(?:^|[^\w/&#])#(\d+)\b/g)].map((m) => `#${m[1]}`);
  return { names: unique(names), paths: unique(paths), refs: unique(refs) };
}

/** Whether a report mentions anything the code can be asked about. Refs alone are not. */
export const asksTheCode = (m: Mentions): boolean => m.names.length > 0 || m.paths.length > 0;

/** Where a mentioned name is declared. */
export const Definition = z.object({
  /** Relative to the repo root. */
  file: z.string(),
  line: z.number(),
  exported: z.boolean(),
  /** The declaration up to its body, on one line, cut short when long. */
  signature: z.string(),
  /** The `name` of the package the file is in, or `null` when no package.json holds it. */
  package: z.string().nullable(),
  /**
   * The package's export subpaths that publish this very declaration, each with
   * its tier when the package keeps a tier table. Empty: exported from its file
   * and published by none. `null`: not checked (not exported, or no package).
   */
  published: z
    .array(z.object({ subpath: z.string(), tier: z.string().nullable() }))
    .readonly()
    .nullable(),
  /**
   * Who calls it, as `file:line` of each call, a few of them, and how many in
   * all. `null` when the call graph does not hold it: a type, or a package the
   * graph could not be built for.
   */
  callers: z.object({ total: z.number(), sample: z.array(z.string()).readonly() }).nullable(),
});
export type Definition = z.infer<typeof Definition>;

/**
 * One mentioned name. No definitions and nothing `more`: nothing at HEAD
 * declares it, often a sign of a stale report. No definitions and some `more`:
 * nothing exports it, and it is declared locally in many places, a common
 * variable name rather than one thing.
 */
export const NameFact = z.object({
  name: z.string(),
  definitions: z.array(Definition).readonly(),
  /** Declarations found beyond the ones kept. */
  more: z.number(),
  /** How many files at HEAD hold the word at all. */
  mentionedIn: z.number(),
});
export type NameFact = z.infer<typeof NameFact>;

/** One mentioned path. `near` are files at HEAD it may have meant: the same path deeper down, or the same file name. */
export const PathFact = z.object({
  path: z.string(),
  exists: z.boolean(),
  near: z.array(z.string()).readonly(),
});
export type PathFact = z.infer<typeof PathFact>;

/** Everything code found, in the order the report mentions it. Small: it goes into a prompt. */
export const FactsPack = z.object({
  names: z.array(NameFact).readonly(),
  paths: z.array(PathFact).readonly(),
  refs: z.array(z.string()).readonly(),
});
export type FactsPack = z.infer<typeof FactsPack>;

/** The pack for a report that names nothing the code can be asked about. */
export const nothingToAsk = (m: Mentions): FactsPack => ({ names: [], paths: [], refs: m.refs });

/** Ask the code about what a report mentions. A failure only means the enricher reads the code itself. */
export const gatherFacts = Cmd.define("gather_facts", {
  input: z.object({ mentions: Mentions }),
  ok: FactsPack,
  err: ["facts_failed"],
});

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether one line of code declares `name`: a function, a class, a variable,
 * a type, an interface, an enum or a namespace, exported or not. A method or
 * a property is not a declaration here.
 */
export function declares(line: string, name: string): { readonly exported: boolean } | null {
  const pattern = new RegExp(
    `^\\s*(export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?(?:abstract\\s+)?` +
      `(?:function\\s*\\*?\\s*|(?:const|let|var|class|type|interface|enum|namespace)\\s+)${escape(name)}(?![\\w$])`,
  );
  const match = pattern.exec(line);
  return match === null ? null : { exported: match[1] !== undefined };
}

/**
 * The declaration that starts at `line` (counted from 1), up to its body, on
 * one line. A `{` opens the body when it follows a `)`, a `}`, a `]`, a `>`
 * or a name outside every bracket and type parameter list: `): {` is a return
 * type, `) {` a body, `=> {` an arrow's body. A type alias or a variable runs
 * to its `;`. Comments are dropped, and a long one is cut at `max` characters.
 */
export function signatureAt(text: string, line: number, max = 320): string {
  const lines = text.split("\n").slice(line - 1, line + 39);
  let out = "";
  let depth = 0;
  // Type parameters, kept apart: `<M extends { type: string }>` opens no body.
  let angles = 0;
  let last = "";
  let inBlock = false;
  scan: for (const raw of lines) {
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i] ?? "";
      const pair = raw.slice(i, i + 2);
      if (inBlock) {
        if (pair === "*/") {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (pair === "/*") {
        inBlock = true;
        i++;
        continue;
      }
      if (pair === "//") break;
      if (ch === "{" && depth === 0 && angles <= 0 && /[)\]}>\w$]/.test(last)) break scan;
      if ("([{".includes(ch)) depth++;
      if (")]}".includes(ch)) depth--;
      if (ch === "<") angles++;
      if (ch === ">" && raw[i - 1] !== "=") angles--;
      out += ch;
      if (ch === ";" && depth <= 0) break scan;
      if (!/\s/.test(ch)) last = ch;
    }
    out += " ";
  }
  const flat = out
    .replace(/\s+/g, " ")
    .replace(/([([{<]) /g, "$1")
    .replace(/ ([)\]}>])/g, "$1")
    .replace(/,([)\]}>])/g, "$1")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const quote = (subpath: string) => JSON.stringify(subpath);

function definitionLine(d: Definition): string {
  const where = `${d.file}:${d.line}`;
  const from = d.package === null ? "" : `, in ${d.package}`;
  const published =
    d.published === null
      ? ""
      : d.published.length === 0
        ? ", published by none of its package's exports"
        : `, published as ${d.published.map((p) => (p.tier === null ? quote(p.subpath) : `${quote(p.subpath)} (${p.tier})`)).join(", ")}`;
  return `${where}, ${d.exported ? "exported" : "not exported"}${from}${published}`;
}

function callersLine(d: Definition): string {
  if (d.callers === null) return "callers: not in the call graph (a type, or a package it could not be built for)";
  if (d.callers.total === 0) return "callers: none found";
  const rest = d.callers.total - d.callers.sample.length;
  return `callers: ${d.callers.total}, e.g. ${d.callers.sample.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
}

/**
 * The pack as the enricher reads it: one short block per name, one line per
 * path. It says what code found and nothing more.
 */
export function factsBrief(pack: FactsPack): string {
  const names = pack.names.flatMap((n) => {
    if (n.definitions.length === 0) {
      return [
        n.more === 0
          ? `- \`${n.name}\`: nothing at HEAD declares it; the word is in ${n.mentionedIn} file(s)`
          : `- \`${n.name}\`: nothing exports it; declared locally in ${n.more} places, a common local name; the word is in ${n.mentionedIn} file(s)`,
      ];
    }
    const more = n.more > 0 ? ` (${n.more} more declarations left out)` : "";
    return n.definitions.flatMap((d, i) => [
      `- \`${n.name}\`${i === 0 ? more : ""}: ${definitionLine(d)}`,
      `    ${d.signature}`,
      `    ${callersLine(d)}`,
    ]);
  });
  const paths = pack.paths.map((p) =>
    p.exists
      ? `- \`${p.path}\`: exists`
      : `- \`${p.path}\`: not at HEAD${p.near.length === 0 ? "" : `; maybe ${p.near.map((f) => `\`${f}\``).join(", ")}`}`,
  );
  const refs = pack.refs.length === 0 ? [] : [`- also referenced: ${pack.refs.join(", ")} (not read)`];
  const lines = [...names, ...paths, ...refs];
  return lines.length === 0 ? "The report names no code, path or file." : lines.join("\n");
}
