/**
 * Converts a title to lowercase ASCII letter-and-digit groups joined by hyphens.
 * Uses Unicode NFKD compatibility decomposition, lowercasing, and removal of
 * Unicode combining marks: Çay Şeker → cay-seker, Café → cafe, ﬂower → flower.
 * Decomposed accent spellings fold the same way. No additional transliteration
 * is applied: letters without an ASCII form after folding (such as ß, ø, or 中)
 * and all other remaining non-ASCII-alphanumeric characters separate words.
 * Separator runs become one hyphen, with none at either edge; no usable content
 * produces an empty string.
 *
 * @example slugify("Hello, World!") // "hello-world"
 * @example slugify("Çay Şeker") // "cay-seker"
 * @example slugify("!!!") // ""
 */
export function slugify(text: string): string {
	return text.normalize("NFKD")
		.toLowerCase()
		.replace(/\p{M}+/gu, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}
