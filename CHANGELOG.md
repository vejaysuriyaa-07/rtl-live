# Changelog

## 0.1.0

First release.

- Sidebar "Schematic" view with a strict CSP; works fully offline.
- Structural view updated on every keystroke (web-tree-sitter with tree-sitter-verilog, fallback scanner): module box, ports, wires, instances, logic clouds; tolerant to partial code.
- Synthesized view via Yosys: native binary or bundled wasm (`@yowasp/yosys`) in a worker thread with preloading, recycling, timeout and cancellation; LRU result cache.
- IEEE/ANSI gate symbols, reduction gates, muxes, flip-flops, arithmetic and comparator boxes, constants, split/join rippers for buses.
- Hierarchy with drill-down and breadcrumb; black-box stubs for undefined modules with inferred pin directions.
- Cursor-to-diagram and diagram-to-cursor linking, error banner with stale badge, theme support, 150 ms move tween, SVG/PNG export, editor panel.
