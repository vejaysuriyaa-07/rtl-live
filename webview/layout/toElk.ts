// ModuleView -> ELK graph. Pure and unit tested.
// Ports of the module become small boundary nodes pinned to the first/last layer.
// Node pins become ELK ports at fixed positions (inputs WEST, outputs EAST,
// clock/select SOUTH) in IR order at a 16 px pitch, so a wire crossing next to a pin
// is never closer than that to the junction dot feeding the pin beside it (bug 19).
import type { ModuleView, Node, Pin, Port } from "../../src/ir/types";
import { LOGICAL_TAG_H, nodeSize, PIN_PITCH, PORT_NODE_HEIGHT, portNodeWidth, RIPPER_LABEL_CHAR, textWidth } from "../render/geometry";
import { expandLogicalGates } from "../render/logical";
import type { ElkEdgeIn, ElkGraphIn, ElkNodeIn, ElkPortIn } from "./types";

export const ROOT_LAYOUT_OPTIONS: Readonly<Record<string, string>> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
  // Spacing chosen by A/B over every fixture (NOTES.md, v0.3 Phase 2): parallel wires of
  // different nets stay at least 8 px apart and fan-out trunks get their own channels.
  "elk.spacing.nodeNode": "28",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.layered.spacing.edgeNodeBetweenLayers": "28",
  "elk.spacing.edgeNode": "16",
  "elk.spacing.edgeEdge": "16",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
  // Brandes-Koepf placed every fixture with fewer crossings than network simplex (259 versus
  // 307 over all views) and no parallel wires of different nets closer than 11 px.
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  // Ports with nothing attached (a half-typed header) must still line the left and right
  // edges; packing disconnected nodes into components would lay them out as a grid (bug 10).
  "elk.separateConnectedComponents": "false",
  // Fan-out from one pin shares its trunk and gets junction points where it splits (Part B lines).
  "elk.layered.mergeEdges": "true",
  "elk.layered.thoroughness": "7",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
};

export function portNodeId(name: string): string {
  return `port:${name}`;
}

export function elkPortId(nodeId: string, pinId: string): string {
  return `${nodeId}.${pinId}`;
}

function sideOf(pin: Pin): "WEST" | "EAST" | "SOUTH" | "NORTH" {
  switch (pin.side) {
    case "west":
      return "WEST";
    case "east":
      return "EAST";
    case "south":
      return "SOUTH";
    case "north":
      return "NORTH";
  }
}

/** Pins keep clear of the title row: boxes carry it at the top, flip-flops at the bottom. */
export function pinBand(node: Node): { top: number; bottom: number } {
  if (node.kind === "gate" && node.info?.["logical"] === "1") return { top: 0, bottom: LOGICAL_TAG_H };
  switch (node.kind) {
    case "instance":
    case "blackbox":
    case "unknown":
      return { top: 18, bottom: 4 };
    case "dff":
      return { top: 18, bottom: 6 };
    default:
      return { top: 0, bottom: 0 };
  }
}

/** Centres of `n` pins at PIN_PITCH, centred in [lo, hi]; a single pin sits in the middle. */
export function pinCentres(n: number, lo: number, hi: number): number[] {
  const start = (lo + hi) / 2 - ((n - 1) * PIN_PITCH) / 2;
  return Array.from({ length: n }, (_, i) => start + i * PIN_PITCH);
}

/**
 * Ports at fixed positions, one pitch apart, in IR order top-to-bottom (west and east) and
 * left-to-right (south and north). A port is a 1 by 1 square just outside the node border,
 * as ELK itself places them, and the edge attaches to its centre.
 */
function elkPorts(node: Node): ElkPortIn[] {
  const size = nodeSize(node);
  const band = pinBand(node);
  const groups: Record<string, Pin[]> = { NORTH: [], EAST: [], SOUTH: [], WEST: [] };
  for (const p of node.pins) groups[sideOf(p)]!.push(p);
  const out: ElkPortIn[] = [];
  const emit = (pins: Pin[], side: string): void => {
    const vertical = side === "WEST" || side === "EAST";
    const centres = vertical ? pinCentres(pins.length, band.top, size.height - band.bottom) : pinCentres(pins.length, 0, size.width);
    pins.forEach((p, i) => {
      const c = centres[i]! - 0.5;
      const label = ripperLabelSize(node, p);
      out.push({
        id: elkPortId(node.id, p.id),
        width: 1,
        height: 1,
        x: vertical ? (side === "WEST" ? -1 : size.width) : c,
        y: vertical ? c : side === "NORTH" ? -1 : size.height,
        layoutOptions: { "elk.port.side": side },
        ...(label ? { labels: [label] } : {}),
      });
    });
  };
  emit(groups["NORTH"]!, "NORTH");
  emit(groups["EAST"]!, "EAST");
  emit(groups["SOUTH"]!, "SOUTH");
  emit(groups["WEST"]!, "WEST");
  return out;
}

/**
 * Ripper range labels hang off the bar above their own wire. Declaring them as ELK port
 * labels makes the layered algorithm reserve that room in the node margin, which the edge
 * router keeps clear of (bug 15); plain elk.margins are ignored by the router.
 */
function ripperLabelSize(node: Node, pin: Pin): { text: string; width: number; height: number } | undefined {
  if ((node.kind !== "split" && node.kind !== "join") || !pin.bits) return undefined;
  const text = pin.label ? pin.label : pin.bits;
  return { text, width: textWidth(text, RIPPER_LABEL_CHAR) + 8, height: 10 };
}

function logicNode(node: Node): ElkNodeIn {
  const size = nodeSize(node);
  const ripper = node.kind === "split" || node.kind === "join";
  return {
    id: node.id,
    width: size.width,
    height: size.height,
    layoutOptions: {
      "elk.portConstraints": "FIXED_POS",
      ...(ripper ? { "elk.portLabels.placement": "OUTSIDE" } : {}),
    },
    ports: elkPorts(node),
  };
}

function portNode(port: Port): ElkNodeIn {
  const isInput = port.direction === "input";
  return {
    id: portNodeId(port.name),
    width: portNodeWidth(port),
    height: PORT_NODE_HEIGHT,
    layoutOptions: {
      "elk.portConstraints": "FIXED_SIDE",
      // Own layer at each edge: ports with nothing attached still line up left and right (bug 10).
      "elk.layered.layering.layerConstraint": isInput ? "FIRST_SEPARATE" : "LAST_SEPARATE",
    },
    ports: [
      {
        id: elkPortId(portNodeId(port.name), port.name),
        width: 1,
        height: 1,
        layoutOptions: { "elk.port.side": isInput ? "EAST" : "WEST" },
      },
    ],
  };
}

export function moduleToElk(rawView: ModuleView, options?: Record<string, string>): ElkGraphIn {
  const view = expandLogicalGates(rawView);
  const children: ElkNodeIn[] = [];
  for (const p of view.ports) children.push(portNode(p));
  const sorted = [...view.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const n of sorted) children.push(logicNode(n));
  const known = new Set(children.map((c) => c.id));
  const edges: ElkEdgeIn[] = [];
  const sortedNets = [...view.nets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const net of sortedNets) {
    if (!net.driver || !known.has(net.driver.node)) continue;
    const src = elkPortId(net.driver.node, net.driver.pin);
    net.sinks.forEach((s, k) => {
      if (!known.has(s.node)) return;
      edges.push({ id: `edge:${net.id}:${k}`, sources: [src], targets: [elkPortId(s.node, s.pin)] });
    });
  }
  return { id: "root", layoutOptions: { ...ROOT_LAYOUT_OPTIONS, ...(options ?? {}) }, children, edges };
}
