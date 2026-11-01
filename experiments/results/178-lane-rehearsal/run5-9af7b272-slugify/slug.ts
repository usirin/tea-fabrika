/** A lowercase ASCII slug with ordinary accents folded and words joined by hyphens. */
export function slugify(text: string): string {
	return text.normalize("NFD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}
