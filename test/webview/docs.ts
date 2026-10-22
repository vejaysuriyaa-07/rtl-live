// Builds SchematicDocs for Playwright tests from fixtures using the structural pipeline.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicDoc } from "../../src/ir/types";
import { FallbackStructuralParser } from "../../src/structural/fallbackScanner";
import { structuralToIr } from "../../src/structural/toIr";
import { selectTop } from "../../src/structural/topSelect";
import { ROOT } from "./harness";

export function structuralDoc(fixture: string, generation = 1): SchematicDoc {
  const text = readFileSync(join(ROOT, "test", "fixtures", "hdlbits", fixture), "utf8");
  const file = new FallbackStructuralParser().parse(text);
  const top = selectTop({ modules: file.modules });
  return structuralToIr(file, { sourceUri: fixture, generation, top });
}
