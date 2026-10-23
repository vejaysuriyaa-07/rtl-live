// Renders artifacts/accuracy.json (written by test/accuracy/accuracy.test.ts)
// as docs/ACCURACY_REPORT.md: one row per fixture and view with the L1, L2
// and L3 status and the reason for every failure.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname, "..");
const results = JSON.parse(readFileSync(join(root, "artifacts", "accuracy.json"), "utf8"));
const views = ["structural", "rtl", "gate"];
const levels = ["L1", "L2", "L3"];

const mark = (c) => (c.ok ? (c.detail && c.detail.skipped ? "n/a" : "pass") : "FAIL");
const rows = [];
const reasons = [];
const totals = {};
for (const v of views) for (const l of levels) totals[`${v}.${l}`] = { pass: 0, fail: 0 };
for (const r of results) {
  for (const v of views) {
    const vr = r.views[v];
    if (!vr) continue;
    rows.push(`| ${r.fixture} | ${v} | ${levels.map((l) => mark(vr[l])).join(" | ")} |`);
    for (const l of levels) {
      if (vr[l].ok && vr[l].detail && vr[l].detail.skipped) continue;
      totals[`${v}.${l}`][vr[l].ok ? "pass" : "fail"]++;
      if (!vr[l].ok) reasons.push(`- ${r.fixture}, ${v} view, ${l}: ${vr[l].reason ?? "failed"}`);
    }
  }
}

const date = new Date().toISOString().slice(0, 10);
const out = [];
out.push("# Accuracy report");
out.push("");
out.push(`Generated ${date} by \`npm test\` (test/accuracy) from ${results.length} fixtures in test/fixtures/hdlbits.`);
out.push("");
out.push("Levels:");
out.push("");
out.push("- L1 functional: the netlist exported from the diagram (src/ir/toVerilog.ts) simulates identically to the source under Icarus Verilog on random vectors (clocked designs cycle by cycle). Bits that are x or z on either side are skipped and counted.");
out.push("- L2 structural: the assertions in test/fixtures/expected/<fixture>.json hold (ports and structural counts for the structural view; node, net, pin and width assertions in the rtl and gate blocks for the two synthesized views).");
out.push("- n/a: the gate view is asserted only where it differs from the RTL view (ACCURACY.md 6.2).");
out.push("- L3 readable: labels fit their symbols, no two labels overlap, every bus has a width label, Fit stays at or below 100 percent, no wire crosses a symbol, parallel wires of different nets are at least 8 px apart, wire labels keep clear of other nets, every junction dot marks a real T of its own net (none on a plain crossing, no 4-way junctions, dot radius at least 2.5 times the stroke), junction dots are at least 20 px apart, and every plain crossing is at least 16 px from any junction dot.");
out.push("");
out.push("## Summary");
out.push("");
out.push("| view | L1 | L2 | L3 |");
out.push("| --- | --- | --- | --- |");
for (const v of views) out.push(`| ${v} | ${levels.map((l) => `${totals[`${v}.${l}`].pass}/${totals[`${v}.${l}`].pass + totals[`${v}.${l}`].fail}`).join(" | ")} |`);
out.push("");
out.push("## Per fixture");
out.push("");
out.push("| fixture | view | L1 | L2 | L3 |");
out.push("| --- | --- | --- | --- | --- |");
out.push(...rows);
out.push("");
out.push("## Failure reasons");
out.push("");
out.push(...(reasons.length > 0 ? reasons : ["- none"]));
out.push("");
mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs", "ACCURACY_REPORT.md"), `${out.join("\n")}\n`);
console.log(`[accuracy-report] ${rows.length} rows, ${reasons.length} failures -> docs/ACCURACY_REPORT.md`);
