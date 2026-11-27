import { forwardRef, useCallback, useEffect, useRef, useState, type CSSProperties, type VideoHTMLAttributes } from "react";
import { Loader2, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";

/**
 * The club's own video player — every ClubOS video plays in this instead of the
 * browser's built-in controls (Daniel, 2026-11-27: "make all the video players
 * our local video players, not like these default built-in ones").
 *
 * It wraps a real <video> (so hls.js, refs, onTimeUpdate etc. keep working: the
 * forwarded ref IS the <video>, and every prop other than `controls` passes
 * straight through) and draws its own controls on top:
 *   big play button · play/pause · time · scrub bar with what has loaded ·
 *   mute + volume · optional speed · fullscreen. Space/K, ←/→ (5s), J/L (10s),
 *   M and F work while it has focus. Controls fade while playing and come back
 *   on any movement or tap.
 *
 * 🔴 Colours are INLINE on purpose: the light-theme generator rewrites bare
 * text-white on a light page, and these controls always sit on video.
 * 🔴 iPhone Safari cannot put a <div> in fullscreen; there it hands the video
 * to the phone's own fullscreen player (webkitEnterFullscreen), which is iOS's
 * only option.
 */

export interface ClubVideoPlayerProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, "controls"> {
  /** The bar's fill and the big play button. Defaults to white. */
  accent?: string;
  /** Text/icon colour ON the accent (big play button). */
  onAccent?: string;
  /** Show a speed menu in the bar (pages with their own speed buttons leave it off). */
  speeds?: number[];
  /** Classes / style for the outer frame (sizing, rounding, borders). */
  frameClassName?: string;
  frameStyle?: CSSProperties;
  /** Label read by screen readers. */
  label?: string;
}

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const t = Math.floor(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

const INK = "#ffffff";
const btn = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/70 md:h-9 md:w-9 hover:bg-white/15";

export const ClubVideoPlayer = forwardRef<HTMLVideoElement, ClubVideoPlayerProps>(function ClubVideoPlayer(
  { accent = "#ffffff", onAccent = "#0B0B0B", speeds, frameClassName, frameStyle, label = "Video", className, style, autoPlay, ...videoProps },
  ref,
) {
  const frame = useRef<HTMLDivElement>(null);
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  // A callback ref, so the caller's ref is the <video> BEFORE their effects run
  // (hls.js attaches in an effect; useImperativeHandle would hand it null).
  const setRefs = useCallback((node: HTMLVideoElement | null) => {
    setEl(node);
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLVideoElement | null>).current = node;
  }, [ref]);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(!!autoPlay);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [muted, setMuted] = useState(!!videoProps.muted);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [full, setFull] = useState(false);
  const [show, setShow] = useState(true);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const idle = useRef<number>();

  // Mirror the element's state. Listeners (not props) so the caller's own
  // onTimeUpdate/onLoadedMetadata props still fire untouched.
  useEffect(() => {
    if (!el) return;
    const sync = () => {
      setPlaying(!el.paused && !el.ended);
      setTime(el.currentTime);
      setDur(Number.isFinite(el.duration) ? el.duration : 0);
      setMuted(el.muted);
      setVolume(el.volume);
      setRate(el.playbackRate);
      try { setLoaded(el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0); } catch { /* no buffer yet */ }
    };
    const onPlay = () => { setStarted(true); sync(); };
    const onWait = () => setWaiting(true);
    const onGo = () => setWaiting(false);
    const evs: [string, () => void][] = [
      ["play", onPlay], ["pause", sync], ["ended", sync], ["timeupdate", sync], ["durationchange", sync], ["loadedmetadata", sync],
      ["progress", sync], ["volumechange", sync], ["ratechange", sync], ["waiting", onWait], ["playing", onGo], ["canplay", onGo], ["seeked", onGo],
    ];
    evs.forEach(([n, f]) => el.addEventListener(n, f));
    sync();
    return () => evs.forEach(([n, f]) => el.removeEventListener(n, f));
  }, [el]);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Controls: always shown while paused; fade 2.5s after the last movement while playing.
  const poke = useCallback(() => {
    setShow(true);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setShow(false), 2500);
  }, []);
  useEffect(() => () => window.clearTimeout(idle.current), []);
  const visible = show || !playing || scrubbing != null || speedOpen;
  const lastPointer = useRef<string>("mouse");
  // What was on screen BEFORE this tap's own pointerdown re-showed the controls.
  const visibleRef = useRef(visible);
  const wasVisible = useRef(true);
  useEffect(() => { visibleRef.current = visible; }, [visible]);

  const toggle = useCallback(() => {
    if (!el) return;
    if (el.paused || el.ended) void el.play().catch(() => {}); else el.pause();
    poke();
  }, [el, poke]);
  const seekBy = (by: number) => { if (el) { el.currentTime = Math.max(0, Math.min(el.currentTime + by, dur || el.currentTime + by)); poke(); } };
  const toggleMute = () => { if (el) { el.muted = !el.muted; if (!el.muted && el.volume === 0) el.volume = 0.6; poke(); } };
  const toggleFull = () => {
    const v = el as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
    if (frame.current?.requestFullscreen) { void frame.current.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.()); return; }
    v?.webkitEnterFullscreen?.();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") { e.preventDefault(); toggle(); }
    else if (k === "arrowleft") { e.preventDefault(); seekBy(-5); }
    else if (k === "arrowright") { e.preventDefault(); seekBy(5); }
    else if (k === "j") seekBy(-10);
    else if (k === "l") seekBy(10);
    else if (k === "m") toggleMute();
    else if (k === "f") toggleFull();
  };

  // Scrub bar: pointer on the track, live preview while dragging, seek on release.
  const track = useRef<HTMLDivElement>(null);
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (dur || 0);
  };
  const onTrackDown = (e: React.PointerEvent) => {
    if (!dur) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setScrubbing(at(e.clientX));
  };
  const onTrackMove = (e: React.PointerEvent) => { if (scrubbing != null) setScrubbing(at(e.clientX)); };
  const onTrackUp = (e: React.PointerEvent) => {
    if (scrubbing == null) return;
    const t = at(e.clientX);
    if (el) el.currentTime = t;
    setTime(t);
    setScrubbing(null);
    poke();
  };

  const shown = scrubbing ?? time;
  const pct = dur ? (shown / dur) * 100 : 0;
  const loadedPct = dur ? Math.min(100, (loaded / dur) * 100) : 0;

  return (
    <div
      ref={frame}
      tabIndex={0}
      role="region"
      aria-label={label}
      onKeyDown={onKey}
      onPointerMove={poke}
      onPointerDown={poke}
      className={`group relative overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${frameClassName ?? ""}`}
      style={{ background: "#000", cursor: playing && !visible ? "none" : undefined, ...(full ? { width: "100%", height: "100%" } : {}), ...frameStyle }}
      data-club-player=""
    >
      <video
        {...videoProps}
        autoPlay={autoPlay}
        ref={setRefs}
        playsInline
        className={`block ${className ?? ""}`}
        style={{ objectFit: "contain", width: "100%", height: "100%", ...style, ...(full ? { width: "100%", height: "100%", maxHeight: "100%", maxWidth: "100%" } : {}) }}
        onPointerDown={(e) => { lastPointer.current = e.pointerType; wasVisible.current = visibleRef.current; videoProps.onPointerDown?.(e); }}
        onClick={(e) => {
          videoProps.onClick?.(e);
          // A finger on a playing video brings the controls back first (as on a
          // phone's own player); a mouse click, or a tap with them showing, plays/pauses.
          if (lastPointer.current === "touch" && playing && !wasVisible.current) { poke(); return; }
          toggle();
        }}
        onDoubleClick={(e) => { videoProps.onDoubleClick?.(e); toggleFull(); }}
      />

      {/* Spinner while the next part loads. */}
      {waiting && playing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin" style={{ color: INK, opacity: 0.85 }} aria-hidden />
        </div>
      )}

      {/* Big play button before the first play and whenever paused. */}
      {!playing && !waiting && (
        <button type="button" onClick={toggle} aria-label="Play"
          className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-2xl transition-transform hover:scale-105 md:h-[72px] md:w-[72px]"
          style={{ background: accent, color: onAccent, boxShadow: "0 10px 40px rgba(0,0,0,0.45)" }} data-testid="player-big-play">
          <Play className="ml-1 h-7 w-7" fill="currentColor" aria-hidden />
        </button>
      )}

      {/* Bottom bar. */}
      <div
        className="absolute inset-x-0 bottom-0 transition-opacity duration-200"
        style={{ opacity: visible && started ? 1 : started ? 0 : 1, pointerEvents: visible ? "auto" : "none", background: "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.35) 60%, rgba(0,0,0,0))", paddingTop: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrub bar (tall hit area, thin line). */}
        <div ref={track} className="relative mx-3 flex h-5 cursor-pointer touch-none items-center"
          role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(shown)} aria-valuetext={`${clock(shown)} of ${clock(dur)}`}
          onPointerDown={onTrackDown} onPointerMove={onTrackMove} onPointerUp={onTrackUp} onPointerCancel={() => setScrubbing(null)} data-testid="player-scrub">
          <div className="relative h-1 w-full overflow-hidden rounded-full transition-[height] group-hover:h-1.5" style={{ background: "rgba(255,255,255,0.22)" }}>
            <div className="absolute inset-y-0 left-0" style={{ width: `${loadedPct}%`, background: "rgba(255,255,255,0.35)" }} />
            <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: accent }} />
          </div>
          <div className="absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full shadow transition-transform"
            style={{ left: `${pct}%`, background: accent, transform: `translateX(-50%) scale(${scrubbing != null ? 1.25 : 1})`, boxShadow: "0 0 0 3px rgba(0,0,0,0.25)" }} />
          {scrubbing != null && (
            <div className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums"
              style={{ left: `${pct}%`, background: "rgba(0,0,0,0.85)", color: INK }}>{clock(scrubbing)}</div>
          )}
        </div>

        <div className="flex items-center gap-1 px-2 pb-2 pt-1" style={{ color: INK }}>
          <button type="button" className={btn} onClick={toggle} aria-label={playing ? "Pause" : "Play"} data-testid="player-play">
            {playing ? <Pause className="h-5 w-5" fill="currentColor" aria-hidden /> : <Play className="h-5 w-5" fill="currentColor" aria-hidden />}
          </button>
          <div className="flex items-center">
            <button type="button" className={btn} onClick={toggleMute} aria-label={muted || volume === 0 ? "Unmute" : "Mute"} data-testid="player-mute">
              {muted || volume === 0 ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
            </button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume"
              onChange={(e) => { if (!el) return; const v = Number(e.target.value); el.volume = v; el.muted = v === 0; }}
              className="hidden h-1 w-20 cursor-pointer md:block" style={{ accentColor: accent }} />
          </div>
          <span className="ml-1 whitespace-nowrap text-xs font-medium tabular-nums md:text-[13px]" style={{ color: INK }} data-testid="player-time">
            {clock(shown)} <span style={{ opacity: 0.6 }}>/ {clock(dur)}</span>
          </span>
          <span className="flex-1" />
          {speeds && speeds.length > 0 && (
            <div className="relative">
              <button type="button" onClick={() => setSpeedOpen((o) => !o)} aria-haspopup="menu" aria-expanded={speedOpen}
                className="inline-flex h-11 min-w-[44px] items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums hover:bg-white/15 md:h-9" style={{ color: INK }}>
                {rate}×
              </button>
              {speedOpen && (
                <div role="menu" className="absolute bottom-full right-0 mb-2 overflow-hidden rounded-lg py-1 shadow-xl" style={{ background: "rgba(20,20,20,0.96)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  {speeds.map((s) => (
                    <button key={s} type="button" role="menuitemradio" aria-checked={s === rate}
                      onClick={() => { if (el) el.playbackRate = s; setSpeedOpen(false); poke(); }}
                      className="block w-full px-4 py-2 text-left text-sm tabular-nums hover:bg-white/10" style={{ color: s === rate ? accent : INK }}>
                      {s}×
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button type="button" className={btn} onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"} data-testid="player-fullscreen">
            {full ? <Minimize className="h-5 w-5" aria-hidden /> : <Maximize className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
});
