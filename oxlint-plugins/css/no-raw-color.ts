import valueParser from "postcss-value-parser";
import {file, generated, media, plugin, WINDOW} from "../css-support.ts";

// CSS Color 4 named colors, https://www.w3.org/TR/css-color-4/#named-colors.
const colors = new Set(
	`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond
blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson
cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen
darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink
indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite
navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred
papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown
salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(
		/\s+/,
	),
);

// Includes deprecated names, which remain system colors rather than design tokens.
const system = new Set(
	`accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas
canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem
selecteditemtext visitedtext activeborder activecaption appworkspace background buttonhighlight
buttonshadow captiontext inactiveborder inactivecaption inactivecaptiontext infobackground infotext
menu menutext scrollbar threeddarkshadow threedface threedhighlight threedlightshadow threedshadow
window windowframe windowtext`.split(/\s+/),
);

const functions =
	/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk|light-dark)$/i;

const pipeTokens = new Set([
	"--tile-wash",
	"--tile-wash-on",
	"--tile-edge-hover",
	"--tile-edge-on",
	"--tile-edge-loud",
]);

const colorProperty =
	/^(?:color|.+-color|background(?:-.+)?|border(?:-.+)?|outline(?:-.+)?|(?:box|text)-shadow|fill|stroke(?:-.+)?|column-rule|text-(?:decoration|emphasis|stroke))$/i;

const colorFunction =
	/^(?:(?:repeating-)?(?:linear|radial|conic)-gradient|drop-shadow|image|cross-fade|light-dark)$/i;

export default plugin("no-raw-color", (root, fire) => {
	root.walkDecls((decl) => {
		if (generated(decl)) {
			return;
		}

		if (
			file(decl) === WINDOW &&
			pipeTokens.has(decl.prop) &&
			decl.parent?.type === "rule" &&
			/^\[data-pipe=(?:"[^"]+"|'[^']+')\]$/.test(decl.parent.selector)
		) {
			return;
		}

		const named =
			decl.prop.startsWith("--") ||
			colorProperty.test(decl.prop.replace(/^-(?:webkit|moz|ms|o)-/i, ""));
		const forced = media(decl, "forced-colors", "active");
		let raw = false;
		const check = (nodes: valueParser.Node[], names: boolean) =>
			valueParser.walk(nodes, (node) => {
				if (node.type === "function") {
					if (node.value.toLowerCase() === "url") {
						return false;
					}

					// light-dark selects values; its token-only form is fine.
					if (functions.test(node.value) && node.value.toLowerCase() !== "light-dark") {
						raw = true;
					}

					check(node.nodes, names || colorFunction.test(node.value));
					return false;
				}

				if (node.type !== "word") {
					return;
				}

				const word = node.value.toLowerCase();

				if (
					/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(word) ||
					(names && (colors.has(word) || (system.has(word) && !forced)))
				) {
					raw = true;
				}
			});
		check(valueParser(decl.value).nodes, named);

		if (raw) {
			fire(decl, "Read a design token instead of a raw color");
		}
	});
});
