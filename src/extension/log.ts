import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;
const recentLines: string[] = [];
const RECENT_MAX = 400;

function append(line: string): void {
  channel?.appendLine(line);
  recentLines.push(line);
  if (recentLines.length > RECENT_MAX) recentLines.shift();
}

export function initLog(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel("RTL Live");
  return channel;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  info(msg: string): void {
    append(`${stamp()} [info] ${msg}`);
  },
  warn(msg: string): void {
    append(`${stamp()} [warn] ${msg}`);
  },
  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? ` ${err.stack ?? err.message}` : err !== undefined ? ` ${String(err)}` : "";
    append(`${stamp()} [error] ${msg}${detail}`);
  },
  show(): void {
    channel?.show(true);
  },
  /** The last few hundred lines, for tests and the tool report. */
  recent(): string[] {
    return [...recentLines];
  },
};

const onceKeys = new Set<string>();
/** Log a message only the first time its key is seen (e.g. unknown cell types). */
export function logOnce(key: string, msg: string): void {
  if (onceKeys.has(key)) return;
  onceKeys.add(key);
  log.warn(msg);
}
