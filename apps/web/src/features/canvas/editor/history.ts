import type { TLShape } from "./types";

interface Change {
  id: string;
  path: string[];
  before: unknown;
  after: unknown;
  restoreWithDefinition?: boolean;
}
interface Entry {
  changes: Change[];
  beforeOrder: string[];
  afterOrder: string[];
  beforeSelection: string[];
  afterSelection: string[];
}
export interface HistoryState {
  shapes: Map<string, TLShape>;
  order: string[];
  selected: string[];
}
const equal = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

function changesBetween(before: Map<string, TLShape>, after: Map<string, TLShape>): Change[] {
  const changes: Change[] = [];
  const editsDefinition = [...after].some(([id, shape]) => {
    const previous = before.get(id);
    return previous && shape.type === "workflow-node" && ["prompt", "model", "size", "quality", "inputIds"].some(key => !equal(previous.props[key], shape.props[key]));
  });
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(id), next = after.get(id);
    if (previous === next) continue;
    if (!previous || !next) {
      changes.push({ id, path: [], before: previous, after: next });
      continue;
    }
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (key === "props" || key === "meta") {
        const a = previous[key] ?? {}, b = next[key] ?? {};
        for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
          // Empty output fields still belong to the edited definition. Capture
          // them so undo/redo cannot pair a prompt with a later task's result.
          const restoreWithDefinition = editsDefinition && next.type === "workflow-node" && key === "props" && ["outputs", "status", "error"].includes(field);
          if (restoreWithDefinition || !equal(a[field], b[field])) changes.push({ id, path: [key, field], before: a[field], after: b[field], restoreWithDefinition });
        }
      } else if (!equal(previous[key as keyof TLShape], next[key as keyof TLShape])) {
        changes.push({ id, path: [key], before: previous[key as keyof TLShape], after: next[key as keyof TLShape] });
      }
    }
  }
  return changes;
}

export class EditorHistory {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private group: Entry | undefined;
  private grouping = false;

  get canUndo(): boolean { return Boolean(this.group?.changes.some(change => !equal(change.before, change.after)) || this.past.length); }
  get canRedo(): boolean { return this.future.length > 0; }

  clear(): void {
    this.past = [];
    this.future = [];
    this.group = undefined;
    this.grouping = false;
  }

  beginGroup(): void { this.endGroup(); this.grouping = true; }
  endGroup(): void {
    if (this.group) this.push(this.group);
    this.group = undefined;
    this.grouping = false;
  }

  record(before: HistoryState, after: HistoryState): void {
    const changes = changesBetween(before.shapes, after.shapes);
    if (!changes.length && equal(before.order, after.order)) return;
    const entry: Entry = { changes, beforeOrder: before.order, afterOrder: after.order, beforeSelection: before.selected, afterSelection: after.selected };
    this.future = [];
    if (!this.grouping) { this.push(entry); return; }
    if (!this.group) { this.group = entry; return; }
    for (const change of changes) {
      const existing = this.group.changes.find(item => item.id === change.id && equal(item.path, change.path));
      if (existing) { existing.after = change.after; existing.restoreWithDefinition ||= change.restoreWithDefinition; }
      else this.group.changes.push(change);
    }
    this.group.changes = this.group.changes.filter(change => change.restoreWithDefinition || !equal(change.before, change.after));
    this.group.afterOrder = after.order;
    this.group.afterSelection = after.selected;
  }

  undo(state: HistoryState): HistoryState | undefined {
    this.endGroup();
    const entry = this.past.pop();
    if (!entry) return;
    const result = this.apply(entry, state, "before");
    this.future.push(result.inverse);
    return result.state;
  }

  redo(state: HistoryState): HistoryState | undefined {
    this.endGroup();
    const entry = this.future.pop();
    if (!entry) return;
    const result = this.apply(entry, state, "after");
    this.past.push(result.inverse);
    return result.state;
  }

  private push(entry: Entry): void {
    if (!entry.changes.some(change => !equal(change.before, change.after)) && equal(entry.beforeOrder, entry.afterOrder)) return;
    this.past.push(entry);
    if (this.past.length > 100) this.past.shift();
  }

  private apply(entry: Entry, current: HistoryState, direction: "before" | "after") {
    const shapes = new Map(current.shapes);
    const changes: Change[] = [];
    for (const change of direction === "before" ? [...entry.changes].reverse() : entry.changes) {
      const shape = shapes.get(change.id);
      const value = change[direction];
      if (!change.path.length) {
        if (value) shapes.set(change.id, value as TLShape);
        else shapes.delete(change.id);
        changes.push({ ...change, before: direction === "before" ? value : shape, after: direction === "before" ? shape : value });
      } else if (shape) {
        const [key, field] = change.path;
        const record = shape as unknown as Record<string, unknown>;
        const actual = field ? (record[key] as Record<string, unknown> | undefined)?.[field] : record[key];
        // A background task may have updated this field since the edit.
        if (!change.restoreWithDefinition && !equal(actual, change[direction === "before" ? "after" : "before"])) continue;
        const next = field ? { ...(record[key] as object), [field]: value } : { ...record, [key]: value };
        if (field && value === undefined) delete (next as Record<string, unknown>)[field];
        shapes.set(change.id, (field ? { ...shape, [key]: next } : next) as TLShape);
        changes.push({ ...change, before: direction === "before" ? value : actual, after: direction === "before" ? actual : value });
      }
    }
    const desiredOrder = direction === "before" ? entry.beforeOrder : entry.afterOrder;
    const order = [...desiredOrder.filter(id => shapes.has(id)), ...current.order.filter(id => shapes.has(id) && !desiredOrder.includes(id))];
    const desiredSelection = direction === "before" ? entry.beforeSelection : entry.afterSelection;
    const selected = desiredSelection.filter(id => shapes.has(id));
    const restored = changes.filter(change => !change.path.length && change[direction]).map(change => change.id);
    const state = { shapes, order, selected: restored.length ? restored : selected };
    const inverse: Entry = {
      changes: direction === "before" ? changes.reverse() : changes,
      beforeOrder: direction === "before" ? state.order : current.order,
      afterOrder: direction === "before" ? current.order : state.order,
      beforeSelection: direction === "before" ? state.selected : current.selected,
      afterSelection: direction === "before" ? current.selected : state.selected
    };
    return { state, inverse };
  }
}
