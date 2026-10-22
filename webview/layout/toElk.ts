// ModuleView -> ELK graph. Pure and unit tested.
// Ports of the module become small boundary nodes pinned to the first/last layer.
// Node pins become ELK ports with fixed sides (inputs WEST, outputs EAST,
// clock/select SOUTH) and explicit indices so the drawing order is stable.
import type { ModuleView, Node, Pin, Port } from "../../src/ir/types";
import { nodeSize, PORT_NODE_HEIGHT, portNodeWidth } from "../render/geometry";
import type { ElkEdgeIn, ElkGraphIn, ElkNodeIn, ElkPortIn } from "./types";

export const ROOT_LAYOUT_OPTIONS: Readonly<Record<string, string>> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
  "elk.spacing.nodeNode": "24",
  "elk.layered.spacing.nodeNodeBetweenLayers": "44",
  "elk.layered.spacing.edgeNodeBetweenLayers": "20",
  "elk.spacing.edgeNode": "14",
  "elk.spacing.edgeEdge": "10",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "10",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
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
      out.push({
        id: elkPortId(node.id, p.id),
        width: 1,
        height: 1,
        layoutOptions: { "elk.port.side": side, "elk.port.index": String(index++) },
      });
    }
  };
  emit(groups["NORTH"]!, "NORTH", false);
  emit(groups["EAST"]!, "EAST", false);
  emit(groups["SOUTH"]!, "SOUTH", true);
  emit(groups["WEST"]!, "WEST", true);
  return out;
}

function logicNode(node: Node): ElkNodeIn {
  const size = nodeSize(node);
  return {
    id: node.id,
    width: size.width,
    height: size.height,
    layoutOptions: { "elk.portConstraints": "FIXED_ORDER" },
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
      "elk.layered.layering.layerConstraint": isInput ? "FIRST" : "LAST",
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

export function moduleToElk(view: ModuleView): ElkGraphIn {
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
  return { id: "root", layoutOptions: { ...ROOT_LAYOUT_OPTIONS }, children, edges };
}
