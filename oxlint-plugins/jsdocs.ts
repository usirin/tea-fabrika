// E6 (0023, 0120): every public export of a `next/` library has an Effect-shaped doc block, and its
// file a module block. Ticket 913, slice B2.1 of `docs/plan/effect-rules-big.md`.
//
// This file finds the blocks, through oxlint's syntax tree. Whether a block is right is Effect's own
// grammar, copied into `effect-jsdocs.ts`, so the shape cannot drift from Effect's by our hand.
// Which files are public is the config's: `.oxlintrc.json` turns the rule on for a folder list and
// off for the six kinds that are not public (`internal/`, tests, test support, shared suites,
// fixtures, declaration files).
//
// The one option, `since`: `absent` until libfabrika ships a version (0118), so a `@since` tag fires
// and its absence does not; `required` asks for it as Effect does. Nothing else changes with it.
//
// Which statements, at the top level of a file (the draft's edge cases 6 to 14):
// - `export const` (one block for `export const a = 1, b = 2`), `let`, `function`, `class`,
//   `interface` and `type` each need a block. Of overloads, only the first signature does.
// - `export * as Name from` needs a block, and each name in `export { a, b }`, with or without `from`,
//   its own, inside the braces. On these two, as in Effect, tags alone are enough.
// - `export declare namespace` needs a block, and so does each export inside it.
// - `export default`, `export * from`, `export =`, an enum (the type check refuses one) and a
//   statement with no `export` are not read.
// - Ours, the owner's answer of 2026-11-13: a type directly under its same-name schema, as
//   `export const Sent = ...` then `export type Sent = typeof Sent.Type;`, shares the schema's block
//   and needs none of its own. "Directly" means the statement right before it. A kept difference
//   from Effect's style, listed in 0023.
//
// Which comment is the block: the last `/** */` among the comments right before the node, so a `//`
// line between (an ignore comment, `@ts-expect-error`) is skipped, and of two blocks only the last
// counts. A block that holds `@internal` takes its export out.
//
// The module block (ours: Effect checks one only when there is one): a file with a checked export
// needs one. It is the first comment of the file, with only `//` lines above it, and it is a
// `/** */`. When the first statement is an import, that block is the module's. When it is anything
// else, an `export { a }` list or a plain statement included, one block above it is the statement's
// own, as TypeScript attaches it and Effect's checker reads it, and with two the first is the
// module's. So a file that opens with no import puts two blocks above its first statement. It needs
// `@stability` and takes no `@category`; its prose is not judged, as in Effect.
//
// A block on a member of an interface, a class or a type literal is optional. When there is one, it
// is judged with Effect's member tags (no `@category`; `@default` allowed). As in Effect, members are
// read only once their export's own block passes.
//
// One finding per export, at its first line, with every problem in the message, and one per file
// for the module block, at line 1 or at the block. `jsdocs.test.ts` holds the laws.
//
// What it cannot see: whether a description is true, whether a `@see {@link x}` names a real thing,
// whether an example compiles, and a name sent on under a new binding (`const b = a; export { b }`),
// which is asked for its block at `b`.
import type { Context, CreateRule, ESTree } from "@oxlint/plugins";
import {
  buildTags,
  type DocScope,
  type JSDocBlock,
  type JSDocDiagnostic,
  parseJSDocBlock,
  parseLooseJSDocBlock,
  parseModuleExamples,
} from "./effect-jsdocs.ts";

type Since = "absent" | "required";

type Node = ESTree.Node;

type Comment = ESTree.Comment;

/** What became of one export: its block holds `@internal`, it was reported, or it passed. */
type Verdict = "internal" | "reported" | "passed";

/** A doc block, the text oxlint gives as its value plus the two ends Effect's grammar reads. */
const raw = (comment: Comment): string => `/*${comment.value}*/`;

const isDoc = (comment: Comment): boolean => comment.type === "Block" && comment.value.startsWith("*");

const sinceOf = (options: ReadonlyArray<unknown>): Since => {
  const [given] = options;
  return typeof given === "object" && given !== null && "since" in given && given.since === "required"
    ? "required"
    : "absent";
};

/**
 * Effect's verdict on one block, with the one change `since: absent` makes: a `@since` tag fires, and
 * Effect's ask for one is dropped. `null` when the block holds `@internal`.
 */
const judge = (
  block: JSDocBlock,
  scope: DocScope,
  requireStability: boolean,
  since: Since,
): ReadonlyArray<string> | null => {
  if (block.internal) {
    return null;
  }

  const found: Array<JSDocDiagnostic> = [...block.diagnostics];

  if (block.parsed !== undefined) {
    const tags = buildTags(scope, block.parsed.tags, requireStability);

    if (tags._tag === "Failure") {
      found.push(...tags.error.diagnostics);
    }
  }

  return withSince(found, block, since);
};

const withSince = (found: ReadonlyArray<JSDocDiagnostic>, block: JSDocBlock, since: Since): ReadonlyArray<string> => {
  const kept =
    since === "required"
      ? found
      : found.filter((d) => d.code !== "invalid-since" && !(d.code === "missing-tag" && d.message.endsWith("@since")));
  const messages = kept.map((d) => d.message);

  if (since === "absent" && block.tags.some((tag) => tag.name === "since")) {
    messages.push("@since is not written until libfabrika's first release (0118)");
  }

  return [...new Set(messages)];
};

/** The block for a declaration, or for a re-export, where a block of tags alone is enough. */
const blockOf = (text: string, tagsAlone: boolean): JSDocBlock => {
  const block = parseJSDocBlock(text, [0, text.length]);

  if (!tagsAlone || block.internal) {
    return block;
  }

  // As Effect's checker: barrel re-exports may carry minimal, tag-only JSDoc.
  const loose = parseLooseJSDocBlock(text, [0, text.length]);

  return loose.tags[0]?.line === 0
    ? {
        ...loose,
        parsed: {
          description: { short: "", whenToUse: null, details: null, gotchas: null },
          examples: [],
          tags: loose.tags,
        },
      }
    : block;
};

const keyName = (key: Node, source: Context["sourceCode"]): string =>
  key.type === "Identifier" ? key.name : source.getText(key);

const bindingName = (id: Node, source: Context["sourceCode"]): string =>
  id.type === "Identifier" ? id.name : source.getText(id);

const exportedName = (name: Node): string =>
  name.type === "Identifier" ? name.name : name.type === "Literal" ? String(name.value) : "";

/** The type literals a type reaches, as Effect's `parseMembersFromTsType` walks them. */
const literalsIn = (type: Node | null | undefined): ReadonlyArray<ReadonlyArray<Node>> => {
  if (type == null) {
    return [];
  }

  switch (type.type) {
    case "TSTypeAnnotation":
      return literalsIn(type.typeAnnotation);
    case "TSTypeLiteral":
      return [type.members];
    case "TSUnionType":
    case "TSIntersectionType":
      return type.types.flatMap(literalsIn);
    case "TSParenthesizedType":
    case "TSTypeOperator":
      return literalsIn(type.typeAnnotation);
    case "TSArrayType":
      return literalsIn(type.elementType);
    case "TSConditionalType":
      return [type.checkType, type.extendsType, type.trueType, type.falseType].flatMap(literalsIn);
    case "TSTypeReference":
      return type.typeArguments?.params.flatMap(literalsIn) ?? [];
    case "TSMappedType":
      return literalsIn(type.typeAnnotation);
    default:
      return [];
  }
};

/** A member's own type, which Effect walks for nested members. */
const memberType = (member: Node): Node | null | undefined => {
  switch (member.type) {
    case "TSPropertySignature":
    case "PropertyDefinition":
    case "AccessorProperty":
    case "TSAbstractPropertyDefinition":
    case "TSAbstractAccessorProperty":
      return member.typeAnnotation;
    case "TSMethodSignature":
      return member.returnType;
    case "MethodDefinition":
    case "TSAbstractMethodDefinition":
      return member.value.returnType;
    default:
      return null;
  }
};

/** The members a declaration holds, as Effect's `parseDeclarationMembersTs` finds them. */
const membersOf = (declaration: Node): ReadonlyArray<ReadonlyArray<Node>> => {
  switch (declaration.type) {
    case "ClassDeclaration":
      return [declaration.body.body];
    case "TSInterfaceDeclaration":
      return [declaration.body.body];
    case "TSTypeAliasDeclaration":
      return literalsIn(declaration.typeAnnotation);
    case "VariableDeclaration":
      return declaration.declarations.flatMap((d) => literalsIn(d.id.typeAnnotation));
    case "FunctionDeclaration":
    case "TSDeclareFunction":
      return literalsIn(declaration.returnType);
    default:
      return [];
  }
};

/** Whether Effect reads a member: not a call, construct or index signature, a constructor or a static block. */
const isReadMember = (member: Node): boolean => {
  switch (member.type) {
    case "TSPropertySignature":
    case "TSMethodSignature":
    case "PropertyDefinition":
    case "AccessorProperty":
    case "TSAbstractPropertyDefinition":
    case "TSAbstractAccessorProperty":
    case "TSAbstractMethodDefinition":
      return true;
    case "MethodDefinition":
      return member.kind !== "constructor";
    default:
      return false;
  }
};

const nameOfMember = (member: Node, source: Context["sourceCode"]): string =>
  "key" in member && member.key != null && typeof member.key === "object" && "type" in member.key
    ? keyName(member.key, source)
    : "";

/** The name a top-level declaration exports, as a reader would say it. */
const declarationName = (declaration: Node, source: Context["sourceCode"]): string => {
  switch (declaration.type) {
    case "VariableDeclaration":
      return declaration.declarations.map((d) => bindingName(d.id, source)).join(", ");
    case "FunctionDeclaration":
    case "TSDeclareFunction":
    case "ClassDeclaration":
      return declaration.id === null ? "" : declaration.id.name;
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
      return declaration.id.name;
    case "TSModuleDeclaration":
      return declaration.id.type === "Identifier" ? declaration.id.name : source.getText(declaration.id);
    default:
      return "";
  }
};

const consts = (statement: Node | undefined): ReadonlySet<string> =>
  statement?.type === "ExportNamedDeclaration" &&
  statement.declaration?.type === "VariableDeclaration" &&
  statement.declaration.kind === "const"
    ? new Set(statement.declaration.declarations.flatMap((d) => (d.id.type === "Identifier" ? [d.id.name] : [])))
    : new Set();

export const jsdocs: CreateRule = {
  meta: {
    type: "suggestion",
    // oxlint refuses options for a rule that has no schema.
    schema: [
      {
        type: "object",
        properties: { since: { enum: ["absent", "required"] } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const source = context.sourceCode;
    const since = sinceOf(context.options);

    /** The last `/** *\/` right before a node, the block Effect's checker reads for it. */
    const docBefore = (node: Node): Comment | undefined => source.getCommentsBefore(node).findLast(isDoc);

    /** Every problem of these members, depth first, named. A member whose block fails is not entered. */
    const memberProblems = (lists: ReadonlyArray<ReadonlyArray<Node>>): ReadonlyArray<string> =>
      lists.flatMap((members) =>
        members.flatMap((member) => {
          if (!isReadMember(member)) {
            return [];
          }

          const doc = docBefore(member);

          if (doc === undefined) {
            return [];
          }

          const problems = judge(parseJSDocBlock(raw(doc), [0, raw(doc).length]), "member", false, since);

          if (problems === null) {
            return [];
          }

          const name = nameOfMember(member, source);
          const own = problems.map((p) => `member \`${name}\`: ${p}`);

          return problems.length > 0 ? own : memberProblems(literalsIn(memberType(member)));
        }),
      );

    /**
     * Judges one export, and reports it once when its block is missing or out of shape. `internal`
     * means its block holds `@internal`, so it is not checked.
     */
    const check = (
      node: Node,
      name: string,
      scope: DocScope,
      options: { readonly stability: boolean; readonly tagsAlone: boolean; readonly declaration?: Node },
    ): Verdict => {
      const doc = docBefore(node);

      if (doc === undefined) {
        context.report({
          node,
          message: `\`${name}\` has no doc block. A public export of a next/ library takes one, in Effect's shape: one description paragraph, then @stability and @category (E6, 0023).`,
        });
        return "reported";
      }

      const problems = judge(blockOf(raw(doc), options.tagsAlone), scope, options.stability, since);

      if (problems === null) {
        return "internal";
      }

      const all =
        problems.length === 0 && options.declaration !== undefined
          ? memberProblems(membersOf(options.declaration))
          : problems;

      if (all.length > 0) {
        context.report({
          node,
          message: `\`${name}\`'s doc block is out of Effect's shape (E6, 0023): ${all.join("; ")}.`,
        });
        return "reported";
      }

      return "passed";
    };

    /** A namespace and each export inside it, as Effect's `parseNamespaceTs` reads them. */
    const checkNamespace = (
      statement: Node,
      declaration: ESTree.TSModuleDeclaration | ESTree.TSGlobalDeclaration,
      top: boolean,
    ): Verdict => {
      const name = declarationName(declaration, source);
      const verdict = check(statement, name, "namespace", { stability: top, tagsAlone: false });

      if (verdict !== "passed" || declaration.body === null) {
        return verdict;
      }

      for (const inner of declaration.body.body) {
        if (inner.type !== "ExportNamedDeclaration" || inner.declaration === null) {
          continue;
        }

        const own = inner.declaration;

        if (own.type === "TSModuleDeclaration") {
          checkNamespace(inner, own, false);
        } else if (own.type !== "TSEnumDeclaration") {
          check(inner, `${name}.${declarationName(own, source)}`, "namespace-declaration", {
            stability: false,
            tagsAlone: false,
            declaration: own,
          });
        }
      }

      return verdict;
    };

    return {
      Program(program) {
        const overloads = new Set<string>();
        let checked = 0;

        program.body.forEach((statement, index) => {
          if (statement.type === "ExportAllDeclaration") {
            if (statement.exported !== null) {
              const named = check(statement, exportedName(statement.exported), "namespace", {
                stability: true,
                tagsAlone: true,
              });
              checked += named === "internal" ? 0 : 1;
            }

            return;
          }

          if (statement.type !== "ExportNamedDeclaration") {
            return;
          }

          const { declaration } = statement;

          if (declaration === null) {
            for (const specifier of statement.specifiers) {
              const named = check(specifier, exportedName(specifier.exported), "declaration", {
                stability: true,
                tagsAlone: true,
              });
              checked += named === "internal" ? 0 : 1;
            }

            return;
          }

          if (declaration.type === "TSEnumDeclaration" || declaration.type === "TSImportEqualsDeclaration") {
            return;
          }

          if (declaration.type === "TSModuleDeclaration") {
            if (declaration.id.type === "Identifier") {
              checked += checkNamespace(statement, declaration, true) === "internal" ? 0 : 1;
            }

            return;
          }

          const name = declarationName(declaration, source);

          if (declaration.type === "FunctionDeclaration" || declaration.type === "TSDeclareFunction") {
            if (overloads.has(name)) {
              return;
            }

            overloads.add(name);
          }

          if (
            declaration.type === "TSTypeAliasDeclaration" &&
            docBefore(statement) === undefined &&
            consts(program.body[index - 1]).has(name)
          ) {
            checked++;
            return;
          }

          const verdict = check(statement, name, "declaration", { stability: true, tagsAlone: false, declaration });
          checked += verdict === "internal" ? 0 : 1;
        });

        if (checked > 0) {
          checkModule(program);
        }
      },
    };

    /** The module block, as the draft's edge cases 19 to 23 say. */
    function checkModule(program: ESTree.Program) {
      const [first] = program.body;
      const leading = first === undefined ? program.comments : source.getCommentsBefore(first);
      const head = leading.find((comment) => comment.type !== "Line");
      const docs = leading.filter(isDoc);
      const own = first !== undefined && first.type !== "ImportDeclaration" && docs.length === 1;
      const block = head !== undefined && isDoc(head) && !own ? head : undefined;

      if (block === undefined) {
        context.report({
          loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
          message:
            "This file has no module block. A public file of a next/ library opens with one: a `/** */` with a description and @stability, above the imports (E6, 0023).",
        });
        return;
      }

      const loose = parseLooseJSDocBlock(raw(block), [0, raw(block).length]);

      if (loose.internal) {
        return;
      }

      const tags = buildTags("module", loose.tags, true);
      const found = [
        ...(tags._tag === "Failure" ? tags.error.diagnostics : []),
        ...parseModuleExamples(loose).diagnostics,
      ];
      const problems = withSince(found, loose, since);

      if (problems.length > 0) {
        context.report({
          node: block,
          message: `The module block is out of Effect's shape (E6, 0023): ${problems.join("; ")}.`,
        });
      }
    }
  },
};
