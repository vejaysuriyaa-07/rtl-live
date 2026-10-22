// Builds assets/wasm/tree-sitter-verilog.wasm from the tree-sitter-verilog npm
// package using the pinned tree-sitter-cli. tree-sitter-cli 0.27 downloads a
// wasi-sdk clang and binaryen into ~/.cache/tree-sitter on first use, so no
// emscripten or docker is needed. Records provenance in assets/wasm/provenance.json.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname, "..");
const src = join(root, "node_modules", "tree-sitter-verilog");
const work = join(root, "artifacts", "grammar-src");
const outDir = join(root, "assets", "wasm");
const out = join(outDir, "tree-sitter-verilog.wasm");

if (!existsSync(src)) {
  console.error("tree-sitter-verilog is not installed; run npm install first");
  process.exit(1);
}
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
for (const f of ["src", "grammar.js", "package.json", "LICENSE"]) {
  if (existsSync(join(src, f))) cpSync(join(src, f), join(work, f), { recursive: true });
}
const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
writeFileSync(
  join(work, "tree-sitter.json"),
  JSON.stringify(
    {
      grammars: [{ name: "verilog", camelcase: "Verilog", scope: "source.verilog", path: ".", "file-types": ["v", "vh", "sv", "svh"] }],
      metadata: { version: pkg.version, license: pkg.license, description: pkg.description },
    },
    null,
    2,
  ),
);
mkdirSync(outDir, { recursive: true });
const cli = join(root, "node_modules", ".bin", "tree-sitter");
const cliVersion = execFileSync(cli, ["--version"], { encoding: "utf8" }).trim();
console.log(`building with ${cliVersion} from tree-sitter-verilog ${pkg.version}`);
// parser.c in the package is pre-generated (ABI 14); we compile it as is rather
// than regenerating, so the grammar matches the published package byte for byte.
execFileSync(cli, ["build", "--wasm", "-o", out, work], { stdio: "inherit" });
const bytes = readFileSync(out);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const parserC = readFileSync(join(work, "src", "parser.c"), "utf8");
const abi = /#define LANGUAGE_VERSION (\d+)/.exec(parserC)?.[1] ?? "unknown";
const provenance = {
  file: "tree-sitter-verilog.wasm",
  sha256,
  bytes: bytes.length,
  grammar: { package: "tree-sitter-verilog", version: pkg.version, license: pkg.license, abi: Number(abi) },
  builtWith: { "tree-sitter-cli": cliVersion, toolchain: "wasi-sdk clang + binaryen fetched by tree-sitter-cli" },
  builtAt: new Date().toISOString(),
};
writeFileSync(join(outDir, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
console.log(`wrote ${out} (${bytes.length} bytes, sha256 ${sha256})`);
