// Today's app, L1. Numbers and library overrides are owned by the frame's one checked block.
import {
	file,
	frameLayerBlock,
	inFrameLayerBlock,
	layerValue,
	plugin,
	WINDOW,
} from "../css-support.ts";

// CSS Syntax's escaped code points: up to six hex digits and one optional space.
const unescape = (name: string) =>
	name.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[ \t\r\n\f])?|([^\r\n\f]))/gi, (_, hex, char) => {
		if (hex === undefined) return char;
		const point = Number.parseInt(hex, 16);
		return String.fromCodePoint(
			point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff) ? 0xfffd : point,
		);
	});
const reserved = (prop: string) =>
	prop.startsWith("--layer-") || /^--manti-(dialog|popover|tooltip)-z-index$/.test(prop);

export default plugin("frame-layers", (root, fire) => {
	const checked = frameLayerBlock(root);
	if (file(root) === WINDOW && checked === null)
		fire(
			root,
			"window.css must contain the complete fabrika-frame-layers rank table: desk 0, sheet 1, float 2, popover 3, palette 4, tooltip 5.",
		);
	root.walkAtRules("layer", (block) => {
		if (block.params.trim() !== "fabrika-frame-layers") return;
		if (block !== checked)
			fire(
				block,
				"One top-level frame block in window.css must define desk 0, sheet 1, float 2, popover 3, palette 4, tooltip 5.",
			);
	});
	root.walkAtRules((rule) => {
		if (unescape(rule.name).toLowerCase() === "property" && reserved(unescape(rule.params.trim())))
			fire(rule, "Reserved layer variables cannot be registered with @property.");
	});
	root.walkDecls((decl) => {
		const prop = unescape(decl.prop).toLowerCase();
		const rank = prop.startsWith("--layer-");
		const manti = /^--manti-(dialog|popover|tooltip)-z-index$/.test(prop);
		if (prop !== "z-index" && !rank && !manti) return;
		if (file(decl) !== WINDOW || !inFrameLayerBlock(decl)) {
			fire(decl, "Layer choices belong to the checked fabrika-frame-layers block in window.css.");
			return;
		}
		if (!rank && (!layerValue(decl.value) || decl.important)) {
			fire(decl, "Use one named layer token, without a fallback, calculation or !important.");
		}
	});
});
