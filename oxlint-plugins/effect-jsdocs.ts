// Effect's own block grammar, copied, not written: what makes one doc block right (E6, 0023).
//
// Source: Effect-TS/effect, packages/tools/jsdocs/src/Jsdocs.ts, at the tag effect@4.1.2.
// - Lines 973 to 1608, unchanged in what they do: parseLooseJSDocBlock, parseJSDocBlock,
//   trimStructuralBlankLines, parseTags, parseCoreJSDoc, uniqueDiagnostics, the section and example
//   grammar, parseModuleExamples, joinBody, the heading tests, parseSeeTag, extractParsedInlineLinks
//   and buildTags.
// - What those lines call, from the same file: the types at lines 15 to 178 and 429 to 449,
//   `tagOrder` (480 to 487), `stableSemverRegex` (491), `diagnostic` (494 to 496) and
//   `isInlineLinkStart` (1670 to 1674).
// - Left out: lines 962 to 972, `parseJSDoc`, a public wrapper our rule does not call; and every
//   line that finds exports or resolves links with TypeScript's API, which `jsdocs.ts` does instead
//   with oxlint's syntax tree.
//
// What changed here, and only this:
// - `pnpm format` wrote oxfmt's layout: semicolons, braces on every `if`, blank lines between
//   statements, and the line width.
// - The types lost their `export` and their own doc blocks, and seven names gained an `export` for
//   `jsdocs.ts`: `DocScope`, `JSDocDiagnostic`, `JSDocBlock`, `parseLooseJSDocBlock`,
//   `parseJSDocBlock`, `parseModuleExamples` and `buildTags`.
// - Twenty reads by index that our `noUncheckedIndexedAccess` cannot prove in range read `?? ""`:
//   `lines[index]` (14), `lines[headingIndex]` (3) and a regex group, `match[1]` (3). Each index is
//   in range where Effect reads it, so the value is the same at runtime.
// `@since` stays as Effect asks it: `jsdocs.ts` drops that one ask while libfabrika has no release
// (0118). On an Effect bump, diff these lines again.
//
// MIT License
//
// Copyright (c) 2023 Effectful Technologies Inc
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

export type DocScope = "module" | "declaration" | "namespace" | "namespace-declaration" | "member";

type Result<A, E> = { readonly _tag: "Success"; readonly value: A } | { readonly _tag: "Failure"; readonly error: E };

export interface JSDocDiagnostic {
  readonly code: string;
  readonly message: string;
}

interface JSDocParseError {
  readonly diagnostics: ReadonlyArray<JSDocDiagnostic>;
}

interface ParsedSeeTag {
  readonly text: string;
  readonly links: ReadonlyArray<ParsedInlineLink>;
}

interface ParsedInlineLinkSymbol {
  readonly file: string;
  readonly range: readonly [number, number];
}

interface ParsedInlineLink {
  readonly raw: string;
  readonly target: string;
  readonly text: string | null;
  readonly range?: readonly [number, number];
  readonly symbol?: ParsedInlineLinkSymbol;
}

interface ParsedDescription {
  readonly short: string;
  readonly whenToUse: string | null;
  readonly details: string | null;
  readonly gotchas: string | null;
}

interface ParsedExample {
  readonly title: string;
  readonly body: string | null;
  readonly code: string;
}

type JSDocStability = "stable" | "unstable" | "experimental";

interface ParsedModuleTags {
  readonly since: string;
  readonly stability: JSDocStability;
  readonly deprecated: string | null;
  readonly see: ReadonlyArray<ParsedSeeTag>;
}

interface ParsedDeclarationTags {
  readonly category: string;
  readonly since: string;
  readonly stability: JSDocStability;
  readonly deprecated: string | null;
  readonly see: ReadonlyArray<ParsedSeeTag>;
}

interface ParsedNamespaceTags {
  readonly category: string | null;
  readonly since: string;
  readonly stability: JSDocStability;
  readonly deprecated: string | null;
  readonly see: ReadonlyArray<ParsedSeeTag>;
}

interface ParsedMemberTags {
  readonly since: string | null;
  readonly stability: JSDocStability;
  readonly default: string | null;
  readonly deprecated: string | null;
  readonly see: ReadonlyArray<ParsedSeeTag>;
}

interface JSDocTag {
  readonly name: string;
  value: string;
  readonly line: number;
}

export interface JSDocBlock {
  readonly range: [number, number];
  readonly raw: string;
  readonly lines: Array<string>;
  readonly tags: Array<JSDocTag>;
  readonly parsed?: ParsedCoreJSDoc;
  readonly diagnostics: Array<JSDocDiagnostic>;
  readonly internal: boolean;
}

interface ParsedCoreJSDoc {
  readonly description: ParsedDescription;
  readonly examples: ReadonlyArray<ParsedExample>;
  readonly tags: ReadonlyArray<JSDocTag>;
}

const tagOrder = new Map([
  ["deprecated", 0],
  ["default", 1],
  ["see", 2],
  ["stability", 3],
  ["category", 4],
  ["since", 5],
]);

const stableSemverRegex = /^\d+\.\d+\.\d+$/;

function diagnostic(code: string, message: string): JSDocDiagnostic {
  return { code, message };
}

function isInlineLinkStart(source: string, index: number): boolean {
  if (!source.startsWith("{@link", index)) {
    return false;
  }

  const next = source[index + "{@link".length];
  return next === undefined || /\s|}/.test(next);
}

export function parseLooseJSDocBlock(raw: string, range: [number, number]): JSDocBlock {
  const body = raw.replace(/^\/\*\*/, "").replace(/\*\/$/, "");
  const rawLines = body.split(/\r\n|\r|\n/);
  const lines = rawLines.map((line) => line.replace(/^\s*\* ?/, "").trimEnd());
  const normalized = trimStructuralBlankLines(lines);
  const tags = parseTags(normalized);
  const internal = tags.some((tag) => tag.name === "internal");
  return { range, raw, lines: normalized, tags, diagnostics: [], internal };
}

export function parseJSDocBlock(raw: string, range: [number, number]): JSDocBlock {
  const base = parseLooseJSDocBlock(raw, range);
  const { lines: normalized, tags, internal } = base;

  if (internal) {
    return base;
  }

  const result = parseCoreJSDoc(normalized, tags);
  const block: JSDocBlock = {
    ...base,
    range,
    raw,
    lines: normalized,
    tags,
    diagnostics: result._tag === "Failure" ? Array.from(result.error.diagnostics) : [],
    internal,
  };
  return result._tag === "Success" ? { ...block, parsed: result.value } : block;
}

function trimStructuralBlankLines(lines: Array<string>): Array<string> {
  let start = 0;
  let end = lines.length;

  if (lines[start]?.trim() === "") {
    start++;
  }

  if (end > start && lines[end - 1]?.trim() === "") {
    end--;
  }

  return lines.slice(start, end);
}

function parseTags(lines: Array<string>): Array<JSDocTag> {
  const tags: Array<JSDocTag> = [];
  let current: JSDocTag | undefined;
  let inFence = false;

  for (let index = 0; index < lines.length; index++) {
    const trimmed = (lines[index] ?? "").trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      current = undefined;
      continue;
    }

    if (inFence) {
      continue;
    }

    const match = /^@([A-Za-z][\w-]*)(?:\s+(.*))?$/.exec(trimmed);

    if (match) {
      current = { name: match[1] ?? "", value: match[2]?.trim() ?? "", line: index };
      tags.push(current);
      continue;
    }

    if (current !== undefined && trimmed !== "") {
      current.value = current.value === "" ? trimmed : `${current.value}\n${trimmed}`;
    } else if (trimmed === "") {
      current = undefined;
    }
  }

  return tags;
}

function parseCoreJSDoc(lines: Array<string>, tags: Array<JSDocTag>): Result<ParsedCoreJSDoc, JSDocParseError> {
  const diagnostics: Array<JSDocDiagnostic> = [];
  const firstTagLine = tags[0]?.line ?? lines.length;
  const content = lines.slice(0, firstTagLine);

  if (lines.length === 0) {
    diagnostics.push(diagnostic("missing-description", "JSDoc must include a short description"));
  }

  if (content.at(-1)?.trim() === "" && tags.length > 0) {
    // exactly one blank before tags is validated by ensuring the last content line is blank and the previous is not blank
    if (content.length < 2 || content[content.length - 2]?.trim() === "") {
      diagnostics.push(
        diagnostic(
          "invalid-spacing",
          "JSDoc tags must be separated from description content by exactly one blank line",
        ),
      );
    }
  } else if (tags.length > 0 && content.length > 0) {
    diagnostics.push(
      diagnostic("invalid-spacing", "JSDoc tags must be separated from description content by exactly one blank line"),
    );
  }

  if (content[0]?.trim() === "") {
    diagnostics.push(diagnostic("leading-blank", "JSDoc must not start with a blank line"));
  }

  const contentWithoutTagBlank = tags.length > 0 && content.at(-1)?.trim() === "" ? content.slice(0, -1) : content;

  if (contentWithoutTagBlank.at(-1)?.trim() === "") {
    diagnostics.push(diagnostic("trailing-blank", "JSDoc description must not end with a blank line"));
  }

  const parsedContent = parseDescriptionContent(contentWithoutTagBlank);
  diagnostics.push(...parsedContent.diagnostics);

  if (diagnostics.length > 0 || parsedContent.value === undefined) {
    return { _tag: "Failure", error: { diagnostics: uniqueDiagnostics(diagnostics) } };
  }

  return {
    _tag: "Success",
    value: {
      description: parsedContent.value.description,
      examples: parsedContent.value.examples,
      tags,
    },
  };
}

function uniqueDiagnostics(diagnostics: ReadonlyArray<JSDocDiagnostic>): ReadonlyArray<JSDocDiagnostic> {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    const key = `${item.code}:${item.message}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

const standardHeadings = ["**When to use**", "**Details**", "**Gotchas**"] as const;

type StandardHeading = (typeof standardHeadings)[number];

const whenToUsePrefixes = ["Use to", "Use when", "Use as", "Use with"] as const;

interface ParsedContentResult {
  readonly value?: {
    readonly description: ParsedDescription;
    readonly examples: ReadonlyArray<ParsedExample>;
  };
  readonly diagnostics: ReadonlyArray<JSDocDiagnostic>;
}

function parseDescriptionContent(lines: Array<string>): ParsedContentResult {
  const diagnostics: Array<JSDocDiagnostic> = [];
  const sections: Record<StandardHeading, string | null> = {
    "**When to use**": null,
    "**Details**": null,
    "**Gotchas**": null,
  };
  const examples: Array<ParsedExample> = [];
  const exampleTitles = new Set<string>();
  let index = 0;
  let currentSectionOrder = -1;
  let examplesStarted = false;

  while (index < lines.length && (lines[index] ?? "").trim() !== "" && !isHeadingLine(lines[index])) {
    if (isForbiddenMarkdownHeading(lines[index] ?? "", false)) {
      diagnostics.push(diagnostic("invalid-heading", "Markdown headings are not allowed in JSDoc descriptions"));
    }

    index++;
  }

  const shortLines = lines.slice(0, index);

  if (shortLines.length === 0 || joinBody(shortLines).trim() === "") {
    diagnostics.push(diagnostic("missing-description", "JSDoc must include a short description"));
  }

  if (index < lines.length && (lines[index] ?? "").trim() === "") {
    const next = lines[index + 1];

    if (next !== undefined && !isHeadingLine(next)) {
      diagnostics.push(diagnostic("multiple-description-paragraphs", "JSDoc short description must be one paragraph"));
    }
  }

  while (index < lines.length) {
    if ((lines[index] ?? "").trim() !== "") {
      diagnostics.push(diagnostic("invalid-spacing", "JSDoc sections must be separated by exactly one blank line"));
      break;
    }

    if (lines[index + 1]?.trim() === "") {
      diagnostics.push(diagnostic("invalid-spacing", "JSDoc sections must be separated by exactly one blank line"));

      while (lines[index + 1]?.trim() === "") {
        index++;
      }
    }

    index++;

    if (index >= lines.length) {
      break;
    }

    const line = (lines[index] ?? "").trim();

    if (line.startsWith("**Example**")) {
      examplesStarted = true;
      const parsed = parseExample(lines, index);
      diagnostics.push(...parsed.diagnostics);

      if (parsed.example !== undefined) {
        const key = parsed.example.title.trim().toLowerCase();

        if (exampleTitles.has(key)) {
          diagnostics.push(diagnostic("duplicate-example", `Duplicate example title: ${parsed.example.title.trim()}`));
        }

        exampleTitles.add(key);
        examples.push(parsed.example);
      }

      index = parsed.nextIndex;
      continue;
    }

    const heading = standardHeadings.find((candidate) => candidate === line);

    if (heading !== undefined) {
      if (examplesStarted) {
        diagnostics.push(diagnostic("section-after-example", `${heading} must appear before examples`));
      }

      const order = standardHeadings.indexOf(heading);

      if (order <= currentSectionOrder) {
        diagnostics.push(diagnostic("section-out-of-order", `${heading} is out of order or duplicated`));
      }

      currentSectionOrder = Math.max(currentSectionOrder, order);

      if (sections[heading] !== null) {
        diagnostics.push(diagnostic("duplicate-section", `${heading} may appear at most once`));
      }

      const parsed = parseSection(lines, index);
      diagnostics.push(...parsed.diagnostics);
      sections[heading] = parsed.body;
      index = parsed.nextIndex;
      continue;
    }

    if (isNearMissHeading(line)) {
      diagnostics.push(diagnostic("invalid-heading", `Invalid JSDoc section heading: ${line}`));
      index++;
      continue;
    }

    if (isBoldOnlyLine(line)) {
      diagnostics.push(diagnostic("unknown-heading", `Unknown JSDoc section heading: ${line}`));
      index++;
      continue;
    }

    if (isForbiddenMarkdownHeading(line, false)) {
      diagnostics.push(diagnostic("invalid-heading", "Markdown headings are not allowed in JSDoc descriptions"));
      index++;
      continue;
    }

    diagnostics.push(
      diagnostic("invalid-description", "JSDoc description content must appear under a standard section heading"),
    );
    index++;
  }

  const whenToUse = sections["**When to use**"];

  if (whenToUse !== null && !hasWhenToUsePrefix(whenToUse)) {
    diagnostics.push(
      diagnostic(
        "when-to-use-format",
        `**When to use** must start with one of: ${whenToUsePrefixes.map((prefix) => `\`${prefix}\``).join(", ")}`,
      ),
    );
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  return {
    value: {
      description: {
        short: joinBody(shortLines),
        whenToUse: sections["**When to use**"],
        details: sections["**Details**"],
        gotchas: sections["**Gotchas**"],
      },
      examples,
    },
    diagnostics,
  };
}

function hasWhenToUsePrefix(text: string): boolean {
  const trimmed = text.trimStart();
  return whenToUsePrefixes.some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `));
}

function parseSection(
  lines: Array<string>,
  headingIndex: number,
): {
  readonly body: string | null;
  readonly nextIndex: number;
  readonly diagnostics: ReadonlyArray<JSDocDiagnostic>;
} {
  const diagnostics: Array<JSDocDiagnostic> = [];

  if (lines[headingIndex + 1]?.trim() !== "") {
    diagnostics.push(
      diagnostic("invalid-spacing", `${(lines[headingIndex] ?? "").trim()} must be followed by exactly one blank line`),
    );
  }

  let index = headingIndex + 2;
  const bodyStart = index;
  let inFence = false;

  while (index < lines.length) {
    const trimmed = (lines[index] ?? "").trim();

    if (trimmed.startsWith("```")) {
      if (isTypeScriptFence(trimmed)) {
        diagnostics.push(diagnostic("loose-ts-fence", "TypeScript examples must use **Example** (Title) sections"));
      }

      inFence = !inFence;
    }

    if (!inFence && trimmed === "" && isHeadingLine(lines[index + 1])) {
      break;
    }

    if (!inFence && trimmed !== "" && isForbiddenMarkdownHeading(trimmed, false)) {
      diagnostics.push(diagnostic("invalid-heading", "Markdown headings are not allowed in JSDoc descriptions"));
    }

    if (
      !inFence &&
      isBoldOnlyLine(trimmed) &&
      !standardHeadings.includes(trimmed as StandardHeading) &&
      !trimmed.startsWith("**Example**")
    ) {
      diagnostics.push(diagnostic("unknown-heading", `Unknown JSDoc section heading: ${trimmed}`));
    }

    index++;
  }

  const bodyLines = lines.slice(bodyStart, index);

  if (joinBody(bodyLines).trim() === "") {
    diagnostics.push(diagnostic("empty-section", `${(lines[headingIndex] ?? "").trim()} must have a non-empty body`));
  }

  if (bodyLines.at(-1)?.trim() === "") {
    diagnostics.push(diagnostic("invalid-spacing", "Section bodies must not end with extra blank lines"));
  }

  return { body: joinBody(bodyLines), nextIndex: index, diagnostics };
}

const isTypeScriptFence = (line: string): boolean => /^```ts(?:\s.*)?$/.test(line);

function parseExample(
  lines: Array<string>,
  headingIndex: number,
): {
  readonly example?: ParsedExample;
  readonly nextIndex: number;
  readonly diagnostics: ReadonlyArray<JSDocDiagnostic>;
} {
  const diagnostics: Array<JSDocDiagnostic> = [];
  const heading = (lines[headingIndex] ?? "").trim();
  const match = /^\*\*Example\*\* \((.+)\)$/.exec(heading);

  if (!match || (match[1] ?? "").trim() === "") {
    diagnostics.push(diagnostic("malformed-example", "TypeScript examples must use **Example** (Title)"));
  }

  if (lines[headingIndex + 1]?.trim() !== "") {
    diagnostics.push(diagnostic("invalid-spacing", "Example headings must be followed by exactly one blank line"));
  }

  let index = headingIndex + 2;
  const bodyStart = index;
  let fenceIndex = -1;

  while (index < lines.length) {
    const trimmed = (lines[index] ?? "").trim();

    if (isTypeScriptFence(trimmed)) {
      fenceIndex = index;
      break;
    }

    if (trimmed.startsWith("```")) {
      diagnostics.push(diagnostic("malformed-example", "Examples may only contain one TypeScript code fence"));
    }

    if (trimmed === "" && isHeadingLine(lines[index + 1])) {
      break;
    }

    if (trimmed.startsWith("@")) {
      break;
    }

    index++;
  }

  if (fenceIndex === -1) {
    diagnostics.push(diagnostic("malformed-example", "Examples must include a non-empty ```ts fence"));
    return { nextIndex: index, diagnostics };
  }

  const bodyLines = lines.slice(bodyStart, fenceIndex);
  const nonEmptyBody = joinBody(bodyLines).trim() !== "";

  if (nonEmptyBody && bodyLines.at(-1)?.trim() !== "") {
    diagnostics.push(
      diagnostic("invalid-spacing", "Example prose must be separated from code by exactly one blank line"),
    );
  }

  const prose = nonEmptyBody ? joinBody(bodyLines.slice(0, bodyLines.at(-1)?.trim() === "" ? -1 : undefined)) : null;

  index = fenceIndex + 1;
  const codeStart = index;

  while (index < lines.length && (lines[index] ?? "").trim() !== "```") {
    if (isTypeScriptFence((lines[index] ?? "").trim())) {
      diagnostics.push(diagnostic("malformed-example", "Examples must contain exactly one TypeScript code fence"));
    }

    index++;
  }

  const codeLines = lines.slice(codeStart, index);

  if (index >= lines.length) {
    diagnostics.push(diagnostic("malformed-example", "Examples must close the TypeScript code fence"));
  }

  if (joinBody(codeLines).trim() === "") {
    diagnostics.push(diagnostic("malformed-example", "Examples must include non-empty TypeScript code"));
  }

  index++;

  if (index < lines.length && (lines[index] ?? "").trim() !== "" && !(lines[index] ?? "").trim().startsWith("@")) {
    diagnostics.push(
      diagnostic("invalid-spacing", "Examples must be separated from following content by exactly one blank line"),
    );
  }

  const result = { nextIndex: index, diagnostics };
  return match
    ? { ...result, example: { title: (match[1] ?? "").trim(), body: prose, code: joinBody(codeLines) } }
    : result;
}

export function parseModuleExamples(block: JSDocBlock): {
  readonly examples: ReadonlyArray<ParsedExample>;
  readonly diagnostics: ReadonlyArray<JSDocDiagnostic>;
} {
  const diagnostics: Array<JSDocDiagnostic> = [];
  const examples: Array<ParsedExample> = [];
  const exampleTitles = new Set<string>();
  const firstTagLine = block.tags[0]?.line ?? block.lines.length;
  const lines = block.lines.slice(0, firstTagLine);
  let index = 0;

  while (index < lines.length) {
    const trimmed = (lines[index] ?? "").trim();

    if (trimmed.startsWith("**Example**")) {
      const parsed = parseExample(lines, index);
      diagnostics.push(...parsed.diagnostics);

      if (parsed.example !== undefined) {
        const key = parsed.example.title.trim().toLowerCase();

        if (exampleTitles.has(key)) {
          diagnostics.push(diagnostic("duplicate-example", `Duplicate example title: ${parsed.example.title.trim()}`));
        }

        exampleTitles.add(key);
        examples.push(parsed.example);
      }

      index = Math.max(parsed.nextIndex, index + 1);
      continue;
    }

    if (trimmed.startsWith("```")) {
      diagnostics.push(
        diagnostic("loose-ts-fence", "Code fences in module JSDoc must use **Example** (Title) sections"),
      );
      index++;

      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        index++;
      }

      if (index < lines.length) {
        index++;
      }

      continue;
    }

    index++;
  }

  return { examples, diagnostics };
}

function joinBody(lines: ReadonlyArray<string>): string {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.trim() === "") {
    start++;
  }

  while (end > start && lines[end - 1]?.trim() === "") {
    end--;
  }

  return lines.slice(start, end).join("\n");
}

function isHeadingLine(line: string | undefined): boolean {
  if (line === undefined) {
    return false;
  }

  const trimmed = line.trim();
  return (
    standardHeadings.includes(trimmed as StandardHeading) ||
    trimmed.startsWith("**Example**") ||
    isNearMissHeading(trimmed) ||
    isBoldOnlyLine(trimmed) ||
    isForbiddenMarkdownHeading(trimmed, false)
  );
}

function isNearMissHeading(line: string): boolean {
  return (
    /^\*\*(When to use|When To Use|Details|Gotchas).*\*\*/.test(line) &&
    !standardHeadings.includes(line as StandardHeading)
  );
}

function isBoldOnlyLine(line: string): boolean {
  return /^\*\*[^*]+\*\*(?:\s*)$/.test(line);
}

function isForbiddenMarkdownHeading(line: string, inFence: boolean): boolean {
  return !inFence && /^#{1,6}\s+/.test(line.trim());
}

function parseSeeTag(value: string): ParsedSeeTag {
  return { text: value, links: extractParsedInlineLinks(value) };
}

function extractParsedInlineLinks(source: string): ReadonlyArray<ParsedInlineLink> {
  const links: Array<ParsedInlineLink> = [];
  let index = source.indexOf("{@link");

  while (index !== -1) {
    if (!isInlineLinkStart(source, index)) {
      index = source.indexOf("{@link", index + 1);
      continue;
    }

    const end = source.indexOf("}", index + "{@link".length);

    if (end === -1) {
      break;
    }

    const raw = source.slice(index, end + 1);
    const content = raw.slice("{@link".length, -1).trim();
    const pipeIndex = content.indexOf("|");
    const beforeLabel = pipeIndex === -1 ? content : content.slice(0, pipeIndex).trim();
    const target = beforeLabel.split(/\s+/)[0] ?? "";
    const text =
      pipeIndex === -1 ? beforeLabel.slice(target.length).trim() || null : content.slice(pipeIndex + 1).trim() || null;
    links.push({ raw, target, text });
    index = source.indexOf("{@link", end + 1);
  }

  return links;
}

export function buildTags(
  scope: DocScope,
  tags: ReadonlyArray<JSDocTag>,
  requireStability = false,
): Result<ParsedModuleTags | ParsedDeclarationTags | ParsedNamespaceTags | ParsedMemberTags, JSDocParseError> {
  const diagnostics: Array<JSDocDiagnostic> = [];
  const allowed =
    scope === "declaration"
      ? new Set(["deprecated", "see", "stability", "category", "since"])
      : scope === "member"
        ? new Set(["deprecated", "default", "see", "stability", "since"])
        : scope === "module"
          ? new Set(["deprecated", "see", "stability", "since"])
          : new Set(["deprecated", "see", "stability", "category", "since"]);
  let previousOrder = -1;
  const values = new Map<string, Array<string>>();

  for (const tag of tags) {
    if (tag.name === "internal") {
      continue;
    }

    if (tag.name === "example") {
      diagnostics.push(
        diagnostic("forbidden-tag", "@example is not allowed; use a canonical **Example** (Title) section"),
      );
      continue;
    }

    if (!allowed.has(tag.name)) {
      diagnostics.push(
        diagnostic(
          "forbidden-tag",
          `@${tag.name} is not allowed in ${scope === "namespace-declaration" ? "namespace" : scope} JSDoc`,
        ),
      );
      continue;
    }

    const order = tagOrder.get(tag.name) ?? previousOrder;

    if (order < previousOrder) {
      diagnostics.push(diagnostic("tag-out-of-order", `@${tag.name} is out of order in JSDoc`));
    }

    previousOrder = Math.max(previousOrder, order);
    values.set(tag.name, [...(values.get(tag.name) ?? []), tag.value.trim()]);
  }

  const singletonTags =
    scope === "member"
      ? ["deprecated", "default", "stability", "since"]
      : ["deprecated", "stability", "category", "since"];

  for (const tag of singletonTags) {
    if ((values.get(tag)?.length ?? 0) > 1) {
      diagnostics.push(diagnostic("duplicate-tag", `JSDoc blocks may contain at most one @${tag} tag`));
    }
  }

  const see = values.get("see") ?? [];

  for (const value of see) {
    if (value === "") {
      diagnostics.push(diagnostic("empty-tag", "@see must include a value"));
    }
  }

  const deprecated = values.get("deprecated")?.[0] ?? null;
  const stability = values.get("stability")?.[0];

  if (stability !== undefined && stability !== "stable" && stability !== "unstable" && stability !== "experimental") {
    diagnostics.push(
      diagnostic("invalid-stability", "@stability must have the value stable, unstable, or experimental"),
    );
  }

  if (requireStability && stability === undefined) {
    diagnostics.push(
      diagnostic(
        "missing-tag",
        scope === "module" ? "Module JSDoc must include @stability" : "Public JSDoc must include @stability",
      ),
    );
  }

  const resolvedStability: JSDocStability =
    stability === "unstable" || stability === "experimental" ? stability : "stable";

  if (deprecated === "") {
    diagnostics.push(diagnostic("empty-tag", "@deprecated must include a message"));
  }

  const since = values.get("since")?.[0] ?? null;

  if ((scope === "declaration" || scope === "namespace" || scope === "namespace-declaration") && since === null) {
    diagnostics.push(
      diagnostic(
        "missing-tag",
        scope === "declaration" ? "Public JSDoc must include @since" : "Namespace JSDoc must include @since",
      ),
    );
  }

  if (scope === "module" && since === null) {
    diagnostics.push(diagnostic("missing-tag", "Module JSDoc must include @since"));
  }

  if (since !== null && !stableSemverRegex.test(since)) {
    diagnostics.push(diagnostic("invalid-since", "@since must be a stable semver version like 1.2.3"));
  }

  if (scope === "declaration") {
    const category = values.get("category")?.[0] ?? null;

    if (category === null) {
      diagnostics.push(diagnostic("missing-tag", "Public JSDoc must include @category"));
    }

    if (category === "") {
      diagnostics.push(diagnostic("empty-tag", "@category must include a value"));
    }

    if (diagnostics.length > 0 || category === null || since === null) {
      return { _tag: "Failure", error: { diagnostics } };
    }

    return {
      _tag: "Success",
      value: { category, since, stability: resolvedStability, deprecated, see: see.map(parseSeeTag) },
    };
  }

  if (scope === "member") {
    const defaultValue = values.get("default")?.[0] ?? null;

    if (defaultValue === "") {
      diagnostics.push(diagnostic("empty-tag", "@default must include a value"));
    }

    if (diagnostics.length > 0) {
      return { _tag: "Failure", error: { diagnostics } };
    }

    return {
      _tag: "Success",
      value: { since, stability: resolvedStability, default: defaultValue, deprecated, see: see.map(parseSeeTag) },
    };
  }

  if (scope === "module") {
    if (diagnostics.length > 0 || since === null) {
      return { _tag: "Failure", error: { diagnostics } };
    }

    return { _tag: "Success", value: { since, stability: resolvedStability, deprecated, see: see.map(parseSeeTag) } };
  }

  const category = values.get("category")?.[0] ?? null;

  if (category === "") {
    diagnostics.push(diagnostic("empty-tag", "@category must include a value"));
  }

  if (diagnostics.length > 0 || since === null) {
    return { _tag: "Failure", error: { diagnostics } };
  }

  return {
    _tag: "Success",
    value: { category, since, stability: resolvedStability, deprecated, see: see.map(parseSeeTag) },
  };
}
