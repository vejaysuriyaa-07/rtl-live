// Minimal ELK graph types used by the webview. Mirrors elkjs's JSON format
// without importing its types so the pure layout code stays dependency free.

export interface ElkLayoutOptions {
  [key: string]: string;
}

export interface ElkPortIn {
  id: string;
  width: number;
  height: number;
  layoutOptions: ElkLayoutOptions;
}

export interface ElkNodeIn {
  id: string;
  width: number;
  height: number;
  layoutOptions: ElkLayoutOptions;
  ports: ElkPortIn[];
}

export interface ElkEdgeIn {
  id: string;
  sources: string[];
  targets: string[];
}

export interface ElkGraphIn {
  id: string;
  layoutOptions: ElkLayoutOptions;
  children: ElkNodeIn[];
  edges: ElkEdgeIn[];
}

export interface ElkPoint {
  x: number;
  y: number;
}

export interface ElkPortOut extends ElkPortIn {
  x: number;
  y: number;
}

export interface ElkNodeOut {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ports?: ElkPortOut[];
}

export interface ElkEdgeSection {
  id: string;
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  bendPoints?: ElkPoint[];
}

export interface ElkEdgeOut {
  id: string;
  sources: string[];
  targets: string[];
  sections?: ElkEdgeSection[];
  junctionPoints?: ElkPoint[];
}

export interface ElkGraphOut {
  id: string;
  x?: number;
  y?: number;
  width: number;
  height: number;
  children: ElkNodeOut[];
  edges: ElkEdgeOut[];
}
