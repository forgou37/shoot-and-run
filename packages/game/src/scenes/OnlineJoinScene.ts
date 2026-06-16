import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH } from "@shoot-and-run/sim";
import { addPixelText } from "../theme";

const STORAGE_KEY = "shootAndRun.onlineHost";
const TOKEN_STORAGE_KEY = "shootAndRun.joinToken";

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

/** Remembered join token (spec 013, T13.5), else empty. */
function defaultToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Build a styled text field layered over the canvas, appended to the body. */
function makeField(value: string, testid: string, ariaLabel: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("data-testid", testid);
  input.setAttribute("aria-label", ariaLabel);
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
  return input;
}

interface JoinData {
  /** Pre-fill the field with this (e.g. returning from a failed connection). */
  url?: string;
  /** Restore the play/spectate choice (e.g. returning from a failed connection). */
  spectate?: boolean;
  /** Restore the join token (e.g. returning from a failed connection). */
  joinToken?: string;
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
  private tokenInput!: HTMLInputElement;
  private onResize!: () => void;
  private onKey!: (e: KeyboardEvent) => void;
  private initialUrl = "";
  private initialToken = "";
  /** Play (false) vs spectate (true); toggled with Tab (spec 013, T13.2). */
  private spectate = false;
  private modeText!: Phaser.GameObjects.BitmapText;

  constructor() {
    super("online-join");
  }

  init(data: JoinData): void {
    this.initialUrl = data.url ?? defaultUrl();
    this.initialToken = data.joinToken ?? defaultToken();
    this.spectate = data.spectate ?? false;
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#10121f");
    addPixelText(this, ARENA_WIDTH / 2, 64, "ONLINE", 24, "#f0e6c8").setOrigin(0.5);
    addPixelText(this, ARENA_WIDTH / 2, 108, "host address", 11, "#9aa0b5").setOrigin(0.5);
    this.modeText = addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT - 44, "", 10, "#f0e6c8").setOrigin(0.5);
    addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT - 28, "enter connect · tab spectate", 10, "#9aa0b5").setOrigin(
      0.5
    );
    addPixelText(this, ARENA_WIDTH / 2, ARENA_HEIGHT - 14, "esc back", 9, "#5a6079").setOrigin(0.5);
    this.renderMode();

    // DOM text fields over the canvas — the pixel buffer can't host text entry.
    // One for the host URL, one for the optional join token (T13.5).
    this.urlInput = makeField(this.initialUrl, "online-host-url", "Host address");
    this.tokenInput = makeField(this.initialToken, "online-join-token", "Join token");
    this.tokenInput.placeholder = "join token (optional)";

    this.onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.connect();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.scene.start("title");
      } else if (e.key === "Tab") {
        e.preventDefault(); // toggle play/spectate instead of moving focus off the field
        this.spectate = !this.spectate;
        this.renderMode();
      }
    };
    this.urlInput.addEventListener("keydown", this.onKey);
    this.tokenInput.addEventListener("keydown", this.onKey);

    this.onResize = (): void => this.layout();
    window.addEventListener("resize", this.onResize);
    this.layout();
    // Focus after the canvas settles so the field is ready to type into.
    this.time.delayedCall(0, () => this.urlInput.focus());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  override update(): void {
    this.layout(); // cheap; re-syncs if the canvas box moved/resized
  }

  /** Center the URL field over the canvas (token field just below it), scaled to
   *  the on-screen box. */
  private layout(): void {
    const r = this.game.canvas.getBoundingClientRect();
    const w = r.width * 0.7;
    const h = Math.max(20, r.height * 0.09);
    const left = r.left + (r.width - w) / 2;
    const fontSize = `${String(Math.max(11, Math.round(r.height * 0.04)))}px`;
    const place = (el: HTMLInputElement, topFrac: number): void => {
      el.style.left = `${String(left)}px`;
      el.style.top = `${String(r.top + r.height * topFrac - h / 2)}px`;
      el.style.width = `${String(w)}px`;
      el.style.height = `${String(h)}px`;
      el.style.fontSize = fontSize;
    };
    place(this.urlInput, 0.5);
    place(this.tokenInput, 0.66);
  }

  /** Reflect the current play/spectate choice in the mode line. */
  private renderMode(): void {
    this.modeText.setText(this.spectate ? "mode: SPECTATE" : "mode: PLAY");
  }

  private connect(): void {
    const url = this.urlInput.value.trim();
    if (!url) return;
    const token = this.tokenInput.value.trim();
    try {
      window.localStorage.setItem(STORAGE_KEY, url);
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      /* storage unavailable — connecting still works, just won't be remembered */
    }
    this.scene.start("online", { url, spectate: this.spectate, joinToken: token || undefined });
  }

  private teardown(): void {
    window.removeEventListener("resize", this.onResize);
    this.urlInput.removeEventListener("keydown", this.onKey);
    this.tokenInput.removeEventListener("keydown", this.onKey);
    this.urlInput.remove();
    this.tokenInput.remove();
  }
}
