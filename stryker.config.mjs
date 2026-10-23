// Mutation testing with StrykerJS. Mutates the pure transform layers (parse -> IR -> ELK -> SVG)
// and runs the vitest suites (unit, golden, accuracy) against every mutant.
// Run: npm run test:mutation. Reports land in artifacts/mutation/ (not tracked).
// Layers that talk to VS Code, spawn Yosys, or touch the DOM are left out: their tests are
// integration and Playwright suites, which Stryker cannot drive from vitest.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.mts" },
  coverageAnalysis: "perTest",
  // Regex mutants (one per quantifier and class) outnumber every other kind three to one and are
  // mostly whitespace variants; they stay out of the default run. Add them back with --mutator.
  mutator: { excludedMutations: ["Regex"] },
  mutate: [
    "src/ir/**/*.ts",
    "src/structural/**/*.ts",
    "src/shared/protocol.ts",
    "src/synth/script.ts",
    "src/synth/blackboxStubs.ts",
    "src/synth/yosysJson.ts",
    "src/extension/scheduler.ts",
    "src/extension/cache.ts",
    "src/extension/lifecycle.ts",
    "src/extension/webviewHtml.ts",
    "webview/layout/toElk.ts",
    "webview/layout/postprocess.ts",
    "webview/render/geometry.ts",
    "webview/render/svg.ts",
    "webview/render/symbols.ts",
    "webview/render/tooltips.ts",
    "webview/render/logical.ts",
    "webview/ui/legend.ts",
    "webview/interaction/focusModel.ts",
    "!src/ir/types.ts",
    "!src/structural/types.ts",
  ],
  ignorePatterns: [".vscode-test", "artifacts", "reports", "media", "test/scratch", "*.vsix", ".stryker-tmp"],
  tempDirName: ".stryker-tmp",
  timeoutMS: 10000,
  timeoutFactor: 2,
  dryRunTimeoutMinutes: 10,
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "artifacts/mutation/index.html" },
  jsonReporter: { fileName: "artifacts/mutation/mutation.json" },
  clearTextReporter: { allowColor: false, logTests: false, reportMutants: true, reportScoreTable: true },
  thresholds: { high: 90, low: 75, break: null },
  incremental: true,
  incrementalFile: "artifacts/mutation/incremental.json",
  logLevel: "info",
};
