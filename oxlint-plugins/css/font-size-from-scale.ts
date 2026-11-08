import valueParser from "postcss-value-parser";
import {plugin} from "../css-support.ts";

const pixels = (nodes: valueParser.Node[]) => {
	let found = false;
	valueParser.walk(nodes, (node) => {
		if (node.type !== "word") return;
		const dimension = valueParser.unit(node.value);
		if (dimension && dimension.unit.toLowerCase() === "px") found = true;
	});
	return found;
};

export default plugin("font-size-from-scale", (root, fire) => {
	root.walkDecls((decl) => {
		const property = decl.prop.toLowerCase();
		if (property !== "font-size" && property !== "font") return;
		const nodes = valueParser(decl.value).nodes;
		if (property === "font-size") {
			if (pixels(nodes)) fire(decl, "Use a font size from the design scale");
			return;
		}
		// The first size ends the search. A px line-height or family name is not a font size.
		for (const node of nodes) {
			const dimension = node.type === "word" ? valueParser.unit(node.value) : false;
			const size =
				node.type === "word" &&
				(Boolean(dimension && dimension.unit) ||
					/^(?:xx?-small|small|medium|large|xx?-large|smaller|larger)$/.test(node.value));
			const formula = node.type === "function" && /^(?:calc|min|max|clamp)$/i.test(node.value);
			const token =
				node.type === "function" &&
				node.value === "var" &&
				/^--(?:fs-|manti-text-)/.test(valueParser.stringify(node.nodes));
			if (!size && !formula && !token) continue;
			if (pixels([node])) fire(decl, "Use a font size from the design scale");
			break;
		}
	});
});
