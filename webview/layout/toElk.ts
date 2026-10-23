// ModuleView -> ELK graph. Pure and unit tested.
// Ports of the module become small boundary nodes pinned to the first/last layer.
// Node pins become ELK ports with fixed sides (inputs WEST, outputs EAST,
// clock/select SOUTH) and explicit indices so the drawing order is stable.
import type { ModuleView, Node, Pin, Port } from "../../src/ir/types";
import { nodeSize, PORT_NODE_HEIGHT, portNodeWidth, RIPPER_LABEL_CHAR, textWidth } from "../render/geometry";
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

/**
 * ELK FIXED_ORDER indexes ports clockwise starting at the north-west corner,
 * so WEST ports run bottom-to-top. We reverse west indices so pin order in the
 * IR (top-to-bottom) is preserved on screen. SOUTH runs right-to-left, also reversed.
 */
function elkPorts(node: Node): ElkPortIn[] {
  const groups: Record<string, Pin[]> = { NORTH: [], EAST: [], SOUTH: [], WEST: [] };
  for (const p of node.pins) groups[sideOf(p)]!.push(p);
  const out: ElkPortIn[] = [];
  let index = 0;
  const emit = (pins: Pin[], side: string, reverse: boolean): void => {
    const ordered = reverse ? [...pins].reverse() : pins;
    for (const p of ordered) {
      const label = ripperLabelSize(node, p);
      out.push({
        id: elkPortId(node.id, p.id),
        width: 1,
        height: 1,
        layoutOptions: { "elk.port.side": side, "elk.port.index": String(index++) },
        ...(label ? { labels: [label] } : {}),
      });
    }
  };
  emit(groups["NORTH"]!, "NORTH", false);
  emit(groups["EAST"]!, "EAST", false);
  emit(groups["SOUTH"]!, "SOUTH", true);
  emit(groups["WEST"]!, "WEST", true);
  return out;
}

/** Pins keep clear of the title row: boxes carry it at the top, flip-flops at the bottom. */
function portSurrounding(node: Node): string | undefined {
  switch (node.kind) {
    case "instance":
    case "blackbox":
    case "unknown":
      return "[top=18,left=0,bottom=4,right=0]";
    case "dff":
      return "[top=18,left=0,bottom=6,right=0]";
    default:
      return undefined;
  }
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
  const surrounding = portSurrounding(node);
  const ripper = node.kind === "split" || node.kind === "join";
  return {
    id: node.id,
    width: size.width,
    height: size.height,
    layoutOptions: {
      "elk.portConstraints": "FIXED_ORDER",
      ...(surrounding ? { "elk.spacing.portSurrounding": surrounding } : {}),
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

export function moduleToElk(view: ModuleView, options?: Record<string, string>): ElkGraphIn {
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
