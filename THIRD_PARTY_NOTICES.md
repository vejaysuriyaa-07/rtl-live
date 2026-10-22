# Third-party notices

RTL Live bundles or depends on the following open source software.

| Component | Version | License | Use |
| --- | --- | --- | --- |
| Yosys, built and packaged by YoWASP as `@yowasp/yosys` | 0.70.1258 (Yosys 0.70) | ISC | synthesis to a JSON netlist; wasm and resource files shipped in `dist/` |
| web-tree-sitter | 0.27.1 | MIT | incremental, error-tolerant parsing runtime (`dist/web-tree-sitter.wasm`) |
| tree-sitter-verilog | 1.0.0 | MIT | Verilog grammar compiled to `dist/tree-sitter-verilog.wasm` (see `assets/wasm/provenance.json`) |
| elkjs (Eclipse Layout Kernel) | 0.12.0 | EPL-2.0 | layered layout (`dist/elkWorker.js` and bundled into `dist/webview.js`) |
| d3-selection, d3-zoom | 3.0.0 | ISC | pan and zoom (bundled into `dist/webview.js`) |

Full license texts are in `node_modules/<package>/LICENSE` after `npm install` and in each project's repository:

- Yosys: https://github.com/YosysHQ/yosys (ISC)
- YoWASP: https://github.com/YoWASP/yosys (ISC)
- web-tree-sitter: https://github.com/tree-sitter/tree-sitter (MIT)
- tree-sitter-verilog: https://github.com/tree-sitter/tree-sitter-verilog (MIT)
- elkjs: https://github.com/kieler/elkjs (EPL-2.0)
- d3: https://github.com/d3 (ISC)

## Algorithms

`src/ir/fromYosys.ts` reconstructs bus-level nets from Yosys bit ids and inserts split/join nodes for slices and concatenations. The idea follows netlistsvg (https://github.com/nturley/netlistsvg, MIT); no netlistsvg code was copied.

The gate symbol shapes in `webview/render/symbols.ts` are original drawings of the IEEE/ANSI distinctive shapes.
