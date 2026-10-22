// Stable node ids: a hash of (kind, op, sorted connected named nets, ordinal among equals).
// Never derived from Yosys auto names, which embed source line numbers.
import { createHash } from "node:crypto";

export function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 10);
}

export function stableNodeId(kind: string, op: string | undefined, namedNets: string[], ordinal: number): string {
  const key = `${kind}|${op ?? ""}|${[...namedNets].sort().join(",")}|${ordinal}`;
  return `${kind}${op ? `:${op}` : ""}:${shortHash(key)}`;
}
