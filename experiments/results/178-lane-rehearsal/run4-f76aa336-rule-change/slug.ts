/** The most characters a slug may have. */
const MAX = 80;

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
