import type { Caption } from "@remotion/captions";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import captionData from "./captions.json";

const captions = captionData as Caption[];

export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeMs = (frame / fps) * 1000;
  const caption = captions.find((item) => timeMs >= item.startMs && timeMs < item.endMs);
  if (!caption) return null;

  const localFrame = frame - (caption.startMs / 1000) * fps;
  const duration = ((caption.endMs - caption.startMs) / 1000) * fps;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: "0 80px 84px", pointerEvents: "none" }}>
      <div
        style={{
          background: "rgba(18,23,20,.94)",
          border: "1px solid rgba(255,255,255,.12)",
          borderRadius: 14,
          boxShadow: "0 14px 40px rgba(0,0,0,.24)",
          color: "#fffef9",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 27,
          fontWeight: 700,
          lineHeight: 1.2,
          maxWidth: 1020,
          opacity: interpolate(localFrame, [0, 6, Math.max(7, duration - 6), duration], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          padding: "12px 22px 14px",
          textAlign: "center",
        }}
      >
        {caption.text}
      </div>
    </AbsoluteFill>
  );
};
