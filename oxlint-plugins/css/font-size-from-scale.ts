import valueParser from "postcss-value-parser";
import {plugin} from "../css-support.ts";

const pixels = (nodes: valueParser.Node[]) => {
	let found = false;
	valueParser.walk(nodes, (node) => {
		if (node.type !== "word") {
			return;
		}

		const dimension = valueParser.unit(node.value);

		if (dimension && dimension.unit.toLowerCase() === "px") {
			found = true;
		}
	});
	return found;
};

const sizeKeyword = /^(?:xx?-small|small|medium|large|xx?-large|xxx-large|smaller|larger|math)$/i;

const length =
	/^(?:px|em|rem|ex|rex|cap|rcap|ch|rch|ic|ric|lh|rlh|vw|vh|vi|vb|vmin|vmax|[sld]v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max)|cm|mm|q|in|pt|pc|%)$/i;

const angle = /^(?:deg|grad|rad|turn)$/i;

const hasUnit = (nodes: valueParser.Node[], units: RegExp) => {
	let found = false;
	valueParser.walk(nodes, (node) => {
		const dimension = node.type === "word" ? valueParser.unit(node.value) : false;

		if (dimension && units.test(dimension.unit)) {
			found = true;
		}
	});
	return found;
};

// https://drafts.csswg.org/css-fonts-4/#font-prop
// [style || variant || weight || width]? size [/ line-height]? family
const fontSize = (all: valueParser.Node[]) => {
	const nodes = all.filter((node) => node.type !== "space" && node.type !== "comment");
	const slash = nodes.findIndex((node) => node.type === "div" && node.value === "/");

	if (slash !== -1) {
		return nodes[slash - 1];
	}

	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index];

		if (node === undefined) {
			continue;
		}

		if (node.type === "word") {
			if (node.value.toLowerCase() === "oblique") {
				const next = nodes[index + 1];

				if (next !== undefined && hasUnit([next], angle)) {
					index++;
				}

				continue;
			}

			const dimension = valueParser.unit(node.value);

			if (sizeKeyword.test(node.value) || (dimension && length.test(dimension.unit))) {
				return node;
			}

			if (node.value === "0") {
				return node;
			}
		}

		if (node.type === "function") {
			if (/^(?:calc|min|max|clamp)$/i.test(node.value) && hasUnit(node.nodes, length)) {
				return node;
			}

			if (
				node.value === "var" &&
				/^--(?:fs-|manti-text-)/.test(valueParser.stringify(node.nodes))
			) {
				return node;
			}
		}
	}

	return undefined;
};

export default plugin("font-size-from-scale", (root, fire) => {
	root.walkDecls((decl) => {
		const property = decl.prop.toLowerCase();

		if (property !== "font-size" && property !== "font") {
			return;
		}

		const nodes = valueParser(decl.value).nodes;

		if (property === "font-size") {
			if (pixels(nodes)) {
				fire(decl, "Use a font size from the design scale");
			}

			return;
		}

		const size = fontSize(nodes);

		if (size !== undefined && pixels([size])) {
			fire(decl, "Use a font size from the design scale");
		}
	});
});
