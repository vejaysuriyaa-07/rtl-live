// Messages between the extension host and the webview.
// Every message carries a generation; the webview ignores anything older than
// the last one it rendered. Both sides validate inbound messages with the
// guards at the bottom of this file.
import type { SchematicDoc } from "../ir/types";

export type Fidelity = "structural" | "synthesized" | "stale";

export type ViewKind = "rtl" | "gate";

export interface StatusInfo {
  fidelity: Fidelity;
  /** Which synthesized view the host is showing or will show */
  view?: ViewKind;
  /** Structural view of text that does not parse yet: badge reads "Editing" */
  editing?: boolean;
  backend: "native" | "wasm" | "off" | "none";
  backendVersion?: string;
  warmingUp?: boolean;
  message?: string;
}

export interface BannerError {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  /** The errors after the first one, in source order (bug 22) */
  more?: { line?: number; column?: number; message: string }[];
}

/** Advice shown above the diagram with an optional action button (e.g. untitled Plain Text that looks like Verilog). */
export interface HintInfo {
  message: string;
  action?: { label: string; command: "setLanguage" };
}

export interface CursorInfo {
  line: number;
  column: number;
}

export type ThemeKind = "light" | "dark" | "highContrast" | "highContrastLight";

/** Export colours: dark lines on white (print) or the live theme's colours. */
export type ExportPalette = "print" | "theme";

/** Settings the webview needs; sent on ready and whenever they change. */
export interface ViewConfig {
  exportPalette: ExportPalette;
}

// Host -> webview
export type HostToWebview =
  | { type: "render"; generation: number; doc: SchematicDoc; fitOnRender: boolean; sourceLines?: string[] }
  | { type: "status"; generation: number; status: StatusInfo }
  | { type: "cursor"; generation: number; cursor: CursorInfo | null }
  | { type: "theme"; generation: number; theme: ThemeKind }
  | { type: "error"; generation: number; error: BannerError | null }
  | { type: "selectTop"; generation: number; top: string }
  | { type: "export"; generation: number; format: "svg" | "png" }
  | { type: "fit"; generation: number }
  | { type: "drillUp"; generation: number }
  | { type: "ping"; generation: number; id: number }
  | { type: "hint"; generation: number; hint: HintInfo | null }
  | { type: "config"; generation: number; config: ViewConfig };

// Webview -> host
export type WebviewToHost =
  | { type: "ready"; generation: number }
  | { type: "log"; generation: number; level: "info" | "warn" | "error"; text: string }
  | { type: "revealSource"; generation: number; line: number; column: number; endLine?: number; endColumn?: number }
  | { type: "selectTop"; generation: number; top: string }
  | { type: "export"; generation: number; format: "svg" | "png"; data: string }
  | { type: "revealError"; generation: number; line: number; column: number }
  | { type: "openInPanel"; generation: number }
  | { type: "drill"; generation: number; module: string }
  | { type: "highlighted"; generation: number; ids: string[] }
  | { type: "pong"; generation: number; id: number }
  | { type: "reloadWindow"; generation: number }
  | { type: "setLanguage"; generation: number; language: "verilog" | "systemverilog" }
  | { type: "setView"; generation: number; view: ViewKind };

const HOST_TYPES: ReadonlySet<string> = new Set([
  "render",
  "status",
  "cursor",
  "theme",
  "error",
  "selectTop",
  "export",
  "fit",
  "drillUp",
  "ping",
  "hint",
  "config",
]);
const WEBVIEW_TYPES: ReadonlySet<string> = new Set([
  "ready",
  "log",
  "revealSource",
  "selectTop",
  "export",
  "revealError",
  "openInPanel",
  "drill",
  "highlighted",
  "pong",
  "reloadWindow",
  "setLanguage",
  "setView",
]);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function hasGeneration(x: Record<string, unknown>): boolean {
  return typeof x["generation"] === "number" && Number.isFinite(x["generation"]);
}

export function isHostToWebview(x: unknown): x is HostToWebview {
  return isRecord(x) && typeof x["type"] === "string" && HOST_TYPES.has(x["type"]) && hasGeneration(x);
}

export function isWebviewToHost(x: unknown): x is WebviewToHost {
  if (!isRecord(x) || typeof x["type"] !== "string" || !WEBVIEW_TYPES.has(x["type"]) || !hasGeneration(x)) {
    return false;
  }
  switch (x["type"]) {
    case "log":
      return typeof x["text"] === "string" && typeof x["level"] === "string";
    case "revealSource":
    case "revealError":
      return typeof x["line"] === "number" && typeof x["column"] === "number";
    case "selectTop":
      return typeof x["top"] === "string";
    case "drill":
      return typeof x["module"] === "string";
    case "highlighted":
      return Array.isArray(x["ids"]) && (x["ids"] as unknown[]).every((i) => typeof i === "string");
    case "export":
      return typeof x["data"] === "string" && (x["format"] === "svg" || x["format"] === "png");
    case "pong":
      return typeof x["id"] === "number";
    case "setLanguage":
      return x["language"] === "verilog" || x["language"] === "systemverilog";
    case "setView":
      return x["view"] === "rtl" || x["view"] === "gate";
    default:
      return true;
  }
}
