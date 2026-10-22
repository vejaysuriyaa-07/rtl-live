// Messages between the extension host and the webview.
// Every message carries a generation; the webview ignores anything older than
// the last one it rendered. Both sides validate inbound messages with the
// guards at the bottom of this file.
import type { SchematicDoc } from "../ir/types";

export type Fidelity = "structural" | "synthesized" | "stale";

export interface StatusInfo {
  fidelity: Fidelity;
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
}

export interface CursorInfo {
  line: number;
  column: number;
}

export type ThemeKind = "light" | "dark" | "highContrast" | "highContrastLight";

// Host -> webview
export type HostToWebview =
  | { type: "render"; generation: number; doc: SchematicDoc; fitOnRender: boolean }
  | { type: "status"; generation: number; status: StatusInfo }
  | { type: "cursor"; generation: number; cursor: CursorInfo | null }
  | { type: "theme"; generation: number; theme: ThemeKind }
  | { type: "error"; generation: number; error: BannerError | null }
  | { type: "selectTop"; generation: number; top: string }
  | { type: "export"; generation: number; format: "svg" | "png" }
  | { type: "fit"; generation: number }
  | { type: "drillUp"; generation: number };

// Webview -> host
export type WebviewToHost =
  | { type: "ready"; generation: number }
  | { type: "log"; generation: number; level: "info" | "warn" | "error"; text: string }
  | { type: "revealSource"; generation: number; line: number; column: number; endLine?: number; endColumn?: number }
  | { type: "selectTop"; generation: number; top: string }
  | { type: "export"; generation: number; format: "svg" | "png"; data: string }
  | { type: "revealError"; generation: number; line: number; column: number }
  | { type: "openInPanel"; generation: number }
  | { type: "drill"; generation: number; module: string };

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
    case "export":
      return typeof x["data"] === "string" && (x["format"] === "svg" || x["format"] === "png");
    default:
      return true;
  }
}
