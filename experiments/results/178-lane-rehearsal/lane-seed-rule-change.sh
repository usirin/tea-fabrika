cat >> AGENTS.md <<'EOF'
- A file named `name.laws.test.ts` holds laws: what must stay true of a helper, whoever changes it.
EOF
cat > src/slug.ts <<'EOF'
/** The most characters a slug may have. */
const MAX = 40;

/** A title as a lowercase ASCII URL slug of at most `MAX` characters. */
export function slugify(text: string): string {
	const slug = text
		.normalize("NFKD")
		.toLowerCase()
		.replace(/\p{M}+/gu, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return slug.slice(0, MAX).replace(/-$/, "");
}
EOF
cat > src/slug.test.ts <<'EOF'
import {expect, it} from "vitest";
import {slugify} from "./slug.ts";

it("makes a slug", () => {
	expect(slugify("Çay Şeker")).toBe("cay-seker");
	expect(slugify("!!!")).toBe("");
});
EOF
cat > src/slug.laws.test.ts <<'EOF'
import fc from "fast-check";
import {expect, it} from "vitest";
import {slugify} from "./slug.ts";

// Law: a slug is never longer than 40 characters, and never ends on a hyphen.
it("a slug stays within its limit", () => {
	fc.assert(
		fc.property(fc.string({maxLength: 300}), (title) => {
			const slug = slugify(title);
			expect(slug.length).toBeLessThanOrEqual(40);
			expect(slug.endsWith("-")).toBe(false);
		}),
		{seed: 1},
	);
});
EOF
