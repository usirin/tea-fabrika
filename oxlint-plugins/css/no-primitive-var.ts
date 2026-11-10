import {generated, plugin, references, steps} from "../css-support.ts";

export default plugin("no-primitive-var", (root, fire) => {
	root.walkDecls((decl) => {
		if (generated(decl)) {
			return;
		}

		for (const name of [decl.prop, ...references(decl)]) {
			if (steps.has(name)) {
				fire(decl, `Read a design token instead of ${name}`);
			}
		}
	});
});
