// Pan and zoom with d3-zoom on the root <svg>; the diagram lives in a <g> that gets the transform.
import { select, type Selection } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";

export class ZoomController {
  private readonly behavior: ZoomBehavior<SVGSVGElement, unknown>;
  private readonly svgSel: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly gSel: Selection<SVGGElement, unknown, null, undefined>;
  private current: ZoomTransform = zoomIdentity;

  constructor(
    private readonly svg: SVGSVGElement,
    g: SVGGElement,
  ) {
    this.svgSel = select(svg);
    this.gSel = select(g);
    this.behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .filter((ev: Event) => {
        // Allow wheel + drag; ignore double click (used for drill-down).
        return ev.type !== "dblclick";
      })
      .on("zoom", (ev: { transform: ZoomTransform }) => {
        this.current = ev.transform;
        this.gSel.attr("transform", ev.transform.toString());
      });
    this.svgSel.call(this.behavior);
  }

  get transform(): ZoomTransform {
    return this.current;
  }

  fit(contentWidth: number, contentHeight: number, _animate: boolean): void {
    const rect = this.svg.getBoundingClientRect();
    const vw = Math.max(rect.width, 10);
    const vh = Math.max(rect.height, 10);
    const pad = 16;
    const scale = Math.min((vw - pad * 2) / Math.max(contentWidth, 1), (vh - pad * 2) / Math.max(contentHeight, 1), 2);
    const tx = (vw - contentWidth * scale) / 2;
    const ty = (vh - contentHeight * scale) / 2;
    const t = zoomIdentity.translate(tx, ty).scale(scale);
    this.svgSel.call(this.behavior.transform, t);
  }

  zoomBy(factor: number): void {
    this.svgSel.call(this.behavior.scaleBy, factor);
  }

  setTransform(t: { x: number; y: number; k: number }): void {
    this.svgSel.call(this.behavior.transform, zoomIdentity.translate(t.x, t.y).scale(t.k));
  }
}
