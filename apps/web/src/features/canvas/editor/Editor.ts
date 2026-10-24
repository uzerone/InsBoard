import {
  invalidatedWorkflowUpdates,
  isWorkflowNode,
  normalizeWorkflowProps,
  workflowBusy
} from "../../workflow/model";
import { canvasNodeNumber } from "../node-number";
import {
  boundsForShape,
  CAMERA_EASE_OUT,
  cubicBezierEase,
  DEFAULT_CAMERA_ANIMATION_DURATION,
  imageSizeAtOriginalRatio
} from "./geometry";
import { EditorHistory, type HistoryState } from "./history";
import { isRecord, normalizeAsset, normalizeShape, recordsFromSnapshot } from "./snapshot";
import {
  type Camera,
  type CameraAnimationOptions,
  type CanvasBounds,
  type EditorEventListener,
  type StoreListener,
  type TLAsset,
  type TLAssetId,
  type TLEditorSnapshot,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
  type TLStoreSnapshot
} from "./types";

export class Editor {
  private assets = new Map<TLAssetId, TLAsset>();
  private shapes = new Map<TLShapeId, TLShape>();
  private order: TLShapeId[] = [];
  private lastNodeNumber = 0;
  private snapToGrid = false;
  private selectedIds = new Set<TLShapeId>();
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private container: HTMLElement | null = null;
  private storeListeners = new Set<StoreListener>();
  private eventListeners = new Set<EditorEventListener>();
  private cameraListeners = new Set<EditorEventListener>();
  private revision = 0;
  private cameraRevision = 0;
  private cameraNotificationFrame: number | undefined;
  private cameraAnimationFrame: number | undefined;
  private initializedCamera = false;

  private history = new EditorHistory();
  private transactionDepth = 0;
  private ignoringHistory = false;
  private pendingChange = false;
  private pendingDocumentChange = false;

  readonly store = {
    allRecords: (): Array<TLShape | TLAsset> => [...this.assets.values(), ...this.order.flatMap((id) => {
      const shape = this.shapes.get(id);
      return shape ? [shape] : [];
    })],
    listen: (listener: StoreListener): (() => void) => {
      this.storeListeners.add(listener);
      return () => this.storeListeners.delete(listener);
    }
  };

  getRevision = (): number => this.revision;
  getCameraRevision = (): number => this.cameraRevision;
  getVisualRevision = (): number => this.revision + this.cameraRevision;

  subscribe = (listener: () => void): (() => void) => {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  };

  subscribeCamera = (listener: () => void): (() => void) => {
    this.cameraListeners.add(listener);
    return () => this.cameraListeners.delete(listener);
  };

  subscribeVisual = (listener: () => void): (() => void) => {
    this.eventListeners.add(listener);
    this.cameraListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
      this.cameraListeners.delete(listener);
    };
  };

  setContainer(container: HTMLElement | null): void {
    this.container = container;
  }

  dispose(): void {
    this.cancelCameraAnimation();
    if (this.cameraNotificationFrame !== undefined) {
      window.cancelAnimationFrame(this.cameraNotificationFrame);
      this.cameraNotificationFrame = undefined;
    }
  }

  getContainer(): HTMLElement {
    if (!this.container) {
      throw new Error("The canvas is not mounted.");
    }
    return this.container;
  }

  initializeCamera(): void {
    if (this.initializedCamera || !this.container) {
      return;
    }
    const rect = this.container.getBoundingClientRect();
    this.updateCamera({ x: rect.width / 2, y: rect.height / 2, zoom: 1 });
    this.initializedCamera = true;
    this.scheduleCameraNotification();
  }

  loadSnapshot(snapshot: TLEditorSnapshot | TLStoreSnapshot | undefined): void {
    this.history.clear();
    this.snapToGrid = (snapshot && "document" in snapshot ? snapshot.document?.snapToGrid : snapshot?.snapToGrid) === true;
    this.assets.clear();
    this.shapes.clear();
    this.order = [];
    for (const record of Object.values(recordsFromSnapshot(snapshot))) {
      const asset = normalizeAsset(record);
      if (asset) {
        this.assets.set(asset.id, asset);
        continue;
      }
      const shape = normalizeShape(record);
      if (shape && (shape.type === "image" || shape.type === "generation-placeholder" || isWorkflowNode(shape))) {
        if (isWorkflowNode(shape)) shape.props = normalizeWorkflowProps(shape.props as unknown as Record<string, unknown>);
        this.shapes.set(shape.id, shape);
        this.order.push(shape.id);
      }
    }
    const savedCounter = snapshot && "document" in snapshot ? snapshot.document?.lastNodeNumber : snapshot?.lastNodeNumber;
    this.lastNodeNumber = Math.max(
      Number.isSafeInteger(savedCounter) && Number(savedCounter) > 0 ? Number(savedCounter) : 0,
      ...Array.from(this.shapes.values(), canvasNodeNumber)
    );
    const usedNumbers = new Set<number>();
    for (const shape of this.shapes.values()) {
      const previous = canvasNodeNumber(shape);
      const nodeNumber = previous && !usedNumbers.has(previous) ? previous : ++this.lastNodeNumber;
      usedNumbers.add(nodeNumber);
      shape.meta = { ...shape.meta, nodeNumber };
      if (shape.type === "image") {
        const size = imageSizeAtOriginalRatio(shape, this.assets.get(shape.props.assetId));
        shape.props = { ...shape.props, ...size };
      }
    }
    this.selectedIds.clear();
    this.emit(false);
  }

  getSnapshot(): TLStoreSnapshot {
    const store: Record<string, TLShape | TLAsset> = {};
    for (const asset of this.assets.values()) {
      store[asset.id] = asset;
    }
    for (const id of this.order) {
      const shape = this.shapes.get(id);
      if (shape) {
        store[id] = shape;
      }
    }
    return { store, lastNodeNumber: this.lastNodeNumber, snapToGrid: this.snapToGrid };
  }

  isSnapToGridEnabled(): boolean { return this.snapToGrid; }

  setSnapToGrid(enabled: boolean): void {
    if (this.snapToGrid === enabled) return;
    this.snapToGrid = enabled;
    this.emit(true);
  }

  getCamera(): Camera {
    return this.camera;
  }

  setCamera(camera: Camera): void {
    this.cancelCameraAnimation();
    this.updateCamera(camera);
    this.scheduleCameraNotification();
  }

  cancelCameraAnimation(): void {
    if (this.cameraAnimationFrame !== undefined) {
      window.cancelAnimationFrame(this.cameraAnimationFrame);
      this.cameraAnimationFrame = undefined;
    }
  }

  on(_event: "change", listener: EditorEventListener): void {
    this.eventListeners.add(listener);
  }

  off(_event: "change", listener: EditorEventListener): void {
    this.eventListeners.delete(listener);
  }

  run(callback: () => void, options: { history?: "record" | "ignore"; } = {}): void {
    if (this.transactionDepth) { callback(); return; }
    const before = options.history === "ignore" ? undefined : this.historyState();
    this.transactionDepth++;
    this.ignoringHistory = options.history === "ignore";
    try { callback(); } finally {
      this.transactionDepth--;
      if (this.pendingDocumentChange && before) this.history.record(before, this.historyState());
      const changed = this.pendingChange, documentChanged = this.pendingDocumentChange;
      this.pendingChange = false;
      this.pendingDocumentChange = false;
      this.ignoringHistory = false;
      if (changed) this.emit(documentChanged);
    }
  }

  beginHistoryGroup(): void { this.history.beginGroup(); }
  endHistoryGroup(): void { this.history.endGroup(); }
  canUndo(): boolean { return this.history.canUndo && !workflowBusy(this); }
  canRedo(): boolean { return this.history.canRedo && !workflowBusy(this); }
  undo(): void { if (this.canUndo()) this.restoreHistory(this.history.undo(this.historyState())); }
  redo(): void { if (this.canRedo()) this.restoreHistory(this.history.redo(this.historyState())); }

  private historyState(): HistoryState {
    return { shapes: new Map(this.shapes), order: [...this.order], selected: [...this.selectedIds] };
  }

  private restoreHistory(state: HistoryState | undefined): void {
    if (!state) return;
    this.shapes = state.shapes;
    this.order = state.order;
    this.selectedIds = new Set(state.selected);
    this.emit(true);
  }

  getShape<TShape extends TLShape = TLShape>(shapeOrId: TLShapeId | TShape): TShape | undefined {
    const id = typeof shapeOrId === "string" ? shapeOrId : shapeOrId.id;
    return this.shapes.get(id) as TShape | undefined;
  }

  getAsset(assetId: TLAssetId): TLAsset | undefined {
    return this.assets.get(assetId);
  }

  getCurrentPageShapes(): TLShape[] {
    return this.order.flatMap((id) => {
      const shape = this.shapes.get(id);
      return shape ? [shape] : [];
    });
  }

  getSelectedShapes(): TLShape[] {
    return this.order.flatMap((id) => {
      const shape = this.selectedIds.has(id) ? this.shapes.get(id) : undefined;
      return shape ? [shape] : [];
    });
  }

  getSelectedShapeIds(): TLShapeId[] {
    return [...this.selectedIds];
  }

  select(...ids: TLShapeId[]): void {
    this.selectedIds = new Set(ids.filter((id) => this.shapes.has(id)));
    this.emit(false);
  }

  selectNone(): void {
    this.select();
  }

  toggleSelected(id: TLShapeId): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else if (this.shapes.has(id)) {
      this.selectedIds.add(id);
    }
    this.emit(false);
  }

  createAssets(assets: TLAsset[]): void {
    if (!this.transactionDepth) { this.run(() => this.createAssets(assets)); return; }
    if (!assets.length) return;
    for (const asset of assets) {
      this.assets.set(asset.id, asset);
    }
    this.emit(true);
  }

  createShapes<TShape extends TLShape = TLShape>(shapes: Array<Partial<TShape> & Pick<TShape, "id" | "type">>): void {
    if (!this.transactionDepth) { this.run(() => this.createShapes(shapes)); return; }
    if (!shapes.length) return;
    for (const input of shapes) {
      const shape = {
        ...input,
        id: input.id,
        typeName: "shape",
        type: input.type,
        x: typeof input.x === "number" ? input.x : 0,
        y: typeof input.y === "number" ? input.y : 0,
        props: isRecord(input.props) ? input.props : {}
      } as unknown as TLShape;
      const previous = canvasNodeNumber(this.shapes.get(shape.id));
      const requested = canvasNodeNumber(shape);
      const available = requested && !Array.from(this.shapes.values()).some((existing) => existing.id !== shape.id && canvasNodeNumber(existing) === requested);
      const nodeNumber = previous || (available ? requested : ++this.lastNodeNumber);
      this.lastNodeNumber = Math.max(this.lastNodeNumber, nodeNumber);
      shape.meta = { ...shape.meta, nodeNumber };
      this.shapes.set(shape.id, shape);
      if (!this.order.includes(shape.id)) {
        this.order.push(shape.id);
      }
    }
    this.emit(true);
  }

  updateShapes<TShape extends TLShape = TLShape>(updates: Array<TLShapePartial<TShape>>): void {
    if (!this.transactionDepth) { this.run(() => this.updateShapes(updates)); return; }
    if (!updates.some(update => this.shapes.has(update.id))) return;
    for (const update of updates) {
      const current = this.shapes.get(update.id);
      if (!current) {
        continue;
      }
      const nextMeta = update.meta ? { ...current.meta } : current.meta;
      if (update.meta && nextMeta) {
        for (const [key, value] of Object.entries(update.meta)) {
          if (value === undefined) {
            delete nextMeta[key];
          } else {
            nextMeta[key] = value;
          }
        }
      }
      this.shapes.set(update.id, {
        ...current,
        ...(typeof update.x === "number" ? { x: update.x } : {}),
        ...(typeof update.y === "number" ? { y: update.y } : {}),
        ...(update.meta ? { meta: nextMeta } : {}),
        props: update.props ? { ...current.props, ...update.props } : current.props
      });
    }
    this.emit(true);
  }

  moveShapes(ids: TLShapeId[], dx: number, dy: number): void {
    if (!this.transactionDepth) { this.run(() => this.moveShapes(ids, dx, dy)); return; }
    if ((!dx && !dy) || !ids.some(id => this.shapes.has(id))) return;
    for (const id of ids) {
      const shape = this.shapes.get(id);
      if (shape) {
        this.shapes.set(id, { ...shape, x: shape.x + dx, y: shape.y + dy });
      }
    }
    this.emit(true);
  }

  deleteShapes(ids: TLShapeId[]): void {
    if (!this.transactionDepth) { this.run(() => this.deleteShapes(ids)); return; }
    const shapes = this.getCurrentPageShapes();
    if (!this.ignoringHistory) ids = ids.filter(id => {
      const shape = this.shapes.get(id);
      return shape?.type !== "generation-placeholder" || shape.props.status !== "loading";
    });
    if (workflowBusy(this)) {
      const protectedIds = new Set(shapes.filter(isWorkflowNode).flatMap((node) => [node.id, ...node.props.inputIds]));
      ids = ids.filter((id) => !protectedIds.has(id));
    }
    ids = ids.filter(id => this.shapes.has(id));
    if (!ids.length) return;
    const invalidated = invalidatedWorkflowUpdates(shapes, ids);
    for (const id of ids) {
      this.shapes.delete(id);
      this.selectedIds.delete(id);
    }
    this.order = this.order.filter((id) => this.shapes.has(id));
    for (const update of invalidated) {
      const node = this.shapes.get(update.id);
      if (node && isWorkflowNode(node)) this.shapes.set(node.id, {
        ...node, props: {
          ...node.props, ...update.props, inputIds: node.props.inputIds.filter((id) => !ids.includes(id))
        }
      });
    }
    this.emit(true);
  }

  bringToFront(ids: TLShapeId[]): void {
    if (!this.transactionDepth) { this.run(() => this.bringToFront(ids)); return; }
    const set = new Set(ids);
    const nextOrder = [...this.order.filter((id) => !set.has(id)), ...ids.filter((id) => this.shapes.has(id))];
    if (nextOrder.every((id, index) => id === this.order[index])) return;
    this.order = nextOrder;
    this.emit(true);
  }

  getShapePageBounds(shapeOrId: TLShape | TLShapeId): CanvasBounds | undefined {
    const shape = typeof shapeOrId === "string" ? this.shapes.get(shapeOrId) : shapeOrId;
    return shape ? boundsForShape(shape) : undefined;
  }

  getViewportPageBounds(): CanvasBounds {
    const rect = this.getContainer().getBoundingClientRect();
    const x = -this.camera.x / this.camera.zoom;
    const y = -this.camera.y / this.camera.zoom;
    const w = rect.width / this.camera.zoom;
    const h = rect.height / this.camera.zoom;
    return { x, y, w, h, center: { x: x + w / 2, y: y + h / 2 } };
  }

  pageToScreen(point: { x: number; y: number; }): { x: number; y: number; } {
    const rect = this.getContainer().getBoundingClientRect();
    return {
      x: rect.left + this.camera.x + point.x * this.camera.zoom,
      y: rect.top + this.camera.y + point.y * this.camera.zoom
    };
  }

  screenToPage(point: { x: number; y: number; }): { x: number; y: number; } {
    const rect = this.getContainer().getBoundingClientRect();
    return {
      x: (point.x - rect.left - this.camera.x) / this.camera.zoom,
      y: (point.y - rect.top - this.camera.y) / this.camera.zoom
    };
  }

  getShapeAtPoint(
    point: { x: number; y: number; },
    options?: { filter?: (shape: TLShape) => boolean; hitInside?: boolean; renderingOnly?: boolean; }
  ): TLShape | undefined {
    for (let index = this.order.length - 1; index >= 0; index -= 1) {
      const shape = this.shapes.get(this.order[index]);
      if (!shape || (options?.filter && !options.filter(shape))) {
        continue;
      }
      const bounds = boundsForShape(shape);
      if (point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h) {
        return shape;
      }
    }
    return undefined;
  }

  zoomToSelection(options?: CameraAnimationOptions): void {
    const shapes = this.getSelectedShapes();
    if (shapes.length > 0) {
      this.zoomToBounds(this.commonBounds(shapes), options);
    }
  }

  panToBounds(bounds: Pick<CanvasBounds, "x" | "y" | "w" | "h">, options?: CameraAnimationOptions): void {
    const rect = this.getContainer().getBoundingClientRect();
    const padding = options?.inset ?? 72;
    const camera = this.getCamera();
    const reveal = (origin: number, size: number, offset: number, viewport: number) => {
      const start = origin * camera.zoom + offset;
      const extent = size * camera.zoom;
      const inset = Math.min(padding, viewport / 4);
      if (extent > viewport - inset * 2) return viewport / 2 - (origin + size / 2) * camera.zoom;
      if (start < inset) return offset + inset - start;
      if (start + extent > viewport - inset) return offset + viewport - inset - start - extent;
      return offset;
    };
    this.animateCamera({
      ...camera,
      x: reveal(bounds.x, bounds.w, camera.x, rect.width),
      y: reveal(bounds.y, bounds.h, camera.y, rect.height)
    }, options?.animation?.duration ?? DEFAULT_CAMERA_ANIMATION_DURATION);
  }

  zoomToBounds(bounds: Pick<CanvasBounds, "x" | "y" | "w" | "h">, options?: CameraAnimationOptions): void {
    const rect = this.getContainer().getBoundingClientRect();
    const padding = options?.inset ?? 72;
    const zoom = Math.min(2.5, Math.max(0.02, Math.min((rect.width - padding * 2) / Math.max(bounds.w, 1), (rect.height - padding * 2) / Math.max(bounds.h, 1))));
    this.animateCamera({
      zoom,
      x: rect.width / 2 - (bounds.x + bounds.w / 2) * zoom,
      y: rect.height / 2 - (bounds.y + bounds.h / 2) * zoom
    }, options?.animation?.duration ?? DEFAULT_CAMERA_ANIMATION_DURATION);
  }

  zoomToFit(): void {
    const shapes = this.getCurrentPageShapes();
    if (shapes.length === 0) {
      const rect = this.getContainer().getBoundingClientRect();
      this.setCamera({ x: rect.width / 2, y: rect.height / 2, zoom: 1 });
      return;
    }
    this.zoomToBounds(this.commonBounds(shapes));
  }

  private commonBounds(shapes: TLShape[]): CanvasBounds {
    const bounds = shapes.map(boundsForShape);
    const x = Math.min(...bounds.map((item) => item.x));
    const y = Math.min(...bounds.map((item) => item.y));
    const right = Math.max(...bounds.map((item) => item.x + item.w));
    const bottom = Math.max(...bounds.map((item) => item.y + item.h));
    return { x, y, w: right - x, h: bottom - y, center: { x: (x + right) / 2, y: (y + bottom) / 2 } };
  }

  private updateCamera(camera: Camera): void {
    this.camera = {
      x: Number.isFinite(camera.x) ? camera.x : this.camera.x,
      y: Number.isFinite(camera.y) ? camera.y : this.camera.y,
      zoom: Math.min(4, Math.max(0.02, Number.isFinite(camera.zoom) ? camera.zoom : this.camera.zoom))
    };
  }

  private scheduleCameraNotification(): void {
    if (this.cameraNotificationFrame !== undefined) {
      return;
    }
    this.cameraNotificationFrame = window.requestAnimationFrame(() => {
      this.cameraNotificationFrame = undefined;
      this.publishCameraNotification();
    });
  }

  private publishCameraNotification(): void {
    this.cameraRevision += 1;
    for (const listener of this.cameraListeners) {
      listener();
    }
  }

  private publishCameraNotificationNow(): void {
    if (this.cameraNotificationFrame !== undefined) {
      window.cancelAnimationFrame(this.cameraNotificationFrame);
      this.cameraNotificationFrame = undefined;
    }
    this.publishCameraNotification();
  }

  private animateCamera(target: Camera, duration: number): void {
    this.cancelCameraAnimation();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || duration <= 0) {
      this.updateCamera(target);
      this.publishCameraNotificationNow();
      return;
    }

    const start = { ...this.camera };
    const startedAt = performance.now();
    const resolvedDuration = Number.isFinite(duration) ? Math.max(1, duration) : DEFAULT_CAMERA_ANIMATION_DURATION;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / resolvedDuration);
      const eased = cubicBezierEase(progress, ...CAMERA_EASE_OUT);
      this.updateCamera({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        zoom: start.zoom + (target.zoom - start.zoom) * eased
      });
      this.publishCameraNotificationNow();

      if (progress < 1) {
        this.cameraAnimationFrame = window.requestAnimationFrame(tick);
      } else {
        this.cameraAnimationFrame = undefined;
      }
    };
    this.cameraAnimationFrame = window.requestAnimationFrame(tick);
  }

  private emit(documentChanged: boolean): void {
    if (this.transactionDepth) {
      this.pendingChange = true;
      this.pendingDocumentChange ||= documentChanged;
      return;
    }
    this.revision += 1;
    for (const listener of this.eventListeners) {
      listener();
    }
    if (documentChanged) {
      for (const listener of this.storeListeners) {
        listener();
      }
    }
  }
}
