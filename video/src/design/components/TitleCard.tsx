import { interpolate, useCurrentFrame } from "remotion";
import { enter, seconds } from "../timing";
import { color, font, type, weight } from "../tokens";
import { Rich } from "./Rich";

/**
 * A centred title: a small kicker above, the title, an optional subtitle.
 * Each part rises in a beat after the last. Fills the whole frame.
 */
export const TitleCard: React.FC<{
  kicker?: string;
  title: string;
  subtitle?: string;
  /** Frame to start the entrance at. */
  delay?: number;
  /** Px to raise the block by, to leave room for a caption under it. */
  lift?: number;
}> = ({ kicker, title, subtitle, delay = 0, lift = 0 }) => {
  const frame = useCurrentFrame();
  const step = seconds(0.25);
  const k = enter(frame, delay);
  const t = enter(frame, delay + step);
  const s = enter(frame, delay + step * 2);
  const rule = interpolate(enter(frame, delay + step * 1.5), [0, 1], [0, 120]);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: `0 200px ${lift * 2}px`,
        textAlign: "center",
      }}
    >
      {kicker ? (
        <div
          style={{
            fontFamily: font.mono,
            fontSize: type.label,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: color.accent,
            opacity: k,
            transform: `translateY(${(1 - k) * 16}px)`,
            marginBottom: 36,
          }}
        >
          {kicker}
        </div>
      ) : null}
      <div
        style={{
          fontSize: type.display,
          fontWeight: weight.semibold,
          letterSpacing: "-0.03em",
          lineHeight: 1.05,
          opacity: t,
          transform: `translateY(${(1 - t) * 24}px)`,
          textWrap: "balance",
        }}
      >
        <Rich text={title} />
      </div>
      <div style={{ height: 2, width: rule, background: color.accentLine, margin: "48px 0 40px" }} />
      {subtitle ? (
        <div
          style={{
            fontSize: type.body,
            color: color.textMuted,
            lineHeight: 1.4,
            maxWidth: 1300,
            opacity: s,
            transform: `translateY(${(1 - s) * 16}px)`,
            textWrap: "balance",
          }}
        >
          <Rich text={subtitle} />
        </div>
      ) : null}
    </div>
  );
};
