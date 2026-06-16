import type Phaser from "phaser";

/**
 * Scene transition fade (spec 015). The shell composites a Phaser canvas with
 * DOM overlays layered ON TOP of it (the lobby cards in render/card-overlay.ts,
 * the online host-URL <input> in OnlineJoinScene). A Phaser camera fade only
 * affects the canvas, so it would leave those DOM layers fully visible mid-
 * transition. Instead a single full-viewport <div> is layered above EVERYTHING
 * (canvas + every DOM overlay) and its opacity is animated, so a scene change
 * fades through black uniformly.
 *
 * Flow: a leaving scene calls transitionTo() (fade to opaque, then scene.start);
 * the incoming scene calls fadeIn() in its create() (fade back to transparent).
 * The overlay is initialized OPAQUE so the first visible screen after boot fades
 * in from black instead of popping in. Pure shell/cosmetic — no sim, state, or
 * determinism impact (the fade is a DOM element animated by wall-clock CSS).
 */

/** Above the lobby card overlay (z-index 10) and the online input (z-index 20). */
const OVERLAY_Z = 1000;

let durationMs = 220;
let overlay: HTMLDivElement | null = null;
/** True while a fade-to-black + scene.start is in flight (re-entrancy guard so a
 *  double confirm — or an update() loop that keeps firing — can't start twice). */
let transitioning = false;

/** Configure the fade duration once at boot from tuning (ui.transitionMs). */
export function setTransitionDurationMs(ms: number): void {
  durationMs = ms;
}

/** Lazily create the fade overlay, initialized OPAQUE so the first visible scene
 *  fades in from black. Idempotent. */
function ensureOverlay(): HTMLDivElement {
  if (overlay) return overlay;
  const el = document.createElement("div");
  el.id = "scene-fade";
  // Cover the whole viewport. Explicit top/left + width/height: 100% (not the
  // `inset: 0` shorthand) so a fixed, childless element actually fills the screen
  // — `inset` collapsed it to 0×0 here. width/height 100% of a fixed element is
  // the viewport.
  Object.assign(el.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    margin: "0",
    padding: "0",
    background: "#000",
    pointerEvents: "none",
    zIndex: String(OVERLAY_Z),
    opacity: "1"
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  overlay = el;
  return el;
}

/** Prime the overlay opaque before the first scene renders (called by BootScene),
 *  masking the initial canvas flash so the first screen fades in from black. */
export function primeTransition(): void {
  ensureOverlay();
}

/** Animate the overlay opacity to `target`, invoking `done` once it settles.
 *  transitionend may not fire when the value doesn't actually change (0ms
 *  duration, or already at target), so a timer guarantees the callback always
 *  runs. Whichever wins, both the listener and the timer are torn down so nothing
 *  accumulates on the long-lived overlay element. */
function animateTo(target: "0" | "1", done?: () => void): void {
  const el = ensureOverlay();
  el.style.transition = `opacity ${String(durationMs)}ms linear`;
  // Force a reflow so the browser animates from the current opacity.
  void el.offsetWidth;
  el.style.opacity = target;
  if (!done) return;
  let fired = false;
  let timer = 0;
  const finish = (): void => {
    if (fired) return;
    fired = true;
    el.removeEventListener("transitionend", onEnd);
    window.clearTimeout(timer);
    done();
  };
  // Only opacity is animated on this element; guard propertyName so a future
  // transition on the overlay can't fire the hand-off early.
  const onEnd = (e: TransitionEvent): void => {
    if (e.propertyName === "opacity") finish();
  };
  el.addEventListener("transitionend", onEnd);
  timer = window.setTimeout(finish, durationMs + 50);
}

/** Fade to black, then start the target scene with the same data payload. No-op
 *  if a fade-out is already running. */
export function transitionTo(scene: Phaser.Scene, key: string, data?: object): void {
  if (transitioning) return;
  transitioning = true;
  animateTo("1", () => {
    transitioning = false;
    scene.scene.start(key, data);
  });
}

/** Fade the (opaque) overlay back to transparent — called in a scene's create(). */
export function fadeIn(): void {
  animateTo("0");
}
