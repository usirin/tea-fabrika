// In next/, a running copy of fabrika is an instance, never a stage (0080). Today's version keeps
// its pipeline stages, so this rule reads only `next/` paths.
//
// What it reads: identifiers (escaped ones by their decoded name), string literals by their
// decoded value, template text, JSX text, comments and the file's path below `next/`. A word is a
// run of letters split at case changes, so `localStage`, `StageError`, `STAGE`, `P34_STAGE_DRIVER`
// and `stage-wire` hold the word, and `backstage` and `stagecoach` do not.
//
// Where it reports: on the node, and for template text and comments on each line that holds the
// word, so one `// oxlint-disable-next-line fabrika/no-stage-word -- <why>` allows one line. Of an
// ignore comment only the reason after `--` is read, so naming this rule does not fire it, and the
// reason says why without the word, since its own line is not the one it allows. A path is reported
// at the very start of the file, where no comment can silence it (`no-bare-disable.ts` says why).
//
// What it cannot see: JSON, Markdown and other files oxlint does not parse, a word built at run
// time (`"sta" + "ge"`), and a regular expression's pattern. No autofix: the rule cannot tell
// `dev` from `instance`, or move a saved name.
import type { Context, CreateRule, ESTree } from "@oxlint/plugins";
import { pathIn } from "./match.ts";

const START = { line: 1, column: 0 };
const MESSAGE = "Say instance for a running copy of fabrika in next/; stage was renamed (0080).";
const RUN = /\p{L}+/gu;
// `STAGEError` splits as `STAGE` and `Error`, `localStage` as `local` and `Stage`.
const PART = /\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|[^\p{Lu}\p{Ll}]+/gu;
// An ignore comment, up to its reason.
const DIRECTIVE = /^\s*(?:oxlint|eslint)-(?:disable|enable)[^]*?(?:--|$)/;

/** Where each stage word starts in the text, and its length. */
const stageWords = (text: string): ReadonlyArray<{ readonly index: number; readonly length: number }> => {
  const found: Array<{ readonly index: number; readonly length: number }> = [];

  for (const run of text.matchAll(RUN)) {
    for (const part of run[0].matchAll(PART)) {
      const word = part[0].toLowerCase();

      if (word === "stage" || word === "stages") {
        found.push({ index: run.index + part.index, length: part[0].length });
      }
    }
  }

  return found;
};

/** The path from the top of the repo, with `/` between folders on any platform. */
const relative = (context: Context): string => {
  const file = pathIn(context).replaceAll("\\", "/");
  const from = context.cwd.replaceAll("\\", "/").replace(/\/?$/, "/");
  return file.startsWith(from) ? file.slice(from.length) : file;
};

export const noStageWord: CreateRule = {
  create(context) {
    const file = relative(context);

    if (!file.startsWith("next/")) {
      return {};
    }

    const source = context.sourceCode;
    const named = (node: ESTree.Node, text: string) => {
      if (stageWords(text).length > 0) {
        context.report({ node, message: MESSAGE });
      }
    };
    // Raw text at a source offset: one report per line that holds the word.
    const lines = (node: ESTree.Node, decoded: string, raw: string, offset: number) => {
      if (stageWords(decoded).length === 0) {
        return;
      }

      const words = stageWords(raw);

      if (words.length === 0) {
        // Only an escape spells it, so the raw text cannot place it.
        context.report({ node, message: MESSAGE });
        return;
      }

      const seen = new Set<number>();

      for (const word of words) {
        const start = source.getLocFromIndex(offset + word.index);

        if (!seen.has(start.line)) {
          seen.add(start.line);
          context.report({
            loc: { start, end: source.getLocFromIndex(offset + word.index + word.length) },
            message: MESSAGE,
          });
        }
      }
    };

    return {
      Program(node) {
        if (stageWords(file.slice("next/".length)).length > 0) {
          context.report({
            loc: { start: START, end: START },
            message: `This file's path names stage: ${file}. ${MESSAGE}`,
          });
        }

        for (const comment of source.getAllComments()) {
          // The comment's text starts after its `//` or `/*`.
          const skip = DIRECTIVE.exec(comment.value)?.[0].length ?? 0;
          const text = comment.value.slice(skip);
          lines(node, text, text, comment.range[0] + 2 + skip);
        }
      },
      Identifier: (node) => named(node, node.name),
      PrivateIdentifier: (node) => named(node, node.name),
      JSXIdentifier: (node) => named(node, node.name),
      Literal(node) {
        if (typeof node.value === "string") {
          named(node, node.value);
        }
      },
      TemplateElement(node) {
        // Its range starts at the backtick or `}` before the text, so the text is found from there.
        const { raw } = node.value;
        lines(node, node.value.cooked ?? raw, raw, source.text.indexOf(raw, node.range[0]));
      },
      JSXText(node) {
        // The parser may leave `raw` out; the source between the node's ends is the same text.
        const raw = node.raw ?? source.text.slice(node.range[0], node.range[1]);
        lines(node, node.value, raw, node.range[0]);
      },
    };
  },
};
