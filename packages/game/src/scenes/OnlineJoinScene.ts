import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH } from "@shoot-and-run/sim";
import { addPixelText } from "../theme";

const STORAGE_KEY = "shootAndRun.onlineHost";

/** localStorage host URL, else a sensible default for this page (wss:// when the
 *  page is https, since a browser on https can't open a plaintext ws:// socket). */
function defaultUrl(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch {
    /* storage may be unavailable (private mode) — fall through to the default */
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname || "localhost";
  return `${scheme}://${host}:8787`;
}

interface JoinData {
  /** Pre-fill the field with this (e.g. returning from a failed connection). */
  url?: string;
}

/**
 * Online join screen (spec 011, T11.3). Collects the dedicated host's address and
 * hands it to the online match scene. The host URL is typed into a real DOM
 * <input> layered over the canvas (the pixel buffer has no text-entry widget), and
 * remembered in localStorage so a returning player just presses Enter. Errors are
 * surfaced by the match scene, which returns here with the URL pre-filled.
 */
export class OnlineJoinScene extends Phaser.Scene {
  private urlInput!: HTMLInputElement;
  private onResize!: () => void;
  private onKey!: (e: KeyboardEvent) => void;
  private initialUrl = "";

  constructor() {
    super("online-join");
  }

  init(data: JoinData): void {
    this.initialUrl = data.url ?? defaultUrl();
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#10121f");
    addPixelText(this, ARENA_WIDTH / 2, 64, "ONLINE", 24, "#f0e6c8").setOrigin(0.5);
    addPixelText(this, ARENA_WIDTH / 2, 108, "host address", 11, "#9aa0b5").setOrigin(0.5);
    addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT - 28, "enter connect", 10, "#9aa0b5").setOrigin(0.5);
    addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT - 14, "esc back", 9, "#5a6079").setOrigin(0.5);

    // DOM text field over the canvas — the pixel buffer can't host text entry.
    const input = document.createElement("input");
    input.type = "text";
    input.value = this.initialUrl;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("data-testid", "online-host-url");
    input.setAttribute("aria-label", "Host address");
    Object.assign(input.style, {
      position: "fixed",
      boxSizing: "border-box",
      textAlign: "center",
      fontFamily: "monospace",
      color: "#f0e6c8",
      background: "#1a1d2e",
      border: "2px solid #3a4060",
      borderRadius: "2px",
      outline: "none",
      zIndex: "20"
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(input);
    this.urlInput = input;

    this.onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.connect();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.scene.start("title");
      }
    };
    input.addEventListener("keydown", this.onKey);

    this.onResize = (): void => this.layout();
    window.addEventListener("resize", this.onResize);
    this.layout();
    // Focus after the canvas settles so the field is ready to type into.
    this.time.delayedCall(0, () => input.focus());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  override update(): void {
    this.layout(); // cheap; re-syncs if the canvas box moved/resized
  }

  /** Center the input over the canvas, scaled to its on-screen box. */
  private layout(): void {
    const r = this.game.canvas.getBoundingClientRect();
    const w = r.width * 0.7;
    const h = Math.max(20, r.height * 0.09);
    this.urlInput.style.left = `${String(r.left + (r.width - w) / 2)}px`;
    this.urlInput.style.top = `${String(r.top + r.height * 0.5 - h / 2)}px`;
    this.urlInput.style.width = `${String(w)}px`;
    this.urlInput.style.height = `${String(h)}px`;
    this.urlInput.style.fontSize = `${String(Math.max(11, Math.round(r.height * 0.04)))}px`;
  }

  private connect(): void {
    const url = this.urlInput.value.trim();
    if (!url) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, url);
    } catch {
      /* storage unavailable — connecting still works, just won't be remembered */
    }
    this.scene.start("online", { url });
  }

  private teardown(): void {
    window.removeEventListener("resize", this.onResize);
    this.urlInput.removeEventListener("keydown", this.onKey);
    this.urlInput.remove();
  }
}
