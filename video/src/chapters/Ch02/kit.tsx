import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { color, enter, font, layout, progress, seconds, type, weight } from "../../design";

/**
 * Small parts that chapters 2 to 4 share and the design system lacks: a
 * kicker line, a card, a pill, and cross-fades between two layouts in one
 * scene. Kept here so the shared design folder stays untouched.
 */

/** 1 before `at`, fading to 0 after it. For the layout a scene leaves. */
export const fadeOutAt = (frame: number, at: number, dur = seconds(0.4)): number => 1 - progress(frame, at, dur);

/** A full-stage layer, so two layouts can sit on top of each other and cross-fade. */
export const Layer: React.FC<{ opacity?: number; children: ReactNode; style?: CSSProperties }> = ({
  opacity = 1,
  children,
  style,
}) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      opacity,
      ...style,
    }}
  >
    {children}
  </div>
);

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

/** A box with a line or two of text. `lit` (0..1) fades its border and title into the accent. */
export const Card: React.FC<{
  at?: number;
  lit?: number;
  muted?: boolean;
  width?: number;
  height?: number;
  children: ReactNode;
  style?: CSSProperties;
}> = ({ at = 0, lit = 0, muted, width, height, children, style }) => {
  const frame = useCurrentFrame();
  const s = enter(frame, at);
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        boxSizing: "border-box",
        borderRadius: layout.radius,
        background: lit > 0 ? `rgba(232, 180, 79, ${0.14 * lit})` : color.surface,
        border: `2px solid ${lit > 0 ? `rgba(232, 180, 79, ${0.25 + 0.75 * lit})` : color.line}`,
        padding: "28px 36px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        opacity: s * (muted ? 0.5 : 1),
        transform: `translateY(${(1 - s) * 18}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const CardTitle: React.FC<{ children: ReactNode; accent?: number; mono?: boolean; size?: number }> = ({
  children,
  accent = 0,
  mono,
  size = type.label + 8,
}) => (
  <div
    style={{
      fontFamily: mono ? font.mono : font.sans,
      fontSize: size,
      fontWeight: mono ? weight.medium : weight.semibold,
      lineHeight: 1.2,
      color: accent > 0.5 ? color.accent : color.text,
      fontVariantLigatures: "none",
    }}
  >
    {children}
  </div>
);

export const CardSub: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div style={{ marginTop: 10, fontSize: type.label - 2, color: color.textMuted, lineHeight: 1.3 }}>{children}</div>
);

/** A rounded tag, e.g. a price or a status. */
export const Pill: React.FC<{ text: string; at?: number; accent?: boolean; mono?: boolean; style?: CSSProperties }> = ({
  text,
  at = 0,
  accent,
  mono = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const s = enter(frame, at);
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: mono ? font.mono : font.sans,
        fontSize: type.label,
        color: accent ? color.accent : color.text,
        background: accent ? color.accentSoft : color.surfaceRaised,
        border: `2px solid ${accent ? color.accentLine : color.line}`,
        borderRadius: 999,
        padding: "10px 28px",
        whiteSpace: "nowrap",
        fontVariantLigatures: "none",
        opacity: s,
        transform: `translateY(${(1 - s) * 12}px)`,
        ...style,
      }}
    >
      {text}
    </span>
  );
};

/** Row height BarChart uses for `n` bars, so overlays can line up with it. */
export const barRowHeight = (n: number): number => (n > 4 ? 84 : 104);
/** Height BarChart's title takes, label line plus its margin. */
export const BAR_TITLE_HEIGHT = 39 + 32;
