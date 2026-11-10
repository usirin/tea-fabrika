import { file, generated, parts, plugin, references, tokens } from "../css-support.ts";

export default plugin("part-token-owner", (root, fire) => {
  root.walkDecls((decl) => {
    if (generated(decl)) {
      return;
    }

    for (const name of [decl.prop, ...references(decl)]) {
      const owner = tokens.get(name);

      if (owner !== undefined && owner !== "design" && !parts[owner]?.includes(file(decl))) {
        fire(decl, `${name} belongs to ${owner}; use it only in that part's stylesheets`);
      }
    }
  });
});
