// The window's public page, next/ (Tier 1, P14). One HTML document from the built strings: the
// collected style text embedded in order, and the browser script the same brain serves at
// `/window.js`. No other request: the icon is empty, so a tab asks for nothing it cannot have.

/** A style text with its source, in the order the page applies them. */
export type Style = { readonly source: "manti" | "tokens" | "tuval"; readonly css: string };

/** Text that cannot end the element it sits in. */
const inert = (text: string): string => text.replaceAll("</", "<\\/");

/** Text that cannot leave the attribute it sits in. */
const attribute = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The page that loads the window. `build` names the script, for the rows the tab records. */
export const page = (styles: ReadonlyArray<Style>, build = ""): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<meta name="fabrika-build" content="${attribute(build)}">`,
    "<title>fabrika</title>",
    '<link rel="icon" href="data:,">',
    ...styles.map((s) => `<style data-source="${s.source}">${inert(s.css)}</style>`),
    "</head>",
    "<body>",
    '<div id="root"></div>',
    '<script type="module" src="/window.js"></script>',
    "</body>",
    "</html>",
  ].join("\n");
