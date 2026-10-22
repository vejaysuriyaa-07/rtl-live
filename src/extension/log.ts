import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function initLog(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel("RTL Live");
  return channel;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  info(msg: string): void {
    channel?.appendLine(`${stamp()} [info] ${msg}`);
  },
  warn(msg: string): void {
    channel?.appendLine(`${stamp()} [warn] ${msg}`);
  },
  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? ` ${err.stack ?? err.message}` : err !== undefined ? ` ${String(err)}` : "";
    channel?.appendLine(`${stamp()} [error] ${msg}${detail}`);
  },
  show(): void {
    channel?.show(true);
  },
};

const onceKeys = new Set<string>();
/** Log a message only the first time its key is seen (e.g. unknown cell types). */
export function logOnce(key: string, msg: string): void {
  if (onceKeys.has(key)) return;
  onceKeys.add(key);
  log.warn(msg);
}
