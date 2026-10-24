import { type ImageSize, type ResolutionTier, resolutionTierForSize } from "@insboard/shared";
import { ExternalLink, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assetInlineUrl } from "../../shared/api/assets";
import { useI18n } from "../../shared/i18n";
import { type ImageInfo, ImageInfoDialog } from "./ImageInfoDialog";
import { assetMetadataCache, fallbackImageSize, fetchAssetMetadata, getLocalAssetId } from "./assets";
import { type Editor } from "./editor/Editor";
import { useEditor, useValue } from "./editor/react";
import { type TLImageShape } from "./editor/types";
import { canvasNodeNumber } from "./node-number";
import { getImageSourceUrl, getReferenceName } from "./references";

const RESOLUTION_BADGE_BASE_OFFSET = 7;

const RESOLUTION_BADGE_MIN_SCALE = 0.52;

const RESOLUTION_BADGE_SMALL_IMAGE_SIDE = 32;

const RESOLUTION_BADGE_FULL_SIZE_IMAGE_SIDE = 220;

interface CanvasResolutionBadgeTarget {
  localAssetId?: string;
  fallbackSize: ImageSize;
  badgeScale: number;
  screenX: number;
  screenY: number;
}

interface CanvasImageOpenTarget {
  info: ImageInfo;
  url: string;
  screenX: number;
  screenY: number;
}

interface ClientPoint {
  x: number;
  y: number;
}

export function CanvasResolutionBadgeOverlay() {
  const editor = useEditor();
  const pointerClientPoint = usePointerClientPoint(editor);
  const target = useValue("canvas resolution badge target", () => getCanvasResolutionBadgeTarget(editor, pointerClientPoint), [
    editor,
    pointerClientPoint?.x,
    pointerClientPoint?.y
  ]);
  const [loadedMetadata, setLoadedMetadata] = useState<{ assetId: string; size: ImageSize; } | undefined>();

  const localAssetId = target?.localAssetId;
  const cachedMetadata = localAssetId ? assetMetadataCache.get(localAssetId) : undefined;
  const loadedSize = loadedMetadata && loadedMetadata.assetId === localAssetId ? loadedMetadata.size : undefined;
  const resolvedSize = localAssetId ? (cachedMetadata ?? loadedSize) : target?.fallbackSize;

  useEffect(() => {
    if (!localAssetId || assetMetadataCache.has(localAssetId)) {
      return;
    }

    let isActive = true;
    void fetchAssetMetadata(localAssetId).then((size) => {
      if (isActive && size) {
        setLoadedMetadata({ assetId: localAssetId, size });
      }
    });

    return () => {
      isActive = false;
    };
  }, [localAssetId]);

  if (!target || !resolvedSize) {
    return null;
  }

  const tier: ResolutionTier = resolutionTierForSize(resolvedSize);

  return (
    <span
      aria-hidden="true"
      className="canvas-resolution-badge"
      data-resolution-tier={tier}
      data-testid="canvas-resolution-badge"
      style={{
        transform: `translate3d(${Math.round(target.screenX + resolutionBadgeOffset(target.badgeScale))}px, ${Math.round(
          target.screenY + resolutionBadgeOffset(target.badgeScale)
        )}px, 0) scale(${target.badgeScale})`
      }}
    >
      {tier}
    </span>
  );
}

export function CanvasImageOpenOverlay() {
  const editor = useEditor();
  const { t } = useI18n();
  const target = useValue("selected canvas image open target", () => getSelectedImageOpenTarget(editor), [editor]);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);

  if (!target) {
    return null;
  }

  return (
    <>
      <button
        aria-label={t("canvasOpenOriginalImage")}
        className="canvas-image-open-button"
        data-testid="canvas-image-open-button"
        style={{
          transform: `translate3d(${Math.round(target.screenX)}px, ${Math.round(target.screenY)}px, 0)`
        }}
        title={t("canvasOpenOriginalImage")}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          window.open(target.url, "_blank", "noopener,noreferrer");
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <ExternalLink className="size-4" aria-hidden="true" />
      </button>
      <button type="button" className="canvas-image-open-button canvas-image-info-button" data-testid="canvas-image-info-button"
        aria-label={t("canvasImageInfo")} title={t("canvasImageInfo")}
        style={{ transform: `translate3d(${Math.round(target.screenX)}px, ${Math.round(target.screenY + 48)}px, 0)` }}
        onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setImageInfo(target.info); }}>
        <Info className="size-4" aria-hidden="true" />
      </button>
      {imageInfo && <ImageInfoDialog info={imageInfo} onClose={() => setImageInfo(null)} />}
    </>
  );
}

function usePointerClientPoint(editor: Editor): ClientPoint | undefined {
  const [point, setPoint] = useState<ClientPoint | undefined>();
  const frameRef = useRef<number | undefined>();
  const latestPointRef = useRef<ClientPoint | undefined>();

  useEffect(() => {
    const ownerWindow = editor.getContainer().ownerDocument.defaultView ?? window;

    const updatePoint = (nextPoint: ClientPoint | undefined) => {
      latestPointRef.current = nextPoint;
      if (frameRef.current !== undefined) {
        return;
      }

      frameRef.current = ownerWindow.requestAnimationFrame(() => {
        frameRef.current = undefined;
        setPoint(latestPointRef.current);
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      updatePoint({
        x: event.clientX,
        y: event.clientY
      });
    };
    const handlePointerLeave = () => updatePoint(undefined);

    ownerWindow.addEventListener("pointermove", handlePointerMove, { passive: true });
    ownerWindow.addEventListener("pointerleave", handlePointerLeave);
    ownerWindow.addEventListener("blur", handlePointerLeave);

    return () => {
      ownerWindow.removeEventListener("pointermove", handlePointerMove);
      ownerWindow.removeEventListener("pointerleave", handlePointerLeave);
      ownerWindow.removeEventListener("blur", handlePointerLeave);
      if (frameRef.current !== undefined) {
        ownerWindow.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [editor]);

  return point;
}

function getCanvasResolutionBadgeTarget(editor: Editor, pointerClientPoint: ClientPoint | undefined): CanvasResolutionBadgeTarget | undefined {
  const imageShape = getImageShapeUnderPointer(editor, pointerClientPoint);
  if (!imageShape) {
    return undefined;
  }

  const bounds = editor.getShapePageBounds(imageShape);
  if (!bounds) {
    return undefined;
  }

  const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
  const sourceUrl = getImageSourceUrl(imageShape, asset);
  const localAssetId = getLocalAssetId(asset, sourceUrl);
  const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y });
  const bottomRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });
  const containerRect = editor.getContainer().getBoundingClientRect();
  const screenWidth = Math.abs(bottomRight.x - topLeft.x);
  const screenHeight = Math.abs(bottomRight.y - topLeft.y);

  return {
    localAssetId,
    fallbackSize: fallbackImageSize(imageShape, asset),
    badgeScale: resolutionBadgeScale(screenWidth, screenHeight, containerRect.width),
    screenX: topLeft.x - containerRect.left,
    screenY: topLeft.y - containerRect.top
  };
}

function getSelectedImageOpenTarget(editor: Editor): CanvasImageOpenTarget | undefined {
  const selectedShapes = editor.getSelectedShapes();
  if (selectedShapes.length !== 1 || selectedShapes[0]?.type !== "image") {
    return undefined;
  }

  const imageShape = selectedShapes[0] as TLImageShape;
  const bounds = editor.getShapePageBounds(imageShape);
  if (!bounds) {
    return undefined;
  }

  const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
  const sourceUrl = getImageSourceUrl(imageShape, asset);
  const localAssetId = getLocalAssetId(asset, sourceUrl);
  const url = localAssetId
    ? assetInlineUrl(localAssetId)
    : typeof imageShape.props.url === "string" && imageShape.props.url.trim()
      ? imageShape.props.url
      : sourceUrl;
  if (!url) {
    return undefined;
  }

  const topRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y });
  const containerRect = editor.getContainer().getBoundingClientRect();

  return {
    url,
    info: {
      localAssetId,
      name: getReferenceName(asset, sourceUrl ?? url),
      nodeNumber: canvasNodeNumber(imageShape),
      ...fallbackImageSize(imageShape, asset),
      prompt: typeof asset?.meta?.prompt === "string" ? asset.meta.prompt : undefined,
      effectivePrompt: typeof asset?.meta?.effectivePrompt === "string" ? asset.meta.effectivePrompt : undefined
    },
    screenX: Math.max(8, Math.min(topRight.x - containerRect.left + 8, containerRect.width - 52)),
    screenY: Math.max(8, Math.min(topRight.y - containerRect.top - 8, containerRect.height - 104))
  };
}

function resolutionBadgeScale(screenWidth: number, screenHeight: number, canvasWidth: number): number {
  const imageShortSide = Math.max(0, Math.min(screenWidth, screenHeight));
  const imageScale =
    imageShortSide >= RESOLUTION_BADGE_FULL_SIZE_IMAGE_SIDE
      ? 1
      : RESOLUTION_BADGE_MIN_SCALE +
      ((Math.max(imageShortSide, RESOLUTION_BADGE_SMALL_IMAGE_SIDE) - RESOLUTION_BADGE_SMALL_IMAGE_SIDE) /
        (RESOLUTION_BADGE_FULL_SIZE_IMAGE_SIDE - RESOLUTION_BADGE_SMALL_IMAGE_SIDE)) *
      (1 - RESOLUTION_BADGE_MIN_SCALE);
  const canvasScale = canvasWidth < 520 ? 0.78 : canvasWidth < 760 ? 0.88 : 1;

  return Math.max(RESOLUTION_BADGE_MIN_SCALE, Math.min(1, imageScale, canvasScale));
}

function resolutionBadgeOffset(scale: number): number {
  return Math.max(4, RESOLUTION_BADGE_BASE_OFFSET * scale);
}

function getImageShapeUnderPointer(editor: Editor, pointerClientPoint: ClientPoint | undefined): TLImageShape | undefined {
  if (!pointerClientPoint || !isPointerOverCanvas(editor, pointerClientPoint)) {
    return undefined;
  }

  const shapeAtPoint = editor.getShapeAtPoint(editor.screenToPage(pointerClientPoint), {
    hitInside: true,
    renderingOnly: true,
    filter: (shape) => shape.type === "image"
  });

  return shapeAtPoint?.type === "image" ? (shapeAtPoint as TLImageShape) : undefined;
}

function isPointerOverCanvas(editor: Editor, pointerClientPoint: ClientPoint): boolean {
  const target = editor.getContainer().ownerDocument.elementFromPoint(pointerClientPoint.x, pointerClientPoint.y);
  return Boolean(target?.closest(".tl-canvas"));
}
