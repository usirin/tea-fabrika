// Ticket 477, next/. Decision 0043: a folder in libfabrika's `src/` is a room, one subject.
//
// Four laws, the ones no existing rule says (decision 0040). Two more laws of a room are oxlint's
// own, set in `.oxlintrc.json`: `eslint/no-restricted-imports` refuses another room's `internal/`,
// and `unicorn/filename-case` holds a front file to PascalCase and an `internal/` file to camelCase.
//
// The lists come from the config, since they change as the files move:
//   src      the folder the rule reads, from the top of the repo. Outside it the rule says nothing.
//   rooms    the folders that are rooms.
//   folders  the other folders `src/` may hold: the platform folders, and an old folder until the
//            pull request that empties it.
//   files    the top files `src/` may hold, by stem: `Id` takes `Id.ts`, `Id.test.ts` and
//            `Id.test-support.ts`.
//   values   the top files, by stem, that hold values only.
// With no options the rule says nothing.
//
// 1. No room file re-exports another room's names. A room file is any file under a room, its
//    `internal/` and its tests included. Refused, where the source is a relative path into another
//    room: `export {a} from`, `export type {A} from`, `export * from`, `export * as a from`, and a
//    name imported from another room then sent on as `export {a}` or `export default a`.
//    Edge cases:
//    - an import alone passes: who may import whom is the floors' business (`pnpm lint:layers`);
//    - the room's own names pass, from `./Own.ts` or from its `internal/`;
//    - the entry file and the platform folders are not rooms, so they may put the rooms together;
//    - a top file's name (`../Rev.ts`) is no room's, so it passes;
//    - a package specifier (`@kampus/libfabrika/...`) is not read: only relative paths are;
//    - a name given a new binding first (`const b = a; export {b}`) is not followed;
//    - an import three folders deep into another room's `internal/` (`../../../x/internal/`) is
//      reached by no pattern of the `.oxlintrc.json` group, whose longest is `./../../*/internal/**`,
//      and has no plant: the pull request that first adds a folder inside an `internal/` adds both.
// 2. `src/` holds only the listed rooms, folders and top files. A name in another case is another
//    name: `Ledger/` is not `ledger/`. It reports at the start of the file.
// 3. Every export in a room's `internal/` file is `@internal`: the last `/** */` comment before the
//    export statement holds the tag. Any folder named `internal` under a room counts, at any depth.
//    Edge cases:
//    - a `//` comment or a `/* */` comment is not a doc comment, so its `@internal` does not count;
//    - a doc comment with no tag does not count;
//    - `export {a} from` and `export *` need the tag too;
//    - a declaration with no `export` needs none.
// 4. The shared top files hold values only: no service and no error. Refused at the top level of the
//    file, exported or not: a class that extends `Error` or any name ending in `Error`
//    (`Schema.TaggedError<A>()("A", {})`, `Data.TaggedError("A")`), a class that extends
//    `Context.Service` or `Context.Reference`, and a `const` made by a call to one of those.
//    Edge cases:
//    - the names are read as written, at the root of the call chain, so `Schema as S` and
//      `import * as Context from "effect/Context"` are seen, and so is a helper of ours with the
//      same last name;
//    - `Schema.Class`, a branded schema, a function, a type and an interface pass;
//    - an error or service made by a helper under another name is not seen.
//
// `rooms.test.ts` plants each of these at its real path, with the repo's own config.
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { pathIn } from "./match.ts";

interface Lists {
  readonly src: string;
  readonly rooms: ReadonlySet<string>;
  readonly folders: ReadonlySet<string>;
  readonly files: ReadonlySet<string>;
  readonly values: ReadonlySet<string>;
}

const START = { line: 1, column: 0 };

const words = (value: unknown): ReadonlySet<string> =>
  new Set(Array.isArray(value) ? value.filter((word) => typeof word === "string") : []);

/** The config's lists, or `null` when the rule was given none. */
const lists = (options: ReadonlyArray<unknown>): Lists | null => {
  const [given] = options;

  if (typeof given !== "object" || given === null || !("src" in given)) {
    return null;
  }

  if (typeof given.src !== "string") {
    return null;
  }

  return {
    src: given.src.replace(/\/+$/, ""),
    rooms: words("rooms" in given ? given.rooms : []),
    folders: words("folders" in given ? given.folders : []),
    files: words("files" in given ? given.files : []),
    values: words("values" in given ? given.values : []),
  };
};

/** `a/b/../c/./d.ts` as its parts, or `null` when it climbs out of the folder it started in. */
const normalize = (parts: ReadonlyArray<string>): ReadonlyArray<string> | null => {
  const out: string[] = [];

  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part !== "..") {
      out.push(part);
      continue;
    }

    if (out.length === 0) {
      return null;
    }

    out.pop();
  }

  return out;
};

/** The written name at the root of `Schema.TaggedError<A>()("A", {})`: `Schema.TaggedError`. */
const rootName = (node: ESTree.Node | null | undefined): ReadonlyArray<string> => {
  let at = node;

  while (at != null && at.type === "CallExpression") {
    at = at.callee;
  }

  const names: string[] = [];

  while (at != null && at.type === "MemberExpression" && at.property.type === "Identifier") {
    names.unshift(at.property.name);
    at = at.object;
  }

  return at != null && at.type === "Identifier" ? [at.name, ...names] : [];
};

/** What a shared file may not hold, by the name its class extends or its `const` is called from. */
const held = (root: ReadonlyArray<string>): "an error" | "a service" | null => {
  const last = root.at(-1);

  if (last === undefined) {
    return null;
  }

  if (last.endsWith("Error")) {
    return "an error";
  }

  return root.length > 1 && (last === "Service" || last === "Reference") ? "a service" : null;
};

const WORDS = { type: "array", items: { type: "string" }, uniqueItems: true } as const;

export const rooms: CreateRule = {
  meta: {
    type: "problem",
    // oxlint refuses options for a rule that has no schema.
    schema: [
      {
        type: "object",
        properties: {
          src: { type: "string" },
          rooms: WORDS,
          folders: WORDS,
          files: WORDS,
          values: WORDS,
        },
        required: ["src", "rooms", "folders", "files", "values"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const given = lists(context.options);

    if (given === null) {
      return {};
    }

    const file = pathIn(context);

    if (!file.startsWith(`${given.src}/`)) {
      return {};
    }

    const parts = file.slice(given.src.length + 1).split("/");
    const [top = "", ...rest] = parts;
    const isTopFile = rest.length === 0;
    const stem = top.split(".")[0] ?? "";
    const room = !isTopFile && given.rooms.has(top) ? top : null;
    const isInternal = room !== null && rest.slice(0, -1).includes("internal");
    const isValues = isTopFile && given.values.has(stem);

    /** The other room a relative specifier points into, or `null`. */
    const otherRoom = (specifier: string): string | null => {
      if (room === null || !specifier.startsWith(".")) {
        return null;
      }

      const [first] = normalize([...parts.slice(0, -1), ...specifier.split("/")]) ?? [];

      return first !== undefined && first !== room && given.rooms.has(first) ? first : null;
    };

    const isTagged = (statement: ESTree.Node): boolean => {
      const doc = context.sourceCode
        .getCommentsBefore(statement)
        .findLast((comment) => comment.type === "Block" && comment.value.startsWith("*"));

      return doc !== undefined && /@internal\b/.test(doc.value);
    };

    const refuseHeld = (statement: ESTree.Node, root: ReadonlyArray<string>) => {
      const what = held(root);

      if (what !== null) {
        context.report({
          node: statement,
          message: `${top} is a shared name and holds values only (0043, rule 13). This is ${what}: it belongs in the room that owns it.`,
        });
      }
    };

    return {
      Program(program) {
        if (isTopFile ? !given.files.has(stem) : room === null && !given.folders.has(top)) {
          context.report({
            loc: { start: START, end: START },
            message: isTopFile
              ? `${given.src}/ holds no top file named ${top} (0043). A shared name is on the rule's list, and anything else goes in its room.`
              : `${given.src}/ holds no folder named ${top}/ (0043). A file goes in the room of its subject, never a folder by kind.`,
          });
        }

        const fromOther = new Map<string, string>();

        for (const statement of program.body) {
          if (statement.type === "ImportDeclaration") {
            const other = otherRoom(statement.source.value);

            if (other !== null) {
              for (const spec of statement.specifiers) {
                fromOther.set(spec.local.name, other);
              }
            }

            continue;
          }

          const isExport =
            statement.type === "ExportNamedDeclaration" ||
            statement.type === "ExportAllDeclaration" ||
            statement.type === "ExportDefaultDeclaration";

          if (isExport && isInternal && !isTagged(statement)) {
            context.report({
              node: statement,
              message:
                "Every export in a room's internal/ file is @internal (0032, 0043). Put `/** @internal */` above it.",
            });
          }

          if (room !== null && isExport) {
            const other =
              statement.type === "ExportDefaultDeclaration"
                ? statement.declaration.type === "Identifier"
                  ? fromOther.get(statement.declaration.name)
                  : undefined
                : statement.source != null
                  ? otherRoom(statement.source.value)
                  : statement.type === "ExportNamedDeclaration"
                    ? statement.specifiers
                        .map((spec) => (spec.local.type === "Identifier" ? fromOther.get(spec.local.name) : undefined))
                        .find((found) => found !== undefined)
                    : undefined;

            if (other != null) {
              context.report({
                node: statement,
                message: `${room}/ re-exports a name of ${other}/. No room re-exports another room's names (0043, rule 8): the caller imports ${other}/'s front file.`,
              });
            }
          }

          if (!isValues) {
            continue;
          }

          const declared =
            statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
              ? statement.declaration
              : statement;

          if (declared?.type === "ClassDeclaration" || declared?.type === "ClassExpression") {
            refuseHeld(statement, rootName(declared.superClass));
          } else if (declared?.type === "VariableDeclaration") {
            for (const declarator of declared.declarations) {
              if (declarator.init?.type === "CallExpression") {
                refuseHeld(statement, rootName(declarator.init));
              }
            }
          }
        }
      },
    };
  },
};
