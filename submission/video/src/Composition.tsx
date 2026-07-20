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
  ink: "#091815",
  inkSoft: "#20312c",
  paper: "#f4f6f1",
  raised: "#fffef9",
  muted: "#68736d",
  teal: "#008b79",
  tealDark: "#05695d",
  signal: "#65e8ca",
  red: "#d34a3d",
  redSoft: "#f6ddd8",
  amber: "#d98a2b",
  amberSoft: "#f7e7ca",
  violet: "#7158bd",
};

const displayFont = '"Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", sans-serif';
const bodyFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const monoFont = '"SFMono-Regular", Consolas, monospace';
const ease = Easing.bezier(0.16, 1, 0.3, 1);

const enter = (frame: number, from = 0, duration = 24) =>
  interpolate(frame, [from, from + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

const exit = (frame: number, duration: number, length = 14) =>
  interpolate(frame, [duration - length, duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

type GlyphName = "claim" | "source" | "guard" | "human" | "check" | "split" | "clock" | "receipt" | "diff";

const Glyph: React.FC<{ name: GlyphName; size?: number }> = ({ name, size = 28 }) => {
  const paths: Record<GlyphName, React.ReactNode> = {
    claim: <><circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="m10.2 10.2 3.6 3.6"/></>,
    source: <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 13h5M10 17h5"/></>,
    guard: <><path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6z"/><path d="m9 12 2 2 4-5"/></>,
    human: <><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.5-4.2 2.7-6.3 6.5-6.3s6 2.1 6.5 6.3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    split: <><path d="M5 6h4c4 0 3 12 7 12h3M16 15l3 3-3 3M5 18h4c2 0 2-3 3-6M16 3l3 3-3 3"/></>,
    clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
    receipt: <><path d="M7 3h10v18l-2-1.5L13 21l-2-1.5L9 21l-2-1.5z"/><path d="M10 8h4M10 12h4"/></>,
    diff: <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 12h5M10 16h2M14 16h3"/></>,
  };
  return <svg viewBox="0 0 24 24" style={{ fill: "none", height: size, stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.75, width: size }}>{paths[name]}</svg>;
};

const Background: React.FC<{ dark?: boolean }> = ({ dark = false }) => {
  const frame = useCurrentFrame();
  const scan = interpolate(frame, [0, 240], [-180, 1440], { extrapolateRight: "extend" });
  return <AbsoluteFill style={{
    backgroundColor: dark ? colors.ink : colors.paper,
    backgroundImage: dark
      ? "linear-gradient(rgba(101,232,202,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(101,232,202,.045) 1px, transparent 1px)"
      : "linear-gradient(rgba(9,24,21,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(9,24,21,.035) 1px, transparent 1px)",
    backgroundSize: "32px 32px",
  }}>
    <div style={{ background: dark ? "linear-gradient(90deg, transparent, rgba(101,232,202,.13), transparent)" : "linear-gradient(90deg, transparent, rgba(0,139,121,.12), transparent)", height: "100%", left: scan, position: "absolute", top: 0, width: 240 }} />
  </AbsoluteFill>;
};

const Brand: React.FC<{ inverse?: boolean; compact?: boolean }> = ({ inverse = false, compact = false }) => (
  <div style={{ alignItems: "center", display: "flex", gap: compact ? 11 : 15 }}>
    <Img src={staticFile("demo/halba-icon.svg")} style={{ borderRadius: compact ? 12 : 16, height: compact ? 44 : 60, width: compact ? 44 : 60 }} />
    <div style={{ display: "grid" }}>
      <strong style={{ color: inverse ? colors.paper : colors.ink, fontFamily: displayFont, fontSize: compact ? 30 : 38, letterSpacing: -1.3, lineHeight: .9 }}>Halba</strong>
      <span style={{ color: inverse ? "rgba(244,246,241,.55)" : colors.muted, fontFamily: bodyFont, fontSize: compact ? 11 : 13, fontWeight: 850, letterSpacing: 2.5, marginTop: 6, textTransform: "uppercase" }}>Trust Operations</span>
    </div>
  </div>
);

const SceneLabel: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({ children, dark = false }) => (
  <span style={{ color: dark ? colors.signal : colors.tealDark, fontFamily: bodyFont, fontSize: 18, fontWeight: 900, letterSpacing: 3.2, textTransform: "uppercase" }}>{children}</span>
);

const ColdOpen: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const stamp = enter(frame, 74, 16);
  return <AbsoluteFill style={{ color: colors.paper, padding: "54px 72px 98px" }}>
    <Background dark />
    <div style={{ opacity: enter(frame, 0, 18), position: "relative" }}><Brand inverse compact /></div>
    <div style={{ alignItems: "center", display: "grid", flex: 1, gridTemplateColumns: "1.12fr .88fr", gap: 54, opacity: exit(frame, duration), position: "relative" }}>
      <div>
        <SceneLabel dark>The expensive word in AI work</SceneLabel>
        <h1 style={{ fontFamily: displayFont, fontSize: 122, letterSpacing: -5.5, lineHeight: .82, margin: "26px 0 0", opacity: enter(frame, 12, 26), translate: `0 ${interpolate(frame, [12, 38], [30, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease })}px` }}>
          “DONE”
          <span style={{ color: colors.signal, display: "block" }}>IS A CLAIM.</span>
        </h1>
      </div>
      <div style={{ position: "relative" }}>
        <div style={{ background: colors.raised, borderRadius: 22, boxShadow: "0 30px 80px rgba(0,0,0,.32)", color: colors.ink, opacity: enter(frame, 30, 22), padding: "28px 30px", rotate: "-2deg", translate: `${interpolate(frame, [30, 52], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease })}px 0` }}>
          <span style={{ color: colors.tealDark, fontFamily: bodyFont, fontSize: 14, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>Agent completion report</span>
          <p style={{ fontFamily: displayFont, fontSize: 39, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1.05, margin: "20px 0 24px" }}>“The release artifact is verified and ready to ship.”</p>
          <code style={{ background: "#e6ebe5", borderRadius: 11, display: "block", fontFamily: monoFont, fontSize: 18, padding: "16px 18px" }}>deterministic verdict: <b style={{ color: colors.red }}>contradictory</b></code>
        </div>
        <div style={{ background: colors.red, borderRadius: 10, bottom: -32, boxShadow: "0 18px 30px rgba(211,74,61,.3)", color: "white", fontFamily: bodyFont, fontSize: 24, fontWeight: 950, letterSpacing: 3, opacity: stamp, padding: "18px 26px", position: "absolute", right: 18, rotate: `${interpolate(stamp, [0, 1], [8, -4])}deg`, scale: interpolate(stamp, [0, 1], [.7, 1]), textTransform: "uppercase" }}>Contradiction</div>
      </div>
    </div>
  </AbsoluteFill>;
};

const TraceRail: React.FC<{ frame: number; dark?: boolean }> = ({ frame, dark = false }) => {
  const steps: Array<[GlyphName, string, string]> = [
    ["claim", "Claim", "Extract"],
    ["source", "Source", "Locate"],
    ["guard", "Guard", "Verify"],
    ["human", "Human", "Decide"],
  ];
  const width = interpolate(frame, [18, 94], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", marginTop: 44, position: "relative" }}>
    <div style={{ background: dark ? "rgba(101,232,202,.18)" : "rgba(9,24,21,.12)", height: 2, left: "9%", position: "absolute", right: "9%", top: 31 }} />
    <div style={{ background: `linear-gradient(90deg, ${colors.teal}, ${colors.signal})`, height: 3, left: "9%", position: "absolute", top: 31, width: `${width * .82}%` }} />
    {steps.map(([name, title, verb], index) => {
      const progress = enter(frame, 14 + index * 18, 18);
      return <div key={title} style={{ alignItems: "center", color: dark ? colors.paper : colors.ink, display: "flex", flexDirection: "column", opacity: progress, position: "relative", translate: `0 ${interpolate(progress, [0, 1], [18, 0])}px` }}>
        <div style={{ alignItems: "center", background: index <= Math.floor((width / 100) * 4) ? colors.teal : dark ? colors.inkSoft : colors.raised, borderRadius: 999, boxShadow: `0 0 0 2px ${dark ? colors.ink : colors.paper}, 0 0 0 3px ${dark ? "rgba(101,232,202,.32)" : "rgba(9,24,21,.14)"}`, color: index <= Math.floor((width / 100) * 4) ? "white" : colors.tealDark, display: "flex", height: 64, justifyContent: "center", width: 64 }}><Glyph name={name} size={30} /></div>
        <strong style={{ fontFamily: bodyFont, fontSize: 17, marginTop: 17 }}>{title}</strong>
        <span style={{ color: dark ? "rgba(244,246,241,.52)" : colors.muted, fontFamily: monoFont, fontSize: 13, marginTop: 5 }}>{verb}</span>
      </div>;
    })}
  </div>;
};

const PacketScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const files: Array<[GlyphName, string, string]> = [
    ["guard", "3 workspaces", "local only"],
    ["claim", "120 runs", "public-safe benchmark"],
    ["human", "11 attention items", "deterministically ranked"],
  ];
  return <AbsoluteFill style={{ padding: "52px 72px 104px" }}>
    <Background />
    <div style={{ display: "flex", justifyContent: "space-between", opacity: exit(frame, duration), position: "relative" }}>
      <div style={{ maxWidth: 760 }}>
        <SceneLabel>Cross-workspace trust operations</SceneLabel>
        <h2 style={{ color: colors.ink, fontFamily: displayFont, fontSize: 86, letterSpacing: -3.2, lineHeight: .92, margin: "20px 0 0", opacity: enter(frame, 4, 24) }}>Every risky “done”<br />in one queue.</h2>
      </div>
      <Brand compact />
    </div>
    <TraceRail frame={frame} />
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(3, 1fr)", marginTop: 40, opacity: exit(frame, duration), position: "relative" }}>
      {files.map(([name, file, meta], index) => <div key={file} style={{ alignItems: "center", background: colors.raised, borderRadius: 18, boxShadow: "0 0 0 1px rgba(9,24,21,.08), 0 18px 30px -24px rgba(9,24,21,.45)", display: "flex", gap: 16, opacity: enter(frame, 60 + index * 10, 20), padding: "20px 22px", translate: `0 ${interpolate(enter(frame, 60 + index * 10, 20), [0, 1], [24, 0])}px` }}>
        <span style={{ alignItems: "center", background: "#d3ebe4", borderRadius: 12, color: colors.tealDark, display: "flex", height: 48, justifyContent: "center", width: 48 }}><Glyph name={name} size={24} /></span>
        <span style={{ display: "grid" }}><strong style={{ color: colors.ink, fontFamily: bodyFont, fontSize: 17 }}>{file}</strong><small style={{ color: colors.muted, fontFamily: monoFont, fontSize: 13, marginTop: 5 }}>{meta}</small></span>
      </div>)}
    </div>
  </AbsoluteFill>;
};

const AppScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ padding: "42px 52px 100px" }}>
    <Background />
    <div style={{ alignItems: "center", display: "flex", gap: 24, justifyContent: "space-between", opacity: exit(frame, duration), position: "relative" }}>
      <div><SceneLabel>Trust Inbox</SceneLabel><h2 style={{ color: colors.ink, fontFamily: displayFont, fontSize: 66, letterSpacing: -2.5, lineHeight: .9, margin: "12px 0 0" }}>The highest-risk claim comes first.</h2></div>
      <div style={{ background: "#d3ebe4", borderRadius: 999, color: colors.tealDark, fontFamily: monoFont, fontSize: 14, fontWeight: 800, padding: "13px 18px" }}>model prose · zero authority</div>
    </div>
    <div style={{ background: colors.raised, borderRadius: 22, boxShadow: "0 28px 80px rgba(9,24,21,.2), 0 0 0 1px rgba(9,24,21,.1)", height: 470, marginTop: 28, opacity: enter(frame, 8, 22) * exit(frame, duration), overflow: "hidden", position: "relative", scale: interpolate(frame, [0, duration], [.99, 1.018], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }) }}>
      <Img src={staticFile("screenshots/trust-inbox-desktop.png")} style={{ height: "100%", objectFit: "cover", objectPosition: "center 20%", width: "100%" }} />
      <div style={{ background: `linear-gradient(90deg, ${colors.teal}, ${colors.signal})`, bottom: 0, height: 5, left: 0, width: `${interpolate(frame, [12, duration - 20], [8, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}%`, position: "absolute" }} />
    </div>
  </AbsoluteFill>;
};

const OverrideScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const override = enter(frame, 72, 18);
  return <AbsoluteFill style={{ color: colors.paper, padding: "48px 70px 104px" }}>
    <Background dark />
    <div style={{ display: "flex", justifyContent: "space-between", opacity: exit(frame, duration), position: "relative" }}><div><SceneLabel dark>Example 2 · different claim · source-backed packet</SceneLabel><h2 style={{ fontFamily: displayFont, fontSize: 78, letterSpacing: -3, lineHeight: .9, margin: "16px 0 0" }}>Language proposes.<br /><span style={{ color: colors.signal }}>Evidence decides.</span></h2></div><Brand inverse compact /></div>
    <div style={{ alignItems: "stretch", display: "grid", gap: 22, gridTemplateColumns: "1fr 76px 1fr", marginTop: 40, opacity: exit(frame, duration), position: "relative" }}>
      <div style={{ background: "rgba(255,255,255,.07)", borderRadius: 22, boxShadow: "0 0 0 1px rgba(255,255,255,.09)", opacity: enter(frame, 18, 22), padding: "26px 28px" }}>
        <span style={{ alignItems: "center", color: colors.signal, display: "flex", fontFamily: bodyFont, fontSize: 14, fontWeight: 900, gap: 9, letterSpacing: 2, textTransform: "uppercase" }}><Glyph name="claim" size={22} /> Model assessment</span>
        <p style={{ fontFamily: displayFont, fontSize: 42, letterSpacing: -1.4, lineHeight: 1.02, margin: "23px 0" }}>“Generated by a live GPT-5.6 request.”</p>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}><span style={{ color: "rgba(244,246,241,.55)", fontFamily: monoFont, fontSize: 14 }}>confidence</span><strong style={{ color: colors.signal, fontFamily: displayFont, fontSize: 44 }}>100%</strong></div>
      </div>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "center" }}><div style={{ background: colors.teal, borderRadius: 999, height: 64, scale: enter(frame, 48, 16), width: 8 }} /></div>
      <div style={{ background: colors.raised, borderRadius: 22, color: colors.ink, opacity: enter(frame, 38, 22), padding: "26px 28px" }}>
        <span style={{ alignItems: "center", color: colors.tealDark, display: "flex", fontFamily: bodyFont, fontSize: 14, fontWeight: 900, gap: 9, letterSpacing: 2, textTransform: "uppercase" }}><Glyph name="receipt" size={22} /> Machine receipt</span>
        <code style={{ background: "#e6ebe5", borderRadius: 12, display: "block", fontFamily: monoFont, fontSize: 20, lineHeight: 1.65, marginTop: 23, padding: "20px" }}>{'{'}<br />&nbsp;&nbsp;"model": "gpt-5.6-sol",<br />&nbsp;&nbsp;"mode": <b style={{ color: colors.red }}>"recorded"</b><br />{'}'}</code>
        <span style={{ color: colors.tealDark, display: "block", fontFamily: monoFont, fontSize: 13, marginTop: 18 }}>exact quote · hash verified</span>
      </div>
    </div>
    <div style={{ alignItems: "center", background: colors.red, borderRadius: 999, color: "white", display: "flex", fontFamily: bodyFont, fontSize: 14, fontWeight: 950, gap: 8, left: 892, letterSpacing: 2, opacity: override, padding: "11px 16px", position: "absolute", scale: interpolate(override, [0, 1], [.7, 1]), textTransform: "uppercase", top: 226 }}><Glyph name="split" size={19} /> Contradiction</div>
  </AbsoluteFill>;
};

const SourceScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const focus = enter(frame, 38, 24);
  return <AbsoluteFill style={{ padding: "44px 54px 100px" }}>
    <Background />
    <div style={{ display: "flex", justifyContent: "space-between", opacity: exit(frame, duration), position: "relative" }}><div><SceneLabel>Open the actual change</SceneLabel><h2 style={{ color: colors.ink, fontFamily: displayFont, fontSize: 68, letterSpacing: -2.6, lineHeight: .9, margin: "12px 0 0" }}>The proof is the source.</h2></div><div style={{ alignItems: "center", color: colors.tealDark, display: "flex", fontFamily: monoFont, fontSize: 14, gap: 8 }}><Glyph name="diff" size={22} />diffs/stale-review-clock.patch · L18–L27</div></div>
    <div style={{ background: colors.raised, borderRadius: 22, boxShadow: "0 28px 72px rgba(9,24,21,.2)", height: 486, marginTop: 26, opacity: enter(frame, 5, 20) * exit(frame, duration), overflow: "hidden", position: "relative" }}>
      <Img src={staticFile("screenshots/proof-diff-desktop.png")} style={{ height: "100%", objectFit: "cover", objectPosition: "right top", scale: interpolate(frame, [0, duration], [1.03, 1.1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }), width: "100%" }} />
      <div style={{ background: "rgba(255,254,249,.97)", borderRadius: 16, boxShadow: "0 18px 50px rgba(9,24,21,.28), 0 0 0 2px rgba(0,139,121,.28)", left: 48, opacity: focus, padding: "20px 22px", position: "absolute", top: 176, translate: `${interpolate(focus, [0, 1], [-24, 0])}px 0`, width: 520 }}>
        <span style={{ color: colors.tealDark, fontFamily: bodyFont, fontSize: 13, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>Exact source boundary</span>
        <code style={{ color: colors.ink, display: "block", fontFamily: monoFont, fontSize: 17, lineHeight: 1.6, marginTop: 12 }}><b style={{ color: colors.teal }}>+ now = new Date()</b><br />+ staleBefore = subtractHours(now, 48)<br />+ compare(receipt.generatedAt, staleBefore)</code>
        <div style={{ alignItems: "center", color: colors.tealDark, display: "flex", fontFamily: monoFont, fontSize: 12, gap: 8, marginTop: 14 }}><Glyph name="check" size={18} /> exact quote · sha256 verified</div>
      </div>
    </div>
  </AbsoluteFill>;
};

const HumanScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const resolve = enter(frame, 58, 18);
  return <AbsoluteFill style={{ color: colors.paper, padding: "50px 72px 104px" }}>
    <Background dark />
    <div style={{ display: "flex", justifyContent: "space-between", opacity: exit(frame, duration), position: "relative" }}><div><SceneLabel dark>Human review stays human</SceneLabel><h2 style={{ fontFamily: displayFont, fontSize: 78, letterSpacing: -3, lineHeight: .9, margin: "16px 0 0" }}>Only the boundary<br />needs your judgment.</h2></div><Brand inverse compact /></div>
    <div style={{ alignItems: "center", display: "grid", gap: 40, gridTemplateColumns: "1.2fr .8fr", marginTop: 44, opacity: exit(frame, duration), position: "relative" }}>
      <div style={{ background: colors.raised, borderRadius: 22, color: colors.ink, opacity: enter(frame, 16, 22), padding: "27px 30px" }}>
        <span style={{ color: colors.red, fontFamily: bodyFont, fontSize: 14, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>Contradiction · deterministic</span>
        <p style={{ fontFamily: displayFont, fontSize: 45, letterSpacing: -1.5, lineHeight: 1, margin: "20px 0 26px" }}>“The release artifact is verified and ready to ship.”</p>
        <div style={{ display: "grid", gap: 9, gridTemplateColumns: "repeat(3, 1fr)" }}>
          {["Approve", "Reject", "Request proof"].map((label) => <span key={label} style={{ background: label === "Request proof" && resolve > .5 ? colors.violet : "#edf0eb", borderRadius: 10, color: label === "Request proof" && resolve > .5 ? "white" : colors.ink, fontFamily: bodyFont, fontSize: 15, fontWeight: 850, padding: "15px", textAlign: "center" }}>{label}</span>)}
        </div>
      </div>
      <div style={{ alignItems: "center", display: "flex", flexDirection: "column", opacity: resolve, textAlign: "center" }}>
        <div style={{ alignItems: "center", background: colors.signal, borderRadius: 999, boxShadow: "0 0 0 12px rgba(101,232,202,.12), 0 20px 50px rgba(101,232,202,.18)", color: colors.ink, display: "flex", height: 120, justifyContent: "center", scale: interpolate(resolve, [0, 1], [.65, 1]), width: 120 }}><Glyph name="human" size={52} /></div>
        <strong style={{ fontFamily: displayFont, fontSize: 42, letterSpacing: -1.2, marginTop: 28 }}>Human: request proof</strong>
        <span style={{ color: "rgba(244,246,241,.55)", fontFamily: monoFont, fontSize: 14, marginTop: 10 }}>scoped to exact evidence identity</span>
      </div>
    </div>
  </AbsoluteFill>;
};

const EvalScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const metrics = [["3", "local workspaces"], ["120", "synthetic runs"], ["11 / 11", "attention recall"], ["1.0", "precision"]];
  return <AbsoluteFill style={{ padding: "54px 70px 104px" }}>
    <Background />
    <div style={{ display: "flex", justifyContent: "space-between", opacity: exit(frame, duration), position: "relative" }}><div><SceneLabel>Repeatable evaluation</SceneLabel><h2 style={{ color: colors.ink, fontFamily: displayFont, fontSize: 76, letterSpacing: -3, lineHeight: .9, margin: "15px 0 0" }}>Proof that is allowed to fail.</h2></div><Brand compact /></div>
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(4, 1fr)", marginTop: 56, opacity: exit(frame, duration), position: "relative" }}>
      {metrics.map(([value, label], index) => { const p = enter(frame, 12 + index * 9, 20); return <div key={label} style={{ background: index === 0 ? colors.ink : colors.raised, borderRadius: 22, boxShadow: "0 0 0 1px rgba(9,24,21,.08)", minHeight: 230, opacity: p, padding: "30px 26px", translate: `0 ${interpolate(p, [0, 1], [30, 0])}px` }}><strong style={{ color: index === 0 ? colors.signal : colors.tealDark, display: "block", fontFamily: displayFont, fontSize: 74, letterSpacing: -3, lineHeight: 1 }}>{value}</strong><span style={{ color: index === 0 ? "rgba(244,246,241,.6)" : colors.muted, display: "block", fontFamily: bodyFont, fontSize: 19, fontWeight: 800, lineHeight: 1.25, marginTop: 24 }}>{label}</span></div>; })}
    </div>
    <p style={{ bottom: 114, color: colors.muted, fontFamily: bodyFont, fontSize: 16, margin: 0, position: "absolute" }}>Synthetic benchmark evidence proves deterministic triage mechanics. Human comprehension remains a separate gate.</p>
  </AbsoluteFill>;
};

const BuildScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const codexItems = ["Baseline audit", "Trust Inbox + Proof Mode", "Evals + release pipeline", "This film"];
  const modelItems = ["Atomic claims", "Exact citations", "Strict structured output"];
  return <AbsoluteFill style={{ color: colors.paper, padding: "48px 70px 104px" }}>
    <Background dark />
    <div style={{ display: "flex", justifyContent: "space-between", opacity: exit(frame, duration), position: "relative" }}>
      <div>
        <SceneLabel dark>Built with Codex + GPT-5.6</SceneLabel>
        <h2 style={{ fontFamily: displayFont, fontSize: 72, letterSpacing: -2.8, lineHeight: .9, margin: "16px 0 0" }}>Codex accelerated the build.<br /><span style={{ color: colors.signal }}>Evidence kept authority.</span></h2>
      </div>
      <Brand inverse compact />
    </div>
    <div style={{ display: "grid", gap: 18, gridTemplateColumns: "1.1fr .9fr", marginTop: 38, opacity: exit(frame, duration), position: "relative" }}>
      <div style={{ background: "rgba(255,255,255,.07)", borderRadius: 22, boxShadow: "0 0 0 1px rgba(255,255,255,.1)", opacity: enter(frame, 10, 20), padding: "24px 26px" }}>
        <span style={{ color: colors.signal, fontFamily: bodyFont, fontSize: 14, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>Codex · from audit to ship</span>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, 1fr)", marginTop: 20 }}>
          {codexItems.map((item, index) => <div key={item} style={{ alignItems: "center", background: "rgba(101,232,202,.08)", borderRadius: 12, display: "flex", gap: 10, opacity: enter(frame, 25 + index * 9, 16), padding: "13px 14px" }}><span style={{ alignItems: "center", background: colors.teal, borderRadius: 999, color: "white", display: "flex", height: 28, justifyContent: "center", width: 28 }}><Glyph name="check" size={16} /></span><strong style={{ fontFamily: bodyFont, fontSize: 15 }}>{item}</strong></div>)}
        </div>
      </div>
      <div style={{ background: colors.raised, borderRadius: 22, color: colors.ink, opacity: enter(frame, 28, 20), padding: "24px 26px" }}>
        <span style={{ color: colors.tealDark, fontFamily: bodyFont, fontSize: 14, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>GPT-5.6 · inside Halba</span>
        <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
          {modelItems.map((item, index) => <div key={item} style={{ alignItems: "center", background: "#e6ebe5", borderRadius: 11, display: "flex", fontFamily: monoFont, fontSize: 15, fontWeight: 800, gap: 10, opacity: enter(frame, 44 + index * 10, 16), padding: "12px 14px" }}><Glyph name={index === 1 ? "source" : "claim"} size={19} />{item}</div>)}
        </div>
      </div>
    </div>
    <div style={{ alignItems: "center", bottom: 112, color: "rgba(244,246,241,.6)", display: "flex", fontFamily: monoFont, fontSize: 14, gap: 10, left: 70, position: "absolute" }}><Glyph name="guard" size={20} /> deterministic guards + human judgment remain authoritative</div>
  </AbsoluteFill>;
};

const Outro: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ alignItems: "center", color: colors.paper, justifyContent: "center", padding: "60px 90px 104px", textAlign: "center" }}>
    <Background dark />
    <div style={{ opacity: enter(frame, 0, 20) * exit(frame, duration, 10), position: "relative" }}>
      <Brand inverse />
      <TraceRail frame={frame} dark />
      <h2 style={{ fontFamily: displayFont, fontSize: 86, letterSpacing: -3.8, lineHeight: .9, margin: "38px 0 0" }}>Language proposes.<br /><span style={{ color: colors.signal }}>Evidence decides.</span></h2>
      <p style={{ color: "rgba(244,246,241,.6)", fontFamily: monoFont, fontSize: 20, margin: "28px 0 0" }}>jlekerli-source.github.io/halba</p>
    </div>
  </AbsoluteFill>;
};

export const HalbaThumbnail: React.FC = () => {
  const trace: Array<[GlyphName, string]> = [
    ["claim", "Claim"],
    ["source", "Source"],
    ["guard", "Guard"],
    ["human", "Human"],
  ];

  return <AbsoluteFill style={{ background: colors.ink, color: colors.paper, fontFamily: bodyFont, overflow: "hidden" }}>
    <div style={{ backgroundImage: "linear-gradient(rgba(101,232,202,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(101,232,202,.045) 1px, transparent 1px)", backgroundSize: "32px 32px", inset: 0, position: "absolute" }} />
    <div style={{ background: "radial-gradient(circle, rgba(101,232,202,.2), transparent 67%)", height: 760, position: "absolute", right: -260, top: -270, width: 760 }} />
    <div style={{ background: "linear-gradient(90deg, rgba(101,232,202,.12), transparent)", height: 3, left: 0, position: "absolute", right: 0, top: 0 }} />

    <div style={{ display: "grid", gridTemplateColumns: ".88fr 1.12fr", height: "100%", padding: "58px 60px 54px", position: "relative" }}>
      <div style={{ display: "flex", flexDirection: "column", paddingRight: 36 }}>
        <Brand inverse compact />
        <div style={{ marginTop: 84 }}>
          <SceneLabel dark>OpenAI Build Week</SceneLabel>
          <h1 style={{ fontFamily: displayFont, fontSize: 86, letterSpacing: -4, lineHeight: .83, margin: "22px 0 0" }}>
            LANGUAGE<br />PROPOSES.
            <span style={{ color: colors.signal, display: "block", marginTop: 12 }}>EVIDENCE<br />DECIDES.</span>
          </h1>
          <p style={{ color: "rgba(244,246,241,.64)", fontSize: 18, fontWeight: 650, lineHeight: 1.42, margin: "28px 0 0", maxWidth: 410 }}>Local-first trust operations for AI-assisted work.</p>
        </div>

        <div style={{ alignItems: "center", display: "grid", gap: 8, gridTemplateColumns: "repeat(4, 1fr)", marginTop: "auto" }}>
          {trace.map(([name, label], index) => <div key={label} style={{ alignItems: "center", display: "flex", gap: 7 }}>
            <span style={{ alignItems: "center", background: index === 3 ? colors.signal : "rgba(101,232,202,.12)", borderRadius: 999, color: index === 3 ? colors.ink : colors.signal, display: "flex", height: 30, justifyContent: "center", width: 30 }}><Glyph name={name} size={16} /></span>
            <span style={{ color: index === 3 ? colors.paper : "rgba(244,246,241,.56)", fontFamily: monoFont, fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>{label}</span>
          </div>)}
        </div>
      </div>

      <div style={{ alignItems: "center", display: "flex", justifyContent: "center", position: "relative" }}>
        <div style={{ background: colors.raised, borderRadius: 24, boxShadow: "0 42px 100px rgba(0,0,0,.42), 0 0 0 1px rgba(255,255,255,.14)", height: 554, overflow: "hidden", position: "relative", rotate: "1.5deg", width: 624 }}>
          <Img src={staticFile("screenshots/trust-inbox-desktop.png")} style={{ height: "100%", objectFit: "cover", objectPosition: "48% top", width: "100%" }} />
          <div style={{ background: "linear-gradient(180deg, transparent 58%, rgba(9,24,21,.72))", inset: 0, position: "absolute" }} />
        </div>

        <div style={{ alignItems: "center", background: colors.red, borderRadius: 12, boxShadow: "0 18px 40px rgba(211,74,61,.32)", color: "white", display: "flex", fontSize: 15, fontWeight: 950, gap: 9, letterSpacing: 2.2, padding: "15px 20px", position: "absolute", right: -14, rotate: "-3deg", textTransform: "uppercase", top: 82 }}><Glyph name="split" size={21} /> Contradiction found</div>

        <div style={{ background: colors.raised, borderRadius: 16, bottom: 60, boxShadow: "0 22px 54px rgba(0,0,0,.34)", color: colors.ink, display: "grid", gap: 17, gridTemplateColumns: "repeat(3, 1fr)", left: -8, padding: "20px 24px", position: "absolute", width: 520 }}>
          {[["120", "runs"], ["11", "attention"], ["3", "workspaces"]].map(([value, label]) => <div key={label}>
            <strong style={{ color: colors.tealDark, display: "block", fontFamily: displayFont, fontSize: 36, lineHeight: .85 }}>{value}</strong>
            <span style={{ color: colors.muted, display: "block", fontFamily: monoFont, fontSize: 11, fontWeight: 800, marginTop: 8, textTransform: "uppercase" }}>{label}</span>
          </div>)}
        </div>
      </div>
    </div>
  </AbsoluteFill>;
};

export const HalbaBuildWeek: React.FC = () => {
  const { fps } = useVideoConfig();
  return <AbsoluteFill>
    <Sequence durationInFrames={7 * fps}><ColdOpen duration={7 * fps} /></Sequence>
    <Sequence from={7 * fps} durationInFrames={7 * fps}><PacketScene duration={7 * fps} /></Sequence>
    <Sequence from={14 * fps} durationInFrames={7.5 * fps}><AppScene duration={7.5 * fps} /></Sequence>
    <Sequence from={21.5 * fps} durationInFrames={8 * fps}><OverrideScene duration={8 * fps} /></Sequence>
    <Sequence from={29.5 * fps} durationInFrames={10 * fps}><SourceScene duration={10 * fps} /></Sequence>
    <Sequence from={39.5 * fps} durationInFrames={7 * fps}><HumanScene duration={7 * fps} /></Sequence>
    <Sequence from={46.5 * fps} durationInFrames={7 * fps}><EvalScene duration={7 * fps} /></Sequence>
    <Sequence from={53.5 * fps} durationInFrames={13 * fps}><BuildScene duration={13 * fps} /></Sequence>
    <Sequence from={66.5 * fps} durationInFrames={5.5 * fps}><Outro duration={5.5 * fps} /></Sequence>
    {[7, 14, 21.5, 29.5, 39.5, 46.5, 53.5, 66.5].map((second) => <Sequence key={second} from={second * fps} durationInFrames={18} layout="none"><Audio src={staticFile("demo/proof-pulse.wav")} volume={0.32} /></Sequence>)}
    <Audio src={staticFile("demo/sound-bed.wav")} volume={0.24} />
    <Audio src={staticFile("demo/narration.m4a")} volume={1} />
    <Captions />
  </AbsoluteFill>;
};
