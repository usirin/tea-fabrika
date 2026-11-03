/**
 * The text styles every program's window shares: a few named roles on Manti's `Text` and `Heading`
 * (docs/direction/ui-on-manti.md), so no window sets a font size by hand. Each role is Manti's own
 * props, a size stop with its weight and an emphasis, spread onto the part:
 *
 *   <Heading level={1} {...textStyle.title}>…</Heading>
 *   <Text as="span" {...textStyle.label}>Recommended</Text>
 *
 * Two text colors only, Radix step 12 and the low step (color-principles.md): `emphasis` is the
 * default (step 12) or `muted` (the low step), never `subtle`. Rank comes from size and weight. The
 * sizes are theme.css's px scale on Manti's names: sm 12, base 13, xl 15, 2xl 22.
 *
 * Sketch for the typography study (local branch). If Manti takes a `textStyle` prop with styles set
 * in tokens, these move into theme.css and a part says `<Text textStyle="label">`.
 */
export const textStyle = {
	/** A window's one title: the ticket's name. 22, 600, step 12. */
	title: {size: "2xl/semibold"},
	/** The lead line of a block: a card's question, a section a person acts in. 15, 600, step 12. */
	heading: {size: "xl/semibold"},
	/** What a row or a value is about, where the eye lands: a row's title, the answer a label names. 13, 500, step 12. */
	strong: {size: "base/medium"},
	/** Words to read: a description, a value. 13, 400, step 12. */
	body: {size: "base"},
	/** A second line that explains: a reason, a hint. 13, 400, the low step. */
	quiet: {size: "base", emphasis: "muted"},
	/** Names a value or says when and who: a property's name, a time, a count. 12, 400, the low step. */
	label: {size: "sm", emphasis: "muted"},
} as const;

export type TextStyle = keyof typeof textStyle;
