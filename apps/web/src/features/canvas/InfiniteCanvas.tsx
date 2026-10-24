import { Focus, Hand, Magnet, Minus, MousePointer2, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type AnimationEvent as ReactAnimationEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent
} from "react";
import { useI18n } from "../../shared/i18n";
import { isWorkflowNode, WORKFLOW_WIDTH } from "../workflow/model";
import { Editor } from "./editor/Editor";
import {
  boundsForShape,
  dragTranslation,
  gridBackground,
  imageSizeAtOriginalRatio,
  shapeSize,
  snapCoordinate
} from "./editor/geometry";
import { findVacantPosition } from "./editor/placement";
import type { TLComponents } from "./editor/react";
import { EditorContext } from "./editor/react";
import {
  type Camera,
  type TLAsset,
  type TLAssetStore,
  type TLEditorSnapshot,
  type TLImageShape,
  type TLShape,
  type TLShapeId,
  type TLStoreSnapshot
} from "./editor/types";
import { canvasNodeNumber } from "./node-number";

interface InfiniteCanvasProps {
  assets: TLAssetStore;
  components?: TLComponents;
  onMount?: (editor: Editor) => void | (() => void);
  renderShape?: (shape: TLShape) => ReactNode;
  snapshot?: TLEditorSnapshot | TLStoreSnapshot;
}

type Interaction =
  | { kind: "pan"; clientX: number; clientY: number; camera: Camera; }
  | { kind: "move"; clientX: number; clientY: number; origin: { x: number; y: number; }; positions: Array<{ id: TLShapeId; x: number; y: number; }>; }
  | { kind: "resize"; clientX: number; clientY: number; id: TLShapeId; w: number; h: number; };

interface ShapeLayerProps {
  beginShapeInteraction: (event: ReactPointerEvent<HTMLElement>, shape: TLShape) => void;
  beginResizeInteraction: (event: ReactPointerEvent<HTMLButtonElement>, shape: TLShape) => void;
  clearGenerationReveal: (event: ReactAnimationEvent<HTMLDivElement>, shape: TLShape) => void;
  focusShape: (shape: TLShape) => void;
  renderDefaultShape: (shape: TLShape) => ReactNode;
  renderShape?: (shape: TLShape) => ReactNode;
  selectedIds: TLShapeId[];
  selectedSet: Set<TLShapeId>;
  shapes: TLShape[];
  zoom: number;
}

const ShapeLayer = memo(function ShapeLayer({
  beginShapeInteraction,
  beginResizeInteraction,
  clearGenerationReveal,
  focusShape,
  renderDefaultShape,
  renderShape,
  selectedIds,
  selectedSet,
  shapes,
  zoom
}: ShapeLayerProps) {
  const { t } = useI18n();
  return shapes.map((shape) => {
    const { w, h } = shapeSize(shape);
    const isSelected = selectedSet.has(shape.id);
    const shouldReveal = shape.meta?.revealGenerationResult === true;
    const revealIndex = typeof shape.meta?.revealIndex === "number" ? shape.meta.revealIndex : 0;
    const revealDelay = Math.min(200, Math.max(0, revealIndex * 50));
    return (
      <div
        className="infinite-canvas__shape"
        data-reveal-generation-result={shouldReveal ? "true" : undefined}
        data-selected={isSelected}
        data-shape-type={shape.type}
        data-shape-id={shape.id}
        data-node-number={canvasNodeNumber(shape)}
        data-testid={`canvas-shape-${shape.type}`}
        key={shape.id}
        style={{ width: w, height: h, left: shape.x, top: shape.y }}
        onDoubleClick={() => focusShape(shape)}
        onPointerDown={(event) => beginShapeInteraction(event, shape)}
      >
        <span className="canvas-node-number" data-testid="canvas-node-number"
          style={{ zoom: 1 / zoom }}
          aria-label={t("canvasNodeLabel", { number: canvasNodeNumber(shape) })}>
          {zoom < 0.5 ? `#${canvasNodeNumber(shape)}` : shape.type === "image" ? t("canvasNodeNumber", { number: canvasNodeNumber(shape) }) : t("canvasNodeLabel", { number: canvasNodeNumber(shape) })}
        </span>
        <div
          className="infinite-canvas__shape-content"
          data-reveal-generation-result={shouldReveal ? "true" : undefined}
          style={shouldReveal ? { animationDelay: `${revealDelay}ms` } : undefined}
          onAnimationEnd={shouldReveal ? (event) => clearGenerationReveal(event, shape) : undefined}
        >
          {renderShape?.(shape) ?? renderDefaultShape(shape)}
          {isSelected ? <span className="infinite-canvas__selection" aria-hidden="true" /> : null}
          {isSelected && selectedIds.length === 1 && Math.min(w, h) * zoom >= 32 && (shape.type === "image" || isWorkflowNode(shape)) ? (
            <button
              aria-label={shape.type === "image" ? t("canvasResizeImage") : t("canvasResizeNode")}
              className="infinite-canvas__resize-handle"
              style={{ transform: `scale(${1 / zoom})` }}
              type="button"
              onPointerDown={(event) => beginResizeInteraction(event, shape)}
            />
          ) : null}
        </div>
      </div>
    );
  });
});

async function imageDimensions(source: string): Promise<{ width: number; height: number; }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: Math.max(1, image.naturalWidth), height: Math.max(1, image.naturalHeight) });
    image.onerror = () => resolve({ width: 1024, height: 1024 });
    image.src = source;
  });
}

export function InfiniteCanvas({ assets, components, onMount, renderShape, snapshot }: InfiniteCanvasProps) {
  const { t } = useI18n();
  const editorRef = useRef<Editor>();
  if (!editorRef.current) {
    editorRef.current = new Editor();
  }
  const editor = editorRef.current;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const setContainer = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    editor.setContainer(node);
  }, [editor]);
  const spacePressedRef = useRef(false);
  const [mode, setMode] = useState<"select" | "pan">("select");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const revision = useSyncExternalStore(editor.subscribe, editor.getRevision, editor.getRevision);
  useSyncExternalStore(editor.subscribeCamera, editor.getCameraRevision, editor.getCameraRevision);
  const camera = editor.getCamera();
  const selectedIds = useMemo(() => editor.getSelectedShapeIds(), [editor, revision]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const shapes = useMemo(() => editor.getCurrentPageShapes(), [editor, revision]);
  const FrontOverlay = components?.InFrontOfTheCanvas;

  useEffect(() => {
    editor.loadSnapshot(snapshot);
    editor.initializeCamera();
    const cleanup = onMount?.(editor);
    return () => {
      cleanup?.();
      editor.dispose();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      if (!isTyping && !target?.closest("dialog") && event.shiftKey && !event.metaKey && !event.ctrlKey) {
        if (event.code === "Digit1") { event.preventDefault(); editor.zoomToFit(); return; }
        if (event.key.toLowerCase() === "g") { event.preventDefault(); editor.setSnapToGrid(!editor.isSnapToGridEnabled()); return; }
      }
      if (!isTyping && !target?.closest("dialog") && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        endInteraction();
        if (event.shiftKey) editor.redo(); else editor.undo();
        return;
      }
      if (!isTyping && target && containerRef.current?.contains(target) && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        editor.select(...editor.getCurrentPageShapes().map((shape) => shape.id));
      }
      if (!isTyping && target && containerRef.current?.contains(target) && event.key === "Escape") {
        editor.select();
      }
      if (event.code === "Space" && !isTyping) {
        spacePressedRef.current = true;
        event.preventDefault();
      }
      if (!isTyping && (event.key === "Delete" || event.key === "Backspace")) {
        const ids = editor.getSelectedShapeIds();
        if (ids.length > 0) {
          event.preventDefault();
          editor.deleteShapes(ids);
        }
      }
      if ((!isTyping || event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomBy(1.18);
      }
      if ((!isTyping || event.metaKey || event.ctrlKey) && event.key === "-") {
        event.preventDefault();
        zoomBy(1 / 1.18);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        spacePressedRef.current = false;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [editor]);

  const zoomBy = useCallback((factor: number, clientPoint?: { x: number; y: number; }) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const clientX = clientPoint?.x ?? rect.left + rect.width / 2;
    const clientY = clientPoint?.y ?? rect.top + rect.height / 2;
    const before = editor.screenToPage({ x: clientX, y: clientY });
    const current = editor.getCamera();
    const nextZoom = Math.min(4, Math.max(0.02, current.zoom * factor));
    editor.setCamera({
      zoom: nextZoom,
      x: clientX - rect.left - before.x * nextZoom,
      y: clientY - rect.top - before.y * nextZoom
    });
  }, [editor]);

  const beginCanvasInteraction = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    editor.cancelCameraAnimation();
    const shouldPan = mode === "pan" || spacePressedRef.current || event.button === 1;
    if (!shouldPan) {
      editor.select();
    }
    interactionRef.current = {
      kind: "pan",
      clientX: event.clientX,
      clientY: event.clientY,
      camera: editor.getCamera()
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [editor, mode]);

  const beginShapeInteraction = useCallback((event: ReactPointerEvent<HTMLElement>, shape: TLShape) => {
    if (event.button !== 0 || mode === "pan" || spacePressedRef.current) {
      return;
    }
    editor.cancelCameraAnimation();
    event.stopPropagation();
    if (event.shiftKey) {
      editor.toggleSelected(shape.id);
    } else if (!editor.getSelectedShapeIds().includes(shape.id)) {
      editor.select(shape.id);
    }
    editor.beginHistoryGroup();
    interactionRef.current = {
      kind: "move",
      clientX: event.clientX,
      clientY: event.clientY,
      origin: { x: shape.x, y: shape.y },
      positions: (editor.getSelectedShapeIds().includes(shape.id) ? editor.getSelectedShapes() : [shape]).map(({ id, x, y }) => ({ id, x, y }))
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [editor, mode]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (!interaction) {
      return;
    }
    const dx = event.clientX - interaction.clientX;
    const dy = event.clientY - interaction.clientY;
    if (interaction.kind === "pan") {
      editor.setCamera({ ...interaction.camera, x: interaction.camera.x + dx, y: interaction.camera.y + dy });
      return;
    }
    if (interaction.kind === "move") {
      const zoom = editor.getCamera().zoom;
      const delta = dragTranslation(interaction.origin, { x: dx / zoom, y: dy / zoom }, editor.isSnapToGridEnabled() && !event.altKey);
      editor.updateShapes(interaction.positions.map(position => ({ id: position.id, x: position.x + delta.x, y: position.y + delta.y }))
        .filter(update => { const shape = editor.getShape(update.id); return shape && (shape.x !== update.x || shape.y !== update.y); }));
      return;
    }
    const shape = editor.getShape(interaction.id);
    if (shape) {
      const zoom = editor.getCamera().zoom;
      const { w, h } = interaction;
      const requestedScale = 1 + (dx * w + dy * h) / (zoom * (w * w + h * h));
      const snappedScale = editor.isSnapToGridEnabled() && !event.altKey ? snapCoordinate(w * requestedScale) / w : requestedScale;
      const scale = isWorkflowNode(shape)
        ? Math.min(WORKFLOW_WIDTH * 4 / w, Math.max(WORKFLOW_WIDTH * 0.4 / w, snappedScale))
        : Math.max(32 / w, 32 / h, snappedScale);
      editor.updateShapes([{ id: shape.id, props: { w: w * scale, h: h * scale } }]);
    }
  }, [editor]);

  const endInteraction = useCallback(() => {
    interactionRef.current = null;
    editor.endHistoryGroup();
  }, [editor]);

  const beginResizeInteraction = useCallback((event: ReactPointerEvent<HTMLButtonElement>, shape: TLShape) => {
    event.preventDefault();
    event.stopPropagation();
    editor.cancelCameraAnimation();
    const size = shape.type === "image" ? imageSizeAtOriginalRatio(shape, editor.getAsset(shape.props.assetId)) : shapeSize(shape);
    editor.beginHistoryGroup();
    interactionRef.current = { kind: "resize", clientX: event.clientX, clientY: event.clientY, id: shape.id, ...size };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [editor]);

  const focusShape = useCallback((shape: TLShape) => {
    editor.select(shape.id);
    editor.zoomToSelection({ animation: { duration: 180 } });
  }, [editor]);

  const clearGenerationReveal = useCallback((event: ReactAnimationEvent<HTMLDivElement>, shape: TLShape) => {
    if (
      event.target !== event.currentTarget
      || (event.animationName !== "generation-result-reveal" && event.animationName !== "generation-result-reveal-reduced")
    ) {
      return;
    }
    editor.run(() => editor.updateShapes([{
      id: shape.id,
      meta: { revealGenerationResult: undefined, revealIndex: undefined }
    }]), { history: "ignore" });
  }, [editor]);

  const handleWheel = useCallback((event: WheelEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!event.ctrlKey && !event.metaKey && target?.closest(".workflow-node__body, input, textarea, select")) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomBy(Math.exp(-event.deltaY * 0.002), { x: event.clientX, y: event.clientY });
      return;
    }
    const current = editor.getCamera();
    editor.setCamera({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
  }, [editor, zoomBy]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const importFiles = useCallback(async (files: FileList | File[], clientPoint?: { x: number; y: number; }) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }
    const origin = clientPoint ? editor.screenToPage(clientPoint) : editor.getViewportPageBounds().center;
    for (const [index, file] of imageFiles.entries()) {
      const placeholderAsset: TLAsset = {
        id: `asset:upload-${crypto.randomUUID()}`,
        typeName: "asset",
        type: "image",
        props: { src: "", w: 0, h: 0, name: file.name, mimeType: file.type }
      };
      const uploaded = await assets.upload(placeholderAsset, file);
      const dimensions = await imageDimensions(uploaded.src);
      const scale = Math.min(1, 420 / dimensions.width, 360 / dimensions.height);
      const w = dimensions.width * scale;
      const h = dimensions.height * scale;
      const asset: TLAsset = {
        ...placeholderAsset,
        props: { ...placeholderAsset.props, src: uploaded.src, w: dimensions.width, h: dimensions.height }
      };
      const placement = findVacantPosition({ x: origin.x - w / 2 + index * 32, y: origin.y - h / 2 + index * 32, w, h }, editor.getCurrentPageShapes().map(boundsForShape));
      const shape: TLImageShape = {
        id: `shape:${crypto.randomUUID()}`,
        typeName: "shape",
        type: "image",
        x: placement.x,
        y: placement.y,
        props: { assetId: asset.id, w, h, url: uploaded.src, altText: file.name }
      };
      editor.run(() => {
        editor.createAssets([asset]);
        editor.createShapes([shape]);
        editor.select(shape.id);
      });
    }
  }, [assets, editor]);

  const renderDefaultShape = useCallback((shape: TLShape): ReactNode => {
    if (shape.type !== "image") {
      return null;
    }
    const imageShape = shape as TLImageShape;
    const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
    const source = asset ? assets.resolve(asset) : imageShape.props.url;
    return source ? <img alt={imageShape.props.altText || "Canvas image"} draggable={false} src={source} /> : null;
  }, [assets, editor]);

  return (
    <EditorContext.Provider value={editor}>
      <div
        aria-label="Infinite canvas"
        className="infinite-canvas tl-canvas"
        data-dragging-file={isDraggingFile}
        data-mode={mode}
        ref={setContainer}
        tabIndex={0}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setIsDraggingFile(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsDraggingFile(false);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setIsDraggingFile(false);
          void importFiles(event.dataTransfer.files, { x: event.clientX, y: event.clientY });
        }}
        onPointerDown={beginCanvasInteraction}
        onPointerMove={handlePointerMove}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
      >
        <div
          className="infinite-canvas__grid"
          style={gridBackground(camera)}
        />
        <div
          className="infinite-canvas__world"
          style={{ left: camera.x, top: camera.y }}
        >
          <div className="infinite-canvas__world-content" style={{ zoom: camera.zoom, "--canvas-zoom": camera.zoom } as CSSProperties}>
            <ShapeLayer
              beginResizeInteraction={beginResizeInteraction}
              beginShapeInteraction={beginShapeInteraction}
              clearGenerationReveal={clearGenerationReveal}
              focusShape={focusShape}
              renderDefaultShape={renderDefaultShape}
              renderShape={renderShape}
              selectedIds={selectedIds}
              selectedSet={selectedSet}
              shapes={shapes}
              zoom={camera.zoom}
            />
          </div>
        </div>

        <div
          className="infinite-canvas__toolbar"
          role="toolbar"
          aria-label="Canvas tools"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button aria-pressed={mode === "select"} data-active={mode === "select"} title="Select" type="button" onClick={() => setMode("select")}>
            <MousePointer2 aria-hidden="true" />
          </button>
          <button aria-pressed={mode === "pan"} data-active={mode === "pan"} title="Pan" type="button" onClick={() => setMode("pan")}>
            <Hand aria-hidden="true" />
          </button>
          <button aria-label={t("canvasUndo")} aria-keyshortcuts="Meta+Z Control+Z" title={`${t("canvasUndo")} · ⌘Z`} disabled={!editor.canUndo()} type="button" onClick={() => editor.undo()}><Undo2 aria-hidden="true" /></button>
          <button aria-label={t("canvasRedo")} aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z" title={`${t("canvasRedo")} · ⇧⌘Z`} disabled={!editor.canRedo()} type="button" onClick={() => editor.redo()}><Redo2 aria-hidden="true" /></button>
          <button aria-label={t("canvasSnapGrid")} aria-pressed={editor.isSnapToGridEnabled()} data-active={editor.isSnapToGridEnabled()} aria-keyshortcuts="Shift+G" title={`${t("canvasSnapGrid")} · ⇧G · ${t("canvasSnapBypass")}`} type="button" onClick={() => editor.setSnapToGrid(!editor.isSnapToGridEnabled())}><Magnet aria-hidden="true" /></button>
          <span aria-hidden="true" />
          <button aria-label="Zoom out" title="Zoom out" type="button" onClick={() => zoomBy(1 / 1.2)}><Minus aria-hidden="true" /></button>
          <button className="infinite-canvas__zoom-label" title="Reset to 100%" type="button" onClick={() => {
            const current = editor.getCamera();
            editor.setCamera({ ...current, zoom: 1 });
          }}>{Math.round(camera.zoom * 100)}%</button>
          <button aria-label="Zoom in" title="Zoom in" type="button" onClick={() => zoomBy(1.2)}><Plus aria-hidden="true" /></button>
          <button aria-label={t("canvasFitProject")} title={`${t("canvasFitProject")} · ⇧1`} aria-keyshortcuts="Shift+1" type="button" onClick={() => editor.zoomToFit()}><Focus aria-hidden="true" /></button>
          <button aria-label="Delete selection" disabled={selectedIds.length === 0} title="Delete selection" type="button" onClick={() => editor.deleteShapes(selectedIds)}><Trash2 aria-hidden="true" /></button>
        </div>

        {isDraggingFile ? <div className="infinite-canvas__drop-target">Drop to add to canvas</div> : null}
        {FrontOverlay ? <div className="infinite-canvas__overlay"><FrontOverlay /></div> : null}
      </div>
    </EditorContext.Provider>
  );
}
