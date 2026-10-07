import { interpolate, useCurrentFrame } from "remotion";
import { fadeInOut, seconds } from "../timing";
import { color, layout, type, weight } from "../tokens";
import { plain, Rich } from "./Rich";

/**
 * The longest caption that still fits on two lines at caption size. A longer
 * one is a storyboard bug, so it fails the render instead of wrapping to three.
 */
export const CAPTION_MAX_CHARS = 96;

export const assertCaptionFits = (text: string): void => {
  const n = plain(text).length;
  if (n > CAPTION_MAX_CHARS) {
    throw new Error(
      `Caption is ${n} characters, over the ${CAPTION_MAX_CHARS} that fit on two lines. Split it: "${plain(text)}"`,
    );
  }
};

/**
 * One narration line in the caption band at the bottom of the frame. It fades
 * and rises in, holds, and fades out over `durationInFrames`. Use it inside a
 * <Sequence>; the scene runner in Chapter.tsx does that for you.
 */
export const Caption: React.FC<{ text: string; durationInFrames: number }> = ({ text, durationInFrames }) => {
  assertCaptionFits(text);
  const frame = useCurrentFrame();
  const opacity = fadeInOut(frame, durationInFrames, seconds(0.35));
  const rise = interpolate(frame, [0, seconds(0.5)], [14, 0], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: layout.captionBandTop,
        bottom: 0,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 20,
      }}
    >
      <div
        style={{
          maxWidth: layout.captionMaxWidth,
          textAlign: "center",
          fontSize: type.caption,
          lineHeight: 1.3,
          fontWeight: weight.medium,
          letterSpacing: "-0.01em",
          color: color.text,
          opacity,
          transform: `translateY(${rise}px)`,
          textWrap: "balance",
        }}
      >
        <Rich text={text} />
      </div>
    </div>
  );
};
