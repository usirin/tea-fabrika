// Today's app, L1. Numbers and library overrides are owned by the frame's one checked block.
import {
	cssName,
	file,
	frameLayerBlock,
	inFrameLayerBlock,
	layerValue,
	plugin,
	WINDOW,
} from "../css-support.ts";

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
		if (cssName(rule.name).toLowerCase() === "property" && reserved(cssName(rule.params.trim())))
			fire(rule, "Reserved layer variables cannot be registered with @property.");
	});
	root.walkDecls((decl) => {
		const prop = cssName(decl.prop).toLowerCase();
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
