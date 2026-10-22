// Intermediate representation shared by the extension host and the webview.
// Both the structural layer (tree-sitter) and the synthesis layer (Yosys)
// produce a SchematicDoc; the webview renders it without knowing which.

export const IR_VERSION = 1;

export type Fidelity = "structural" | "synthesized";

export interface SrcRange {
  /** 1-based line */
  line: number;
  /** 1-based column */
  column: number;
  endLine: number;
  endColumn: number;
}

export type PortDirection = "input" | "output" | "inout";

export interface Port {
  name: string;
  direction: PortDirection;
  /** Bit width; 0 means unknown (non-literal range) */
  width: number;
  /** Range text as written, e.g. "[7:0]" or "[N-1:0]"; absent for scalars */
  range?: string;
  src: SrcRange[];
  /** Overlay marker on a stale diagram: the port exists only in the newer (unparsed) text, or only in the old one */
  ghost?: "added" | "removed" | "changed";
  /** Recovered from broken text (drawn greyed out) */
  tentative?: boolean;
}

export type NodeKind =
  | "gate"
  | "reduce"
  | "mux"
  | "pmux"
  | "dff"
  | "arith"
  | "compare"
  | "shift"
  | "const"
  | "instance"
  | "blackbox"
  | "split"
  | "join"
  | "cloud"
  | "unknown";

export type PinSide = "west" | "east" | "south" | "north";

export interface Pin {
  /** Pin id, unique within the node (e.g. "A", "B", "Y", "D", "Q", "CLK", "in1") */
  id: string;
  /** Label shown next to the pin; empty string hides it */
  label: string;
  direction: "in" | "out" | "inout";
  side: PinSide;
  width: number;
  /** Net this pin connects to, or null when unconnected */
  net: string | null;
  /** True for inverted inputs rendered with a bubble */
  inverted?: boolean;
  /** Bit range label for split/join rippers, e.g. "[15:8]" */
  bits?: string;
}

export interface Node {
  /** Stable id derived from structure, never from Yosys auto names */
  id: string;
  kind: NodeKind;
  /** Operation: and/or/xor/xnor/nand/nor/not/buf for gate; and/or/xor/xnor/nand/nor for reduce;
   *  add/sub/mul/neg for arith; eq/ne/lt/le/gt/ge for compare; shl/shr/sshr/shift for shift. */
  op?: string;
  width: number;
  pins: Pin[];
  label: string;
  src: SrcRange[];
  /** For instance nodes: the module defined in this file to drill into */
  drillTarget?: string;
  /** For instance/blackbox nodes: the module type name */
  moduleType?: string;
  /** Extra info for tooltips (e.g. FSM state names, constant value) */
  info?: Record<string, string>;
  /** Warning badges, e.g. "latch" */
  warnings?: string[];
}

export interface NetEnd {
  node: string;
  pin: string;
}

export interface Net {
  id: string;
  /** User-visible name when the net is a named signal or port */
  name?: string;
  /** Other user names for the same bits (e.g. "state" when the net is named after port "out") */
  aliases?: string[];
  width: number;
  /** Clock or reset nets are drawn in their own style (Part B colour rules) */
  role?: "clock" | "reset";
  /** Semantic warnings drawn as a badge on the wire: "multiple drivers", "combinational loop" */
  warnings?: string[];
  /** Driver of this net; a port name ref uses node "port:<name>" */
  driver: NetEnd | null;
  sinks: NetEnd[];
  src: SrcRange[];
}

export interface ModuleView {
  name: string;
  ports: Port[];
  nodes: Node[];
  nets: Net[];
  src?: SrcRange;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  line?: number;
  column?: number;
  file?: string;
  source: "structural" | "synth" | "layout" | "host";
}

export type SynthViewKind = "rtl" | "gate";

export interface SchematicDoc {
  version: number;
  fidelity: Fidelity;
  /** For synthesized docs: which of the two synthesized views this is */
  view?: SynthViewKind;
  /** Name of the top module; may be empty when the document has no modules */
  top: string;
  modules: Record<string, ModuleView>;
  /** All module names found in the file, for the top dropdown */
  moduleNames: string[];
  diagnostics: Diagnostic[];
  sourceUri: string;
  generation: number;
}

export function emptyDoc(sourceUri: string, generation: number): SchematicDoc {
  return {
    version: IR_VERSION,
    fidelity: "structural",
    top: "",
    modules: {},
    moduleNames: [],
    diagnostics: [],
    sourceUri,
    generation,
  };
}
