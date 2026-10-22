// Structural parser factory: tree-sitter when the grammar loads, else the fallback scanner.
import { FallbackStructuralParser } from "./fallbackScanner";
import { loadVerilogLanguage, newParser, type GrammarPaths } from "./grammar";
import { TreeSitterStructuralParser } from "./treeSitterParser";
import type { StructuralParser } from "./types";

export type { StructuralParser } from "./types";
export { FallbackStructuralParser } from "./fallbackScanner";
export { TreeSitterStructuralParser } from "./treeSitterParser";

export async function createStructuralParser(
  paths: GrammarPaths,
  onFallback?: (reason: string) => void,
): Promise<StructuralParser> {
  try {
    const language = await loadVerilogLanguage(paths);
    return new TreeSitterStructuralParser(newParser(language));
  } catch (e) {
    onFallback?.(e instanceof Error ? e.message : String(e));
    return new FallbackStructuralParser();
  }
}
