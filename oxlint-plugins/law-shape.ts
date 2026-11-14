// Each law in a `next/` or `.agents/` test file is a property, or an example whose title starts with
// `vector:`, `format:`, `pinned:` or `scenario:` and its reason (0093). One ticket or law id may
// stand before the label (`T652 scenario: ...`, `R3 format: ...`): one token of letters, digits and
// dots, then a space. A label deeper in the title, or only in a comment, does not count. Advice
// only, until its false alarms on main are counted at about 0%; then it blocks.
//
// A test is a call rooted at `it` or `test`: `it(...)`, `it.effect(...)`, `it.live(...)`,
// `it.skip(...)`, `it.only(...)`, `it.fails(...)`, and the ones a first call makes:
// `it.each(rows)(...)`, `it.skipIf(c)(...)`, `it.runIf(c)(...)`, `it.for(rows)(...)`. A `describe`
// is not a test, so the tests inside it are read one by one. `it.todo` is not read. `it.layer(L)` makes
// a group, not a test, so only the tests inside it are read. A test function a file makes for itself
// (`const t = test.extend(...)`) is not read.
//
// It is a property when its chain names `prop` (`it.prop`, `it.effect.prop`), or when its body
// calls fast-check's `assert` (through any local name an import of `fast-check` gives it) or one of
// `@demlik/tea/pbt`'s runners (`propertyTrace`, `propertyInvariant`, `propertyTerminates`), or the
// shared runner: `property` from a `Testing.test-support.ts` module (libfabrika's, which calls
// `fc.assert` itself), named, renamed or through a namespace. A body that calls a function this file
// declares counts as that function's body too, followed to any depth. Any other imported helper is
// not followed, a `property` from another module included.
//
// A title is read only when it is written out: a string, or a template whose text before its first
// `${}` already decides it. Any other title (a helper's parameter, `name + x`) is not judged, so a
// helper that wraps `it` is read at its own `it` only when that one is a property. Under-reporting
// is the safe side for advice.
import type { CreateRule, ESTree } from "@oxlint/plugins";
import { below, dotted, type Node } from "./match.ts";

const LABELS = ["vector", "format", "pinned", "scenario"] as const;
/** One leading ticket or law id, `T652 ` or `R3.1 `, may stand before the label (lead, 2026-11-11). */
const ID = /^[A-Za-z0-9.]+ /;
const LABELED = new RegExp(`^(?:${ID.source.slice(1)})?(${LABELS.join("|")}):\\s*\\S`);
const RUNNERS = new Set(["propertyTrace", "propertyInvariant", "propertyTerminates"]);
/** The shared runner's module, by its last path segment: `../Testing.test-support.ts`, and its one export. */
const SHARED = /(?:^|\/)Testing\.test-support\.ts$/;
const SHARED_RUNNER = "property";

/** Calls that make a test from their own call: `it.each(rows)` is not a test, `it.each(rows)(...)` is. */
const MAKERS = new Set(["each", "for", "skipIf", "runIf"]);

const MESSAGE = `Advice, does not block: a law here is a property (it.prop, it.effect.prop, a body that calls fc.assert, or a @demlik/tea/pbt runner) or an example whose title starts with ${LABELS.map((l) => `${l}:`).join(", ")} and its reason (0093).`;

type Fn = ESTree.ArrowFunctionExpression | ESTree.Function;

const isFn = (node: Node | null | undefined): node is Fn =>
  node != null &&
  (node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration");

/** The member names from `it` or `test` to the call, `["effect", "prop"]`, or `null` for any other call. */
const chainOf = (callee: Node): readonly string[] | null => {
  const names: string[] = [];
  let at: Node = callee;

  for (;;) {
    if (at.type === "Identifier") {
      return at.name === "it" || at.name === "test" ? names.reverse() : null;
    }

    if (at.type === "MemberExpression" && !at.computed && at.property.type === "Identifier") {
      names.push(at.property.name);
      at = at.object;
      continue;
    }

    if (
      at.type === "CallExpression" &&
      at.callee.type === "MemberExpression" &&
      !at.callee.computed &&
      at.callee.property.type === "Identifier" &&
      MAKERS.has(at.callee.property.name)
    ) {
      at = at.callee;
      continue;
    }

    return null;
  }
};

/** Whether a written title carries a label, or `null` when the source does not say. */
const labeled = (title: Node | undefined): boolean | null => {
  if (title?.type === "Literal" && typeof title.value === "string") {
    return LABELED.test(title.value);
  }

  if (title?.type !== "TemplateLiteral") {
    return null;
  }

  const head = title.quasis[0]?.value.cooked ?? "";

  if (title.expressions.length === 0 || LABELED.test(head)) {
    return LABELED.test(head);
  }

  // `format: ${x}` is labeled, with its reason in `x`. `${x}`, `form${x}` and `T652 ${x}` could
  // still become a label, so the source does not say. `the window ${x}` cannot.
  const rest = head.replace(ID, "");

  if (LABELS.some((label) => head.startsWith(`${label}:`) || rest.startsWith(`${label}:`))) {
    return true;
  }

  return LABELS.some((label) => `${label}:`.startsWith(head) || `${label}:`.startsWith(rest)) ? null : false;
};

export const lawShape: CreateRule = {
  create(context) {
    return {
      Program(program) {
        const asserts = new Set<string>();
        const runners = new Set<string>();
        const local = new Map<string, Fn[]>();

        for (const statement of program.body) {
          if (statement.type !== "ImportDeclaration" || statement.importKind === "type") {
            continue;
          }

          const from = statement.source.value;
          const fastCheck = from === "fast-check";
          const pbt = from === "@demlik/tea/pbt";
          const shared = SHARED.test(from);

          for (const spec of statement.specifiers) {
            const name = spec.local.name;
            const imported =
              spec.type === "ImportSpecifier" && spec.imported.type === "Identifier" ? spec.imported.name : null;

            if (fastCheck && spec.type !== "ImportSpecifier") {
              asserts.add(`${name}.assert`);
            } else if (fastCheck && imported === "assert") {
              asserts.add(name);
            } else if (pbt && spec.type === "ImportNamespaceSpecifier") {
              for (const runner of RUNNERS) {
                runners.add(`${name}.${runner}`);
              }
            } else if (pbt && imported !== null && RUNNERS.has(imported)) {
              runners.add(name);
            } else if (shared && spec.type === "ImportNamespaceSpecifier") {
              runners.add(`${name}.${SHARED_RUNNER}`);
            } else if (shared && imported === SHARED_RUNNER) {
              runners.add(name);
            }
          }
        }

        for (const node of below(program)) {
          const named =
            node.type === "FunctionDeclaration" && node.id
              ? { name: node.id.name, fn: node }
              : node.type === "VariableDeclarator" && node.id.type === "Identifier" && isFn(node.init)
                ? { name: node.id.name, fn: node.init }
                : null;

          if (named !== null) {
            local.set(named.name, [...(local.get(named.name) ?? []), named.fn]);
          }
        }

        const proves = (fn: Node, seen: Set<Node>): boolean => {
          if (seen.has(fn)) {
            return false;
          }

          seen.add(fn);

          for (const node of below(fn)) {
            if (node.type !== "CallExpression") {
              continue;
            }

            const name = dotted(node.callee);

            if (name !== null && (asserts.has(name) || runners.has(name))) {
              return true;
            }

            if (node.callee.type === "Identifier" && (local.get(node.callee.name) ?? []).some((f) => proves(f, seen))) {
              return true;
            }
          }

          return false;
        };

        for (const node of below(program)) {
          if (node.type !== "CallExpression") {
            continue;
          }

          const { callee } = node;

          if (
            callee.type === "MemberExpression" &&
            callee.property.type === "Identifier" &&
            MAKERS.has(callee.property.name)
          ) {
            continue;
          }

          const chain = chainOf(callee);

          if (chain === null || chain.includes("todo") || node.arguments.length < 2) {
            continue;
          }

          if (chain.includes("prop")) {
            continue;
          }

          const bodies = node.arguments.flatMap((arg): Node[] =>
            isFn(arg) ? [arg] : arg.type === "Identifier" ? (local.get(arg.name) ?? []) : [],
          );
          const seen = new Set<Node>();

          if (bodies.some((body) => proves(body, seen))) {
            continue;
          }

          const title = node.arguments[0];

          if (labeled(title) === false) {
            context.report({ node: title ?? node, message: MESSAGE });
          }
        }
      },
    };
  },
};
