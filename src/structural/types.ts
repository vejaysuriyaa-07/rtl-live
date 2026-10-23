// Structural model: what the error-tolerant parser extracts from the text.
// Deliberately shallow; expressions are kept as text plus the identifiers they read.
import type { PortDirection, SrcRange } from "../ir/types";

export interface SPort {
  name: string;
  direction: PortDirection;
  /** 0 when the range is not a pair of literals */
  width: number;
  range?: string;
  src: SrcRange;
  /** Recovered from text inside a syntax error; drawn greyed out */
  tentative?: boolean;
}

export type DeclKind = "wire" | "reg" | "logic" | "other";

export interface SDecl {
  name: string;
  kind: DeclKind;
  width: number;
  range?: string;
  src: SrcRange;
}

export interface SAssign {
  /** Identifiers written (left side), in order */
  lhs: string[];
  /** Identifiers read (right side), deduplicated, in order of first appearance */
  rhs: string[];
  lhsText: string;
  rhsText: string;
  src: SrcRange;
}

export type AlwaysKind = "comb" | "seq";

export interface SAlways {
  kind: AlwaysKind;
  /** Sensitivity text as written, e.g. "@(posedge clk or negedge rst_n)" or "@(*)" */
  sensitivity: string;
  /** Identifiers assigned anywhere inside the block */
  assigned: string[];
  /** Left-hand side text of every assignment inside the block, in order (e.g. "q[3:0]", "{c, s}") */
  lhsTexts?: string[];
  /** Identifiers read inside the block (excluding ones only assigned) */
  read: string[];
  /** Clock signal names from posedge/negedge terms (seq only) */
  clocks: string[];
  src: SrcRange;
}

export interface SConnection {
  /** Formal port name for named connections; undefined for positional */
  port?: string;
  /** Position index (0-based) in the connection list */
  index: number;
  exprText: string;
  /** Identifiers in the actual expression; empty for unconnected or constant */
  idents: string[];
  /** True when the actual is a literal constant such as 1'b0 */
  isConst: boolean;
  src: SrcRange;
}

export interface SInstance {
  moduleType: string;
  name: string;
  connections: SConnection[];
  src: SrcRange;
}

export interface SParam {
  name: string;
  valueText: string;
  src: SrcRange;
}

export interface SModule {
  name: string;
  ports: SPort[];
  decls: SDecl[];
  assigns: SAssign[];
  always: SAlways[];
  instances: SInstance[];
  localparams: SParam[];
  /** True when the module's subtree contains ERROR or MISSING nodes */
  hasErrors: boolean;
  src: SrcRange;
}

export interface SError {
  line: number;
  column: number;
  message: string;
}

export interface StructuralFile {
  modules: SModule[];
  errors: SError[];
  hasErrors: boolean;
  parser: "tree-sitter" | "fallback";
}

export interface StructuralParser {
  readonly name: "tree-sitter" | "fallback";
  parse(text: string): StructuralFile;
}
