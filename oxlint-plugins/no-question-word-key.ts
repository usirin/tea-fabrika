// A question word is never a name in next/ and .agents/ (0081): where, why, what, who and how give
// way to the noun for the value, such as location, reason, message, to or method. oxlint's own
// `eslint/id-denylist` holds every name written as a word: a key, a field, a type member, a
// parameter, a local. It cannot see a key written as a string, `{"why": 1}`, `["how"]` or
// `` [`what`] ``, so this rule holds those alone, and the two never report one key twice.
//
// A string key counts by its decoded value, so `"why"` is `why`. Reads, dynamic keys and string
// values pass.
import type { CreateRule } from "@oxlint/plugins";
import type { Node } from "./match.ts";

const WORDS: ReadonlySet<string> = new Set(["where", "why", "what", "who", "how"]);

/** A key's name when it is written as a string, plain or computed; `null` for any other key. */
const written = (key: Node, computed: boolean): string | null =>
  key.type === "Literal" && typeof key.value === "string"
    ? key.value
    : computed && key.type === "TemplateLiteral" && key.expressions.length === 0
      ? (key.quasis[0]?.value.cooked ?? null)
      : null;

export const noQuestionWordKey: CreateRule = {
  create(context) {
    const check = (key: Node, computed: boolean) => {
      const name = written(key, computed);

      if (name !== null && WORDS.has(name)) {
        context.report({
          node: key,
          message: `A question word is never a key (0081): name the value ${JSON.stringify(name)} holds, such as reason, location, message, to or method.`,
        });
      }
    };
    return {
      Property(node) {
        if (node.parent.type === "ObjectExpression") {
          check(node.key, node.computed);
        }
      },
      PropertyDefinition: (node) => check(node.key, node.computed),
      AccessorProperty: (node) => check(node.key, node.computed),
      MethodDefinition: (node) => check(node.key, node.computed),
      TSAbstractPropertyDefinition: (node) => check(node.key, node.computed),
      TSAbstractAccessorProperty: (node) => check(node.key, node.computed),
      TSAbstractMethodDefinition: (node) => check(node.key, node.computed),
      TSPropertySignature: (node) => check(node.key, node.computed),
      TSMethodSignature: (node) => check(node.key, node.computed),
    };
  },
};
