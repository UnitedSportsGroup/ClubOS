// CIC Skills Challenge — public registration landing page.
// Served at join.cicyouth.com (host-routed in App.tsx) and /skills.
// Brand: CIC near-black #141511 / gold #C9A43E / white, Kanit + Inter.
// No payment — registration is free; scores are entered by CIC admins at
// the tournament and appear live in the CIC Youth app.
import { useEffect, useRef, useState } from "react";
import { Check, Maximize, Pause, Play, Settings, Volume2, VolumeX } from "lucide-react";
import type HlsType from "hls.js";

const GOLD = "#C9A43E";
const INK = "#141511";

// Cloudflare Stream — same account as the Kick Ups / TKRZ course videos.
const STREAM_HOST = "customer-cmfpri2ovjthkmgr.cloudflarestream.com";

type ChallengeKey = "juggling" | "dribble_pass_finish";

const CHALLENGES: {
  key: ChallengeKey;
  number: string;
  name: string;
  tagline: string;
  detail: string;
  scoring: string;
  videoUid: string;
  posterTime: string;
}[] = [
  {
    key: "juggling",
    number: "01",
    name: "90 Second Juggling Challenge",
    tagline: "How many can you rack up?",
    detail:
      "90 seconds on the clock. Keep the ball off the ground and count every touch — feet, thighs, head. Drop it? Pick it up and keep going. Every juggle counts toward your total.",
    scoring: "Most juggles in 90 seconds wins",
    videoUid: "78ec77768772d1acb77ee4d9425e2258",
    posterTime: "35s", // kids mid-juggle, ball in the air

  },
  {
    key: "dribble_pass_finish",
    number: "02",
    name: "Dribble, Pass & Finish Challenge",
    tagline: "Beat the course. Beat the clock.",
    detail:
      "Slalom through the cones, round the far marker, fire a pass into the rebounder, then bury the finish in the mini goal. Two attempts — only a successful finish stops the clock.",
    scoring: "Fastest time wins · 2 attempts, best counts",
    videoUid: "1f7461e6f233476d6ae02f0a18e2d28d",
    posterTime: "6s", // course laid out with glowing markers

  },
];

function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Custom on-brand player for the challenge explainer videos, streaming
// adaptive HLS (240p→1080p ladder) via hls.js on every browser that supports
// MSE; iOS Safari uses its native HLS stack. Quality menu offers Auto
// (network-adaptive, biased to start high) plus manual levels. Progressive
// MP4 only remains as a last-resort fallback. All chrome is ours: gold play
// button, gold scrub bar, minimal controls.
function ChallengeVideo({ uid, title, posterTime }: { uid: string; title: string; posterTime: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const startedLoadRef = useRef(false);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  // Quality: heights available from the manifest, the selected level
  // (-1 = Auto), what's actually playing right now, and the menu state.
  const [levels, setLevels] = useState<number[]>([]);
  const [selectedLevel, setSelectedLevel] = useState(-1);
  const [activeHeight, setActiveHeight] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const hlsUrl = `https://${STREAM_HOST}/${uid}/manifest/video.m3u8`;
  const mp4Url = `https://${STREAM_HOST}/${uid}/downloads/default.mp4`;
  const poster = `https://${STREAM_HOST}/${uid}/thumbnails/thumbnail.jpg?time=${posterTime}&height=1080`;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;
    let instance: HlsType | null = null;
    (async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled || !videoRef.current) return;
      if (Hls.isSupported()) {
        instance = new Hls({
          // Don't pull video segments until the user presses play.
          autoStartLoad: false,
          // The cards render small but fullscreen is one tap away — never
          // cap quality to the element size.
          capLevelToPlayerSize: false,
          // Assume a healthy connection for the first segments so Auto
          // starts sharp and only steps down if the network pushes back.
          abrEwmaDefaultEstimate: 6_000_000,
        });
        instance.loadSource(hlsUrl);
        instance.attachMedia(v);
        instance.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          setLevels(data.levels.map((l) => l.height));
        });
        instance.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
          const h = instance?.levels?.[data.level]?.height;
          if (h) setActiveHeight(h);
        });
        hlsRef.current = instance;
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        // iOS Safari — native HLS, OS-managed adaptive quality.
        v.src = hlsUrl;
      } else {
        v.src = mp4Url;
      }
    })();
    return () => {
      cancelled = true;
      instance?.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (hlsRef.current && !startedLoadRef.current) {
        hlsRef.current.startLoad();
        startedLoadRef.current = true;
      }
      void v.play();
    } else {
      v.pause();
    }
  }

  function pickLevel(idx: number) {
    setSelectedLevel(idx);
    setMenuOpen(false);
    const h = hlsRef.current;
    if (h) h.currentLevel = idx; // -1 → Auto (ABR)
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    v.currentTime = frac * v.duration;
    setProgress(frac);
  }

  function fullscreen() {
    const wrap = wrapRef.current as (HTMLDivElement & { requestFullscreen?: () => void }) | null;
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (wrap?.requestFullscreen) wrap.requestFullscreen();
    else if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iOS Safari
  }

  const controlsVisibility = !started
    ? "opacity-0 pointer-events-none"
    : playing && !menuOpen
      ? "opacity-0 group-hover:opacity-100"
      : "opacity-100";

  return (
    <div
      ref={wrapRef}
      className="relative rounded-2xl overflow-hidden group select-none"
      style={{ background: "#000", border: "1px solid rgba(255,255,255,0.1)", aspectRatio: "16 / 9" }}
    >
      <video
        ref={videoRef}
        poster={poster}
        preload="none"
        playsInline
        muted={muted}
        aria-label={title}
        className="w-full h-full object-cover cursor-pointer"
        onClick={toggle}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setCurrent(v.currentTime);
          setProgress(v.duration ? v.currentTime / v.duration : 0);
        }}
      />

      {/* Big gold play button — shown until playing */}
      {!playing && (
        <button
          onClick={toggle}
          aria-label={`Play: ${title}`}
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          style={{ background: "rgba(20,21,17,0.25)" }}
        >
          <span
            className="w-16 h-16 rounded-full flex items-center justify-center transition-transform duration-150 hover:scale-105"
            style={{ backgroundColor: GOLD, boxShadow: `0 10px 32px ${GOLD}59` }}
          >
            <Play size={26} fill={INK} color={INK} style={{ marginLeft: 3 }} />
          </span>
          {!started && (
            <span
              className="absolute bottom-3.5 left-4 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-[0.14em] uppercase"
              style={{ background: "rgba(20,21,17,0.65)", color: GOLD, backdropFilter: "blur(6px)" }}
            >
              Watch the challenge
            </span>
          )}
        </button>
      )}

      {/* Controls bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 px-4 pb-3 pt-10 transition-opacity duration-200 ${controlsVisibility}`}
        style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.8))" }}
      >
        <div onClick={seek} className="h-4 flex items-center cursor-pointer">
          <div className="h-[3px] w-full rounded-full" style={{ background: "rgba(255,255,255,0.22)" }}>
            <div
              className="h-[3px] rounded-full relative"
              style={{ width: `${progress * 100}%`, backgroundColor: GOLD }}
            >
              <span
                className="absolute -right-1.5 -top-[4.5px] w-3 h-3 rounded-full"
                style={{ backgroundColor: GOLD }}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-3.5">
            <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="text-white hover:opacity-80">
              {playing ? <Pause size={18} fill="#fff" /> : <Play size={18} fill="#fff" />}
            </button>
            <span className="text-[12px] font-semibold text-white/70" style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmtTime(current)} / {fmtTime(duration)}
            </span>
          </div>
          <div className="flex items-center gap-3.5">
            {levels.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label="Quality"
                  className="flex items-center gap-1.5 text-white hover:opacity-80"
                >
                  <Settings size={16} />
                  <span className="text-[12px] font-bold" style={{ color: selectedLevel === -1 ? "#fff" : GOLD }}>
                    {selectedLevel === -1
                      ? activeHeight
                        ? `Auto (${activeHeight}p)`
                        : "Auto"
                      : `${levels[selectedLevel]}p`}
                  </span>
                </button>
                {menuOpen && (
                  <div
                    className="absolute bottom-8 right-0 rounded-xl py-1.5 min-w-[150px] z-10"
                    style={{
                      background: "rgba(20,21,17,0.96)",
                      border: "1px solid rgba(255,255,255,0.14)",
                      backdropFilter: "blur(8px)",
                    }}
                  >
                    <div className="px-3.5 pt-1 pb-1.5 text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: `${GOLD}AA` }}>
                      Quality
                    </div>
                    {[-1, ...levels.map((_, i) => i).sort((a, b) => levels[b] - levels[a])].map((idx) => {
                      const active = selectedLevel === idx;
                      return (
                        <button
                          key={idx}
                          onClick={() => pickLevel(idx)}
                          className="w-full flex items-center justify-between px-3.5 py-1.5 text-left text-[13px] font-semibold hover:bg-white/5"
                          style={{ color: active ? GOLD : "rgba(255,255,255,0.85)" }}
                        >
                          {idx === -1 ? "Auto" : `${levels[idx]}p${levels[idx] >= 1080 ? " HD" : ""}`}
                          {active && <Check size={14} color={GOLD} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Unmute" : "Mute"}
              className="text-white hover:opacity-80"
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <button onClick={fullscreen} aria-label="Fullscreen" className="text-white hover:opacity-80">
              <Maximize size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CicSkillsLandingPage() {
  const [form, setForm] = useState({
    playerName: "",
    clubName: "",
    ageGroup: "" as "" | "U10" | "U11",
    challenge: "" as "" | ChallengeKey,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { playerName: string; challenge: ChallengeKey; ageGroup: string; alreadyRegistered: boolean }>(null);

  useEffect(() => {
    document.title = "CIC Skills Challenge — Register | Christchurch International Cup";
    // ClubOS ships one global favicon (USG) in index.html — swap in the CIC
    // crest for this page so join.cicyouth.com carries CIC branding in the tab.
    for (const rel of ["icon", "apple-touch-icon"]) {
      let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = "/cic/favicon.png";
    }
  }, []);

  const valid = form.playerName.trim() && form.clubName.trim() && form.ageGroup && form.challenge;

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/public/skills-challenge/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Something went wrong — please try again.");
      setDone({
        playerName: form.playerName.trim(),
        challenge: form.challenge as ChallengeKey,
        ageGroup: form.ageGroup,
        alreadyRegistered: !!body.alreadyRegistered,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function resetForAnother() {
    setForm({ playerName: "", clubName: "", ageGroup: "", challenge: "" });
    setDone(null);
    setError(null);
    document.getElementById("register")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div style={{ backgroundColor: INK, fontFamily: "'Inter', system-ui, sans-serif" }} className="min-h-screen text-white antialiased">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Kanit:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
        .cic-display { font-family: 'Kanit', 'Inter', sans-serif; }
        .cic-input {
          width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px; padding: 14px 16px; color: #fff; font-size: 16px; outline: none;
          transition: border-color .15s ease, background .15s ease;
        }
        .cic-input::placeholder { color: rgba(255,255,255,0.3); }
        .cic-input:focus { border-color: ${GOLD}; background: rgba(255,255,255,0.06); }
        .cic-choice { cursor: pointer; transition: border-color .15s ease, background .15s ease, transform .1s ease; }
        .cic-choice:active { transform: scale(0.985); }
      `}</style>

      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <img src="/cic/cic-logo.png" alt="Christchurch International Cup" className="w-11 h-11 rounded-full ring-1 ring-white/20" />
          <div className="leading-tight">
            <div className="cic-display font-bold text-[15px] tracking-wide">CHRISTCHURCH INTERNATIONAL CUP</div>
            <div className="text-[11px] font-semibold tracking-[0.18em]" style={{ color: GOLD }}>SKILLS CHALLENGE 2026</div>
          </div>
        </div>
        <a
          href="#register"
          className="hidden sm:inline-block px-5 py-2.5 rounded-full font-semibold text-sm"
          style={{ backgroundColor: GOLD, color: INK }}
        >
          Register
        </a>
      </header>

      {/* Hero */}
      <section className="px-6 pt-14 pb-16 text-center max-w-3xl mx-auto">
        <div
          className="inline-block px-4 py-1.5 rounded-full text-[12px] font-bold tracking-[0.22em] mb-7"
          style={{ border: `1px solid ${GOLD}55`, color: GOLD }}
        >
          JULY 2026 · UNITED SPORTS CENTRE · FREE TO ENTER
        </div>
        <h1 className="cic-display font-extrabold uppercase leading-[0.95] text-[clamp(44px,9vw,84px)]">
          Two challenges.
          <br />
          <span style={{ color: GOLD }}>Four titles.</span>
        </h1>
        <p className="mt-6 text-white/65 text-lg leading-relaxed max-w-xl mx-auto">
          The Skills Challenge comes to the Christchurch International Cup. Juggle for 90 seconds or take on the
          Dribble, Pass &amp; Finish course — U10 and U11 champions crowned in each. Scores go live in the CIC app.
        </p>
        <a
          href="#register"
          className="inline-block mt-9 px-9 py-4 rounded-full cic-display font-bold text-lg uppercase tracking-wide"
          style={{ backgroundColor: GOLD, color: INK, boxShadow: `0 8px 32px ${GOLD}40` }}
        >
          Register a player
        </a>
        <div className="mt-4 text-[13px] text-white/35">Open to all U10 &amp; U11 players · takes 30 seconds</div>
      </section>

      {/* Challenge cards */}
      <section className="px-6 pb-20 max-w-5xl mx-auto">
        <div className="grid md:grid-cols-2 gap-5">
          {CHALLENGES.map((c) => (
            <div
              key={c.key}
              className="rounded-3xl p-8 relative overflow-hidden"
              style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.09)" }}
            >
              <div className="cic-display font-extrabold text-[64px] leading-none absolute top-5 right-7 select-none" style={{ color: `${GOLD}22` }}>
                {c.number}
              </div>
              <div className="text-[11px] font-bold tracking-[0.2em] uppercase mb-3" style={{ color: GOLD }}>
                Challenge {c.number}
              </div>
              <h2 className="cic-display font-bold text-[26px] leading-tight uppercase pr-12">{c.name}</h2>
              <p className="mt-1.5 font-semibold text-white/85">{c.tagline}</p>
              <div className="mt-5">
                <ChallengeVideo uid={c.videoUid} title={c.name} posterTime={c.posterTime} />
              </div>
              <p className="mt-5 text-[15px] text-white/55 leading-relaxed">{c.detail}</p>
              <div
                className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold"
                style={{ background: `${GOLD}1A`, color: GOLD }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: GOLD }} />
                {c.scoring}
              </div>
            </div>
          ))}
        </div>

        {/* Categories strip */}
        <div className="mt-5 rounded-3xl px-8 py-6 flex flex-wrap items-center justify-between gap-4" style={{ background: `${GOLD}10`, border: `1px solid ${GOLD}30` }}>
          <div>
            <div className="cic-display font-bold text-lg uppercase">Four titles up for grabs</div>
            <div className="text-sm text-white/50 mt-0.5">Each challenge is contested in two age groups — every category crowns its own champion.</div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {["U10 Juggling", "U11 Juggling", "U10 Dribble, Pass & Finish", "U11 Dribble, Pass & Finish"].map((t) => (
              <span key={t} className="px-4 py-2 rounded-full text-[13px] font-bold" style={{ border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.8)" }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Registration */}
      <section id="register" className="px-6 pb-24 max-w-xl mx-auto">
        <div className="rounded-3xl p-8 sm:p-10" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
          {done ? (
            <div className="text-center py-6">
              <div
                className="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-6"
                style={{ backgroundColor: GOLD }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h3 className="cic-display font-bold text-3xl uppercase">
                {done.alreadyRegistered ? "Already in!" : "You're in!"}
              </h3>
              <p className="mt-3 text-white/60 leading-relaxed">
                <span className="text-white font-semibold">{done.playerName}</span> is registered for the{" "}
                <span style={{ color: GOLD }} className="font-semibold">
                  {done.ageGroup} {CHALLENGES.find((c) => c.key === done.challenge)?.name}
                </span>
                . See you at the tournament — results will show live in the CIC Youth app.
              </p>
              <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={resetForAnother}
                  className="px-7 py-3.5 rounded-full cic-display font-bold uppercase tracking-wide"
                  style={{ backgroundColor: GOLD, color: INK }}
                >
                  Register another player
                </button>
              </div>
              <p className="mt-5 text-[13px] text-white/35">
                Entering both challenges? Submit one registration per challenge.
              </p>
            </div>
          ) : (
            <>
              <div className="text-[11px] font-bold tracking-[0.2em] uppercase mb-2" style={{ color: GOLD }}>
                Registration
              </div>
              <h3 className="cic-display font-bold text-3xl uppercase leading-tight">Enter the challenge</h3>
              <p className="mt-2 text-sm text-white/45">
                Free entry. One registration per player per challenge — entering both? Register twice.
              </p>

              <div className="mt-8 space-y-5">
                <div>
                  <label className="block text-[13px] font-semibold text-white/60 mb-2">Player's full name</label>
                  <input
                    className="cic-input"
                    value={form.playerName}
                    onChange={(e) => setForm({ ...form, playerName: e.target.value })}
                    placeholder="e.g. Charlie Smith"
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-white/60 mb-2">Club name</label>
                  <input
                    className="cic-input"
                    value={form.clubName}
                    onChange={(e) => setForm({ ...form, clubName: e.target.value })}
                    placeholder="e.g. Christchurch United"
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-white/60 mb-2">Age group</label>
                  <div className="grid grid-cols-2 gap-3">
                    {(["U10", "U11"] as const).map((ag) => {
                      const active = form.ageGroup === ag;
                      return (
                        <button
                          key={ag}
                          type="button"
                          onClick={() => setForm({ ...form, ageGroup: ag })}
                          className="cic-choice rounded-xl py-3.5 text-center cic-display font-bold text-lg"
                          style={{
                            border: `1.5px solid ${active ? GOLD : "rgba(255,255,255,0.12)"}`,
                            background: active ? `${GOLD}1F` : "rgba(255,255,255,0.03)",
                            color: active ? GOLD : "rgba(255,255,255,0.75)",
                          }}
                        >
                          {ag}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-white/60 mb-2">Challenge</label>
                  <div className="space-y-3">
                    {CHALLENGES.map((c) => {
                      const active = form.challenge === c.key;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => setForm({ ...form, challenge: c.key })}
                          className="cic-choice w-full rounded-xl px-5 py-4 text-left flex items-center gap-4"
                          style={{
                            border: `1.5px solid ${active ? GOLD : "rgba(255,255,255,0.12)"}`,
                            background: active ? `${GOLD}1F` : "rgba(255,255,255,0.03)",
                          }}
                        >
                          <span
                            className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center"
                            style={{ border: `2px solid ${active ? GOLD : "rgba(255,255,255,0.3)"}` }}
                          >
                            {active && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: GOLD }} />}
                          </span>
                          <span>
                            <span className={`block font-semibold ${active ? "text-white" : "text-white/80"}`}>{c.name}</span>
                            <span className="block text-[12px] mt-0.5" style={{ color: active ? GOLD : "rgba(255,255,255,0.35)" }}>
                              {c.scoring}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", color: "#ff9e9e" }}>
                    {error}
                  </div>
                )}

                <button
                  onClick={submit}
                  disabled={!valid || submitting}
                  className="w-full rounded-full py-4 cic-display font-bold text-lg uppercase tracking-wide transition-opacity"
                  style={{
                    backgroundColor: GOLD,
                    color: INK,
                    opacity: !valid || submitting ? 0.4 : 1,
                    cursor: !valid || submitting ? "not-allowed" : "pointer",
                  }}
                >
                  {submitting ? "Registering..." : "Register"}
                </button>
                <p className="text-center text-[12px] text-white/30">
                  Scores are entered by CIC officials on the day and appear live in the CIC Youth app.
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.07] px-6 py-10 text-center">
        <img src="/cic/cic-logo.png" alt="" className="w-12 h-12 rounded-full mx-auto mb-4 ring-1 ring-white/15" />
        <div className="cic-display font-bold text-sm tracking-[0.18em] uppercase text-white/60">
          Christchurch International Cup
        </div>
        <div className="text-[12px] text-white/25 mt-1.5">
          United Sports Centre · Christchurch, New Zealand ·{" "}
          <a href="https://cicyouth.com" className="underline hover:text-white/50">cicyouth.com</a>
        </div>
      </footer>
    </div>
  );
}
