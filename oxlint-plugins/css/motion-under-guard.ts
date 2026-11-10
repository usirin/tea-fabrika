import { media, plugin } from "../css-support.ts";

export default plugin("motion-under-guard", (root, fire) => {
  root.walkDecls((decl) => {
    if (!/^(?:-webkit-)?(?:transition|animation)(?:-|$)/i.test(decl.prop)) {
      return;
    }

    const reduced = media(decl, "prefers-reduced-motion", "reduce");

    if (reduced && /^(?:none|0s)$/i.test(decl.value.trim())) {
      return;
    }

    if (!reduced && media(decl, "prefers-reduced-motion", "no-preference")) {
      return;
    }

    fire(decl, "Motion needs @media (prefers-reduced-motion: no-preference)");
  });
});
