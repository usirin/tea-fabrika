// A question word is never a name (0081). oxlint's own `eslint/id-denylist` holds every name written
// as an identifier; it does not decode a quoted, computed or template key, so this rule holds those.
// Reads and dynamic keys keep their own meaning.
import type { CreateRule } from "@oxlint/plugins";
import type { Node } from "./match.ts";

// The five words 0081 retires, also listed for `eslint/id-denylist` in `.oxlintrc.json`.
const QUESTION_WORDS: ReadonlySet<string> = new Set(["where", "why", "what", "who", "how"]);

export const noQuestionWordKey: CreateRule = {
  create(context) {
    const check = (key: Node, computed: boolean) => {
      const name =
        key.type === "Literal" && typeof key.value === "string"
          ? key.value
          : computed && key.type === "TemplateLiteral" && key.expressions.length === 0
            ? key.quasis[0]?.value.cooked
            : null;

      if (name != null && QUESTION_WORDS.has(name)) {
        context.report({
          node: key,
          message:
            "Name this key with the noun for the value it holds: where, why, what, who and how are question words, never names (0081).",
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
