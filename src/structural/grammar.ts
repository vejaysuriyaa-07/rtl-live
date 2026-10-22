// Loads web-tree-sitter and the Verilog grammar wasm. Paths are resolved by the
// caller (extension: dist/; tests: assets/wasm/) so this file has no vscode import.
import { Language, Parser } from "web-tree-sitter";

export interface GrammarPaths {
  /** Directory containing web-tree-sitter.wasm */
  runtimeDir: string;
  /** Full path to tree-sitter-verilog.wasm */
  grammarPath: string;
}

let initPromise: Promise<void> | undefined;
let languagePromise: Promise<Language> | undefined;

export async function loadVerilogLanguage(paths: GrammarPaths): Promise<Language> {
  initPromise ??= Parser.init({
    locateFile: (file: string) => `${paths.runtimeDir}/${file}`,
  });
  await initPromise;
  languagePromise ??= Language.load(paths.grammarPath);
  return languagePromise;
}

export function newParser(language: Language): Parser {
  const p = new Parser();
  p.setLanguage(language);
  return p;
}

/** Expected CLI/runtime minor version pairing, asserted by a unit test. */
export const WEB_TREE_SITTER_VERSION = "0.27.1";
export const TREE_SITTER_CLI_VERSION = "0.27.1";
