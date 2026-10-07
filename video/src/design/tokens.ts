/**
 * The whole look in one place. Dark, calm, one accent (a warm tea amber).
 * Sizes are in px on a 1920x1080 frame and are chosen to stay readable on a
 * phone: nothing on screen is smaller than `type.label`.
 */

export const color = {
  bg: "#0E1014",
  bgGlow: "#161A21",
  surface: "#161A21",
  surfaceRaised: "#1D222B",
  line: "#2C323D",
  text: "#EEF0F3",
  textMuted: "#A2AAB8",
  textFaint: "#636B79",
  /** The one accent. Use it for the single thing the viewer should look at. */
  accent: "#E8B44F",
  accentSoft: "rgba(232, 180, 79, 0.14)",
  accentLine: "rgba(232, 180, 79, 0.55)",
} as const;

export const font = {
  sans: "Inter",
  mono: "JetBrains Mono",
} as const;

/** Font sizes. `caption` is the narration line; keep everything else at or above `label`. */
export const type = {
  display: 132,
  title: 96,
  heading: 68,
  caption: 56,
  body: 44,
  code: 34,
  label: 32,
} as const;

export const weight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/** An 8px grid. */
export const space = (n: number): number => n * 8;

export const layout = {
  width: 1920,
  height: 1080,
  /** Side padding of every frame. */
  padX: 160,
  /** Top padding of the visual area. */
  padTop: 104,
  /** The caption band sits at the bottom; visuals stay above it. */
  captionBandTop: 820,
  captionMaxWidth: 1480,
  radius: 20,
} as const;

/** The visual area: everything a scene draws, above the caption band. */
export const stage = {
  x: layout.padX,
  y: layout.padTop,
  width: layout.width - layout.padX * 2,
  height: layout.captionBandTop - layout.padTop - 24,
} as const;
