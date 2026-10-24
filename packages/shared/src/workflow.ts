import type { GenerationDependencyEdge } from "./generation.js";

export type DependencyGraphError = "duplicate" | "missing" | "self" | "cycle";

export function dependencyGraphError(ids: string[], edges: GenerationDependencyEdge[]): DependencyGraphError | null {
  const nodes = new Set(ids);
  if (nodes.size !== ids.length) return "duplicate";
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  const indegrees = new Map(ids.map((id) => [id, 0]));
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!nodes.has(edge.fromJobId) || !nodes.has(edge.toJobId)) return "missing";
    if (edge.fromJobId === edge.toJobId) return "self";
    const key = JSON.stringify([edge.fromJobId, edge.toJobId]);
    if (seen.has(key)) return "duplicate";
    seen.add(key);
    outgoing.get(edge.fromJobId)!.push(edge.toJobId);
    indegrees.set(edge.toJobId, indegrees.get(edge.toJobId)! + 1);
  }
  const queue = ids.filter((id) => indegrees.get(id) === 0);
  for (let i = 0; i < queue.length; i += 1) {
    for (const next of outgoing.get(queue[i])!) {
      indegrees.set(next, indegrees.get(next)! - 1);
      if (indegrees.get(next) === 0) queue.push(next);
    }
  }
  return queue.length === ids.length ? null : "cycle";
}
