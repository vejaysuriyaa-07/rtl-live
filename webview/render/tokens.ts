// Design tokens: the one source of truth for every visual value the renderer, the layout
// and the stylesheet use. webview/styles.css repeats the same values as custom properties
// on :root (a stylesheet cannot import a module), and test/unit/tokens.test.ts fails the
// moment the two disagree.
//
// The look: symbols in the editor foreground, wires a step lighter, one accent (the theme
// link colour) for ports and junction dots only, warning and error colours only for real
// warnings and errors, everything else greyscale.

/** Stroke widths in px. */
export const STROKE = {
  wire: 1.25,
  bus: 2.5,
  symbol: 1.75,
  frame: 1,
  /** Fine details drawn on a symbol: inversion bubbles, the clock triangle, bus slashes. */
  detail: 1.25,
  /** High contrast themes draw every border this wide. */
  highContrast: 2,
} as const;

/** Corner radii in px. */
export const RADIUS = {
  node: 6,
  port: 4,
  /** Arc at a wire bend. */
  bend: 4,
  /** A bend this close to a junction dot or a pin stays sharp, so it can never read as a connection. */
  bendGuard: 8,
} as const;

/** Fills as a percentage of the foreground colour mixed over the background. */
export const FILL_PERCENT = { body: 6, frame: 3, dashed: 0, port: 12 } as const;

/** Wires sit at this share of the foreground; everything outside a focused net fades to `faded`. */
export const OPACITY = { wire: 0.7, faded: 0.35 } as const;

/** Font sizes in px. Labels are monospace, titles and glyphs are the UI sans. */
export const FONT_PX = { label: 11, title: 12, small: 10, tag: 8 } as const;

/** Junction dot radius as a multiple of the wire stroke. */
export const JUNCTION_FACTOR = 2.5;

/** Hover glow radius in px. */
export const GLOW_PX = 2;

/** Layout tweens and hover transitions. */
export const MOTION_MS = 150;

/** Margin around an exported diagram in px. */
export const EXPORT_MARGIN = 24;

/** Custom properties on :root in webview/styles.css, in the units the stylesheet uses. */
export const CSS_TOKENS: Readonly<Record<string, string>> = {
  "--rl-stroke-wire": `${STROKE.wire}px`,
  "--rl-stroke-bus": `${STROKE.bus}px`,
  "--rl-stroke-symbol": `${STROKE.symbol}px`,
  "--rl-stroke-frame": `${STROKE.frame}px`,
  "--rl-stroke-detail": `${STROKE.detail}px`,
  "--rl-radius-node": `${RADIUS.node}px`,
  "--rl-radius-port": `${RADIUS.port}px`,
  "--rl-wire": `color-mix(in srgb, var(--rl-fg) ${OPACITY.wire * 100}%, var(--rl-bg))`,
  "--rl-fill-body": `color-mix(in srgb, var(--rl-fg) ${FILL_PERCENT.body}%, var(--rl-bg))`,
  "--rl-fill-frame": `color-mix(in srgb, var(--rl-fg) ${FILL_PERCENT.frame}%, var(--rl-bg))`,
  "--rl-fill-dashed": `color-mix(in srgb, var(--rl-fg) ${FILL_PERCENT.dashed}%, var(--rl-bg))`,
  "--rl-fill-port": `color-mix(in srgb, var(--rl-accent) ${FILL_PERCENT.port}%, var(--rl-bg))`,
  "--rl-faded": `${OPACITY.faded}`,
  "--rl-font-label": `${FONT_PX.label}px`,
  "--rl-font-title": `${FONT_PX.title}px`,
  "--rl-font-small": `${FONT_PX.small}px`,
  "--rl-font-tag": `${FONT_PX.tag}px`,
  "--rl-glow": `${GLOW_PX}px`,
  "--rl-motion": `${MOTION_MS}ms`,
};
