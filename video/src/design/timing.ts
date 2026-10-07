import { Easing, interpolate, spring } from "remotion";

export const FPS = 30;

/** Seconds to frames. Every duration in this project is written in seconds. */
export const seconds = (s: number): number => Math.round(s * FPS);

/** A calm ease-out: fast start, long soft landing. */
export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 → 1 over `dur` frames starting at `start`, eased, clamped. */
export const progress = (frame: number, start: number, dur: number, easing = easeOut): number =>
  interpolate(frame, [start, start + Math.max(1, dur)], [0, 1], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** A soft spring with no bounce, 0 → 1, starting at `delay` frames. */
export const enter = (frame: number, delay = 0): number =>
  spring({ frame: frame - delay, fps: FPS, config: { damping: 200, mass: 0.9 } });

/** Opacity for something on screen for `total` frames: fades in, holds, fades out. */
export const fadeInOut = (frame: number, total: number, fade = seconds(0.4)): number =>
  interpolate(frame, [0, fade, total - fade, total], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** Reading pace for on-screen narration: about 3 words a second. */
export const WORDS_PER_SECOND = 3;

export const wordCount = (text: string): number =>
  text.replace(/\*/g, "").trim().split(/\s+/).filter(Boolean).length;

/**
 * How long a caption stays up: its words at reading pace, plus time for the
 * fade in and out, and never under 2.4 seconds.
 */
export const captionSeconds = (text: string): number =>
  Math.max(2.4, wordCount(text) / WORDS_PER_SECOND + 0.8);
