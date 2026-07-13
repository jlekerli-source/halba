import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Captions } from "./Captions";

const colors = {
  ink: "#121714",
  paper: "#f7f5ee",
  raised: "#fffef9",
  muted: "#6f756f",
  teal: "#087e70",
  red: "#b6382e",
  amber: "#b66a16",
  violet: "#6750a4",
};

const displayFont = '"Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", sans-serif';
const bodyFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

type ProductSceneProps = {
  duration: number;
  eyebrow: string;
  headline: string;
  supporting: string;
  screenshot: string;
  objectPosition?: string;
  accent?: string;
};

const GridBackground: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: colors.paper,
      backgroundImage:
        "linear-gradient(rgba(18,23,20,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(18,23,20,.035) 1px, transparent 1px)",
      backgroundSize: "28px 28px",
    }}
  />
);

const Brand: React.FC<{ inverse?: boolean }> = ({ inverse = false }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
    <Img
      src={staticFile("demo/halba-icon.svg")}
      style={{ width: 64, height: 64, borderRadius: 16 }}
    />
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <strong
        style={{
          color: inverse ? colors.paper : colors.ink,
          fontFamily: displayFont,
          fontSize: 36,
          lineHeight: 1,
        }}
      >
        Halba
      </strong>
      <span
        style={{
          color: inverse ? "rgba(247,245,238,.62)" : colors.muted,
          fontFamily: bodyFont,
          fontSize: 15,
          fontWeight: 800,
          letterSpacing: 3,
          textTransform: "uppercase",
        }}
      >
        Proof Mode
      </span>
    </div>
  </div>
);

const TitleScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: colors.ink, padding: "70px 86px 108px" }}>
      <div
        style={{
          opacity: interpolate(frame, [0, 22], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: `0 ${interpolate(frame, [0, 28], [24, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}px`,
        }}
      >
        <Brand inverse />
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "center",
          maxWidth: 1040,
          opacity: interpolate(frame, [16, 48, duration - 22, duration], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: `0 ${interpolate(frame, [16, 48], [34, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}px`,
        }}
      >
        <p
          style={{
            color: "#72d1c4",
            fontFamily: bodyFont,
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: 4,
            margin: "0 0 26px",
            textTransform: "uppercase",
          }}
        >
          The expensive question after “done”
        </p>
        <h1
          style={{
            color: colors.paper,
            fontFamily: displayFont,
            fontSize: 112,
            letterSpacing: -5,
            lineHeight: 0.92,
            margin: 0,
          }}
        >
          Can this agent claim
          <br />
          pass human review?
        </h1>
      </div>
      <div
        style={{
          background: colors.teal,
          borderRadius: 999,
          bottom: 54,
          height: 16,
          opacity: interpolate(frame, [36, 70], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          position: "absolute",
          right: 72,
          scale: interpolate(frame, [36, 70], [0.2, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          width: 220,
        }}
      />
    </AbsoluteFill>
  );
};

const ProductScene: React.FC<ProductSceneProps> = ({
  duration,
  eyebrow,
  headline,
  supporting,
  screenshot,
  objectPosition = "center",
  accent = colors.teal,
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: colors.paper }}>
      <GridBackground />
      <div
        style={{
          inset: "46px 56px 102px",
          overflow: "hidden",
          position: "absolute",
          borderRadius: 28,
          backgroundColor: colors.raised,
          boxShadow: "0 28px 80px rgba(18,23,20,.22), 0 0 0 1px rgba(18,23,20,.12)",
          opacity: interpolate(frame, [0, 18, duration - 18, duration], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [0, duration], [0.985, 1.025], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Img
          src={staticFile(`screenshots/${screenshot}`)}
          style={{
            height: "100%",
            objectFit: "cover",
            objectPosition,
            width: "100%",
          }}
        />
        <AbsoluteFill
          style={{
            background: "linear-gradient(90deg, rgba(18,23,20,.93) 0%, rgba(18,23,20,.83) 31%, rgba(18,23,20,.08) 62%, transparent 78%)",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 22,
            left: 54,
            maxWidth: 480,
            position: "absolute",
            top: 54,
            opacity: interpolate(frame, [10, 38], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: `${interpolate(frame, [10, 38], [-34, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px 0`,
          }}
        >
          <p
            style={{
              color: "#76d4c6",
              fontFamily: bodyFont,
              fontSize: 22,
              fontWeight: 850,
              letterSpacing: 3.4,
              margin: 0,
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </p>
          <h2
            style={{
              color: colors.paper,
              fontFamily: displayFont,
              fontSize: 66,
              letterSpacing: -2,
              lineHeight: 0.96,
              margin: 0,
            }}
          >
            {headline}
          </h2>
          <p
            style={{
              color: "rgba(247,245,238,.78)",
              fontFamily: bodyFont,
              fontSize: 27,
              lineHeight: 1.34,
              margin: 0,
              maxWidth: 430,
            }}
          >
            {supporting}
          </p>
          <span style={{ background: accent, borderRadius: 999, height: 8, marginTop: 4, width: 112 }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EvalScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const metrics = [
    ["9 / 9", "golden cases"],
    ["100%", "verdict accuracy"],
    ["100%", "grounding precision"],
    ["0%", "false positives"],
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: colors.paper, padding: "58px 74px 112px" }}>
      <GridBackground />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          position: "relative",
          opacity: interpolate(frame, [0, 20, duration - 18, duration], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div style={{ maxWidth: 760 }}>
          <p style={{ color: colors.teal, fontFamily: bodyFont, fontSize: 22, fontWeight: 850, letterSpacing: 3.2, margin: "0 0 18px", textTransform: "uppercase" }}>
            Repeatable evals
          </p>
          <h2 style={{ color: colors.ink, fontFamily: displayFont, fontSize: 82, letterSpacing: -3, lineHeight: 0.95, margin: 0 }}>
            Proof that can fail
            <br />
            before a judge sees it.
          </h2>
        </div>
        <Brand />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18, marginTop: 54, position: "relative" }}>
        {metrics.map(([value, label], index) => (
          <div
            key={label}
            style={{
              background: index === 0 ? colors.ink : colors.raised,
              border: `1px solid ${index === 0 ? colors.ink : "rgba(18,23,20,.12)"}`,
              borderRadius: 24,
              minHeight: 210,
              padding: "30px 28px",
              opacity: interpolate(frame, [24 + index * 8, 52 + index * 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: `0 ${interpolate(frame, [24 + index * 8, 52 + index * 8], [28, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              })}px`,
            }}
          >
            <strong style={{ color: index === 0 ? "#76d4c6" : colors.teal, display: "block", fontFamily: displayFont, fontSize: 78, lineHeight: 1 }}>
              {value}
            </strong>
            <span style={{ color: index === 0 ? "rgba(247,245,238,.7)" : colors.muted, display: "block", fontFamily: bodyFont, fontSize: 24, fontWeight: 750, lineHeight: 1.2, marginTop: 22 }}>
              {label}
            </span>
          </div>
        ))}
      </div>
      <p style={{ bottom: 136, color: colors.muted, fontFamily: bodyFont, fontSize: 22, margin: 0, position: "absolute" }}>
        Replay metrics validate the adjudication contract—not unmeasured live-model quality.
      </p>
    </AbsoluteFill>
  );
};

const OutroScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ alignItems: "center", backgroundColor: colors.ink, justifyContent: "center", padding: "70px 90px 112px" }}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          opacity: interpolate(frame, [0, 24, duration - 16, duration], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          textAlign: "center",
        }}
      >
        <Brand inverse />
        <h2 style={{ color: colors.paper, fontFamily: displayFont, fontSize: 92, letterSpacing: -4, lineHeight: 0.94, margin: "48px 0 28px" }}>
          Agent claims in.
          <br />
          Traceable proof out.
        </h2>
        <p style={{ color: "rgba(247,245,238,.68)", fontFamily: bodyFont, fontSize: 30, lineHeight: 1.3, margin: 0 }}>
          jlekerli-source.github.io/halba
        </p>
      </div>
    </AbsoluteFill>
  );
};

export const HalbaBuildWeek: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={7 * fps}>
        <TitleScene duration={7 * fps} />
      </Sequence>
      <Sequence from={7 * fps} durationInFrames={12 * fps}>
        <ProductScene
          duration={12 * fps}
          eyebrow="One bounded packet"
          headline="Evidence, not another chat."
          supporting="Reports, diffs, source files, and machine receipts stay local, hashed, and line-addressable."
          screenshot="onboarding-desktop.png"
          objectPosition="center"
        />
      </Sequence>
      <Sequence from={19 * fps} durationInFrames={15 * fps}>
        <ProductScene
          duration={15 * fps}
          eyebrow="Inference meets authority"
          headline="GPT proposes. Halba checks."
          supporting="GPT-5.6 extracts claims and citations. Deterministic guards own exact facts and can override model confidence."
          screenshot="proof-desktop.png"
          objectPosition="center top"
          accent={colors.red}
        />
      </Sequence>
      <Sequence from={34 * fps} durationInFrames={14 * fps}>
        <ProductScene
          duration={14 * fps}
          eyebrow="Open the actual change"
          headline="The proof is the source."
          supporting="The real Build Week stale-clock patch opens at the exact line range beside its hash, boundary, and guard result."
          screenshot="proof-diff-desktop.png"
          objectPosition="right top"
          accent={colors.amber}
        />
      </Sequence>
      <Sequence from={48 * fps} durationInFrames={11 * fps}>
        <ProductScene
          duration={11 * fps}
          eyebrow="Human review stays human"
          headline="Resolve only what needs judgment."
          supporting="Approve, reject, or resolve locally. Halba keeps every unsupported, stale, contradictory, and uncertain claim visible."
          screenshot="review-resolved-desktop.png"
          objectPosition="center top"
          accent={colors.violet}
        />
      </Sequence>
      <Sequence from={59 * fps} durationInFrames={10 * fps}>
        <EvalScene duration={10 * fps} />
      </Sequence>
      <Sequence from={69 * fps} durationInFrames={9 * fps}>
        <OutroScene duration={9 * fps} />
      </Sequence>
      <Audio src={staticFile("demo/narration.m4a")} volume={1} />
      <Captions />
    </AbsoluteFill>
  );
};
