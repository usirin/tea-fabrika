import { generated, plugin, references, steps, tokens } from "../css-support.ts";

export default plugin("token-exists", (root, fire) => {
  root.walkDecls((decl) => {
    if (generated(decl)) {
      return;
    }

    const local = new Set<string>();
    decl.parent?.each((node) => {
      if (node.type === "decl" && node.prop.startsWith("--")) {
        local.add(node.prop);
      }
    });

    for (const name of references(decl)) {
      // A primitive is reported by its own rule, even when locally declared.
      if (!tokens.has(name) && !steps.has(name) && !local.has(name)) {
        fire(decl, `Unknown token ${name}`, name);
      }
    }
  });
});
