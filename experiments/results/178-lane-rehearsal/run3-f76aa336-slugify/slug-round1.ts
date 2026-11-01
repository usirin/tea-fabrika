/** A lowercase ASCII slug with canonical accents folded and words joined by hyphens. */
export function slugify(text: string): string {
	const folded = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
	return (folded.match(/[a-z0-9]+/g) ?? []).join("-");
}
