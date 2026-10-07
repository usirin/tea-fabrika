import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { color, enter, font, layout, Rich, type, weight } from "../../design";

/**
 * Small parts that chapters 5, 6 and 7 share and the design system lacks:
 * a kicker line, a big text stat, a pill, a card, and an absolutely placed box.
 */

export const Kicker: React.FC<{ text: string; at?: number; accent?: boolean; style?: CSSProperties }> = ({
  text,
  at = 0,
  accent,
  style,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: type.label,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: accent ? color.accent : color.textMuted,
        opacity: enter(frame, at),
        ...style,
      }}
    >
      {text}
    </div>
  );
};

/** A big line of text in the Counter's style, for a value that is not a number ("about half"). */
export const Stat: React.FC<{ text: string; label?: string; at?: number; accent?: boolean; size?: number }> = ({
  text,
  label,
  at = 0,
  accent,
  size = 168,
}) => {
  const frame = useCurrentFrame();
  const s = enter(frame, at);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        opacity: s,
        transform: `translateY(${(1 - s) * 18}px)`,
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: size,
          fontWeight: weight.medium,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: accent ? color.accent : color.text,
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
      {label ? (
        <div
          style={{
            marginTop: 24,
            fontSize: type.label + 4,
            color: color.textMuted,
            textAlign: "center",
            maxWidth: 560,
            lineHeight: 1.3,
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};

/** A rounded pill. `accent` gives it the soft accent fill; `faint` is for something nobody wrote. */
export const Pill: React.FC<{
  text: string;
  at?: number;
  accent?: boolean;
  faint?: boolean;
  mono?: boolean;
  style?: CSSProperties;
}> = ({ text, at = 0, accent, faint, mono = true, style }) => {
  const frame = useCurrentFrame();
  const s = enter(frame, at);
  return (
    <div
      style={{
        display: "inline-block",
        fontFamily: mono ? font.mono : font.sans,
        fontSize: type.label,
        lineHeight: 1.2,
        color: accent ? color.text : faint ? color.textMuted : color.text,
        background: accent ? color.accentSoft : faint ? "transparent" : color.surfaceRaised,
        border: `2px ${faint ? "dashed" : "solid"} ${accent ? color.accentLine : color.line}`,
        borderRadius: 14,
        padding: "12px 24px",
        whiteSpace: "nowrap",
        opacity: s * (faint ? 0.75 : 1),
        transform: `translateY(${(1 - s) * 12}px)`,
        ...style,
      }}
    >
      <Rich text={text} />
    </div>
  );
};

/** A surface card that rises in. */
export const Card: React.FC<{
  at?: number;
  accent?: boolean;
  muted?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}> = ({ at = 0, accent, muted, style, children }) => {
  const frame = useCurrentFrame();
  const s = enter(frame, at);
  return (
    <div
      style={{
        background: accent ? color.accentSoft : color.surface,
        border: `2px solid ${accent ? color.accent : color.line}`,
        borderRadius: layout.radius,
        padding: "28px 36px",
        opacity: s * (muted ? 0.45 : 1),
        transform: `translateY(${(1 - s) * 18}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Fills the visual area and lets children place themselves absolutely. */
export const Canvas: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div style={{ position: "relative", width: "100%", height: "100%" }}>{children}</div>
);
