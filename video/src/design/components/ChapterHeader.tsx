import { interpolate, useCurrentFrame } from "remotion";
import { enter, seconds } from "../timing";
import { color, font, layout, type, weight } from "../tokens";
import { Rich } from "./Rich";

/**
 * The card that opens a chapter: the chapter number in the accent, the post's
 * title, and "Part N of 10". Left aligned, so it reads as a page, not a poster.
 */
export const ChapterHeader: React.FC<{
  number: number;
  title: string;
  of?: number;
}> = ({ number, title, of = 10 }) => {
  const frame = useCurrentFrame();
  const n = enter(frame, 0);
  const t = enter(frame, seconds(0.2));
  const p = enter(frame, seconds(0.45));
  const rule = interpolate(enter(frame, seconds(0.3)), [0, 1], [0, 160]);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: `0 ${layout.padX + 40}px`,
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 120,
          fontWeight: weight.medium,
          color: color.accent,
          letterSpacing: "-0.02em",
          opacity: n,
          transform: `translateY(${(1 - n) * 20}px)`,
        }}
      >
        {String(number).padStart(2, "0")}
      </div>
      <div style={{ height: 2, width: rule, background: color.accentLine, margin: "28px 0 44px" }} />
      <div
        style={{
          fontSize: type.title,
          fontWeight: weight.semibold,
          letterSpacing: "-0.025em",
          lineHeight: 1.1,
          maxWidth: 1450,
          opacity: t,
          transform: `translateY(${(1 - t) * 24}px)`,
          textWrap: "balance",
        }}
      >
        <Rich text={title} />
      </div>
      <div
        style={{
          marginTop: 40,
          fontFamily: font.mono,
          fontSize: type.label,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: color.textMuted,
          opacity: p,
        }}
      >
        Part {number} of {of}
      </div>
    </div>
  );
};
