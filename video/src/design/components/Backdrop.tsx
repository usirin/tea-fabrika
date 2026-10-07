import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { color, font, stage } from "../tokens";

/** The background every frame sits on: near-black with a faint warm glow up top. */
export const Backdrop: React.FC<{ children?: ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: color.bg,
      backgroundImage: `radial-gradient(ellipse 70% 55% at 50% 0%, ${color.bgGlow} 0%, ${color.bg} 70%)`,
      color: color.text,
      fontFamily: font.sans,
    }}
  >
    {children}
  </AbsoluteFill>
);

/**
 * The box a scene's visual lives in: above the caption band, inside the side
 * padding. Children are centred by default.
 */
export const VisualArea: React.FC<{ children?: ReactNode; style?: CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      position: "absolute",
      left: stage.x,
      top: stage.y,
      width: stage.width,
      height: stage.height,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      ...style,
    }}
  >
    {children}
  </div>
);
