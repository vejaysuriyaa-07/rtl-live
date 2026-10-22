# Third-party notices

RTL Live bundles or depends on the following open source software.

| Component | License | Use |
| --- | --- | --- |
| Yosys, via @yowasp/yosys | ISC | synthesis to a JSON netlist (wasm bundle shipped in `dist/gen/`) |
| web-tree-sitter | MIT | incremental, error-tolerant parsing runtime |
| tree-sitter-verilog | MIT | Verilog grammar compiled to `assets/wasm/tree-sitter-verilog.wasm` |
| elkjs (Eclipse Layout Kernel) | EPL-2.0 | layered layout of the schematic |
| d3-selection, d3-zoom | ISC | pan and zoom |

Full license texts are available from each project's repository and in `node_modules/<package>/LICENSE` after `npm install`.

Algorithms ported from other projects are listed here as they are added, with the source file in a header comment.
