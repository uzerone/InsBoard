import { MAX_REFERENCE_IMAGES } from "@insboard/shared";
import { type Translate } from "../../shared/i18n";
import { blobToDataUrl, fileNameWithImageExtension, getLocalAssetId } from "./assets";
import { type Editor } from "./editor/Editor";
import { type TLAsset, type TLAssetId, type TLImageShape } from "./editor/types";
import { canvasNodeNumber } from "./node-number";

const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;

const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

export interface ReferenceSelectionItem {
  nodeNumber: number;
  assetId: TLAssetId | null;
  localAssetId?: string;
  name: string;
  sourceUrl: string;
  width: number;
  height: number;
  canvasX: number;
  canvasY: number;
  canvasWidth: number;
  canvasHeight: number;
}

export type ReferenceSelection =
  | {
    status: "none" | "too-many" | "non-image" | "unreadable";
    hint: string;
  }
  | {
    status: "ready";
    references: ReferenceSelectionItem[];
    hint: string;
  };

export function missingReferenceSelection(t: Translate): ReferenceSelection {
  return {
    status: "none",
    hint: t("generationReferenceNeed", { max: MAX_REFERENCE_IMAGES })
  };
}

export function referenceAssetIdsForSelection(selection: Extract<ReferenceSelection, { status: "ready"; }>): string[] | undefined {
  const referenceAssetIds = selection.references.map((reference) => reference.localAssetId);
  return referenceAssetIds.every((referenceAssetId): referenceAssetId is string => Boolean(referenceAssetId))
    ? referenceAssetIds
    : undefined;
}

export function resolveReferenceSelection(editor: Editor, t: Translate): ReferenceSelection {
  const selectedShapes = editor.getSelectedShapes();

  if (selectedShapes.length === 0) {
    return missingReferenceSelection(t);
  }

  if (selectedShapes.some((shape) => shape.type !== "image")) {
    return {
      status: "non-image",
      hint: t("generationSelectionNonImage", { max: MAX_REFERENCE_IMAGES })
    };
  }

  if (selectedShapes.length > MAX_REFERENCE_IMAGES) {
    return {
      status: "too-many",
      hint: t("generationSelectionTooMany", { count: selectedShapes.length, max: MAX_REFERENCE_IMAGES })
    };
  }

  const references: Array<ReferenceSelectionItem & { sortX: number; sortY: number; }> = [];
  for (const shape of selectedShapes) {
    const imageShape = shape as TLImageShape;
    const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
    const sourceUrl = getImageSourceUrl(imageShape, asset);

    if (!sourceUrl) {
      return {
        status: "unreadable",
        hint: t("generationSelectionMissingSource")
      };
    }

    if (!isReadableReferenceSource(sourceUrl, asset)) {
      return {
        status: "unreadable",
        hint: t("generationSelectionUnreadable")
      };
    }

    const bounds = editor.getShapePageBounds(imageShape);
    references.push({
      nodeNumber: canvasNodeNumber(imageShape),
      assetId: imageShape.props.assetId,
      localAssetId: getLocalAssetId(asset, sourceUrl),
      name: getReferenceName(asset, sourceUrl),
      sourceUrl,
      width: asset?.type === "image" ? asset.props.w : imageShape.props.w,
      height: asset?.type === "image" ? asset.props.h : imageShape.props.h,
      canvasX: bounds?.x ?? imageShape.x,
      canvasY: bounds?.y ?? imageShape.y,
      canvasWidth: bounds?.w ?? imageShape.props.w,
      canvasHeight: bounds?.h ?? imageShape.props.h,
      sortX: bounds?.x ?? 0,
      sortY: bounds?.y ?? 0
    });
  }

  const sortedReferences = references
    .sort((left, right) => left.nodeNumber - right.nodeNumber)
    .map(({ sortX: _sortX, sortY: _sortY, ...reference }) => reference);

  return {
    status: "ready",
    references: sortedReferences,
    hint:
      sortedReferences.length === 1
        ? t("generationSelectedReferenceOne")
        : t("generationSelectedReferenceMany", { count: sortedReferences.length })
  };
}

export function areReferenceSelectionsEqual(left: ReferenceSelection, right: ReferenceSelection): boolean {
  if (left.status !== right.status) {
    return false;
  }

  if (left.status !== "ready" || right.status !== "ready") {
    return left.hint === right.hint;
  }

  return (
    left.hint === right.hint &&
    left.references.length === right.references.length &&
    left.references.every((leftReference, index) => {
      const rightReference = right.references[index];
      return (
        rightReference !== undefined &&
        leftReference.assetId === rightReference.assetId &&
        leftReference.localAssetId === rightReference.localAssetId &&
        leftReference.name === rightReference.name &&
        leftReference.sourceUrl === rightReference.sourceUrl &&
        leftReference.width === rightReference.width &&
        leftReference.height === rightReference.height &&
        leftReference.canvasX === rightReference.canvasX &&
        leftReference.canvasY === rightReference.canvasY &&
        leftReference.canvasWidth === rightReference.canvasWidth &&
        leftReference.canvasHeight === rightReference.canvasHeight
      );
    })
  );
}

export function getImageSourceUrl(shape: TLImageShape, asset: TLAsset | undefined): string | undefined {
  const assetSrc = asset?.type === "image" && typeof asset.props.src === "string" ? asset.props.src : undefined;
  return assetSrc || shape.props.url || undefined;
}

function getAssetMimeType(asset: TLAsset | undefined): string | undefined {
  return asset?.type === "image" && typeof asset.props.mimeType === "string" ? asset.props.mimeType : undefined;
}

function isReadableReferenceSource(sourceUrl: string, asset: TLAsset | undefined): boolean {
  const assetMimeType = getAssetMimeType(asset);
  if (assetMimeType && !isSupportedReferenceImageType(assetMimeType)) {
    return false;
  }

  if (sourceUrl.startsWith("data:")) {
    const mimeType = /^data:([^;,]+)/iu.exec(sourceUrl)?.[1];
    return Boolean(mimeType && isSupportedReferenceImageType(mimeType));
  }

  if (sourceUrl.startsWith("blob:")) {
    return true;
  }

  try {
    return new URL(sourceUrl, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function getReferenceName(asset: TLAsset | undefined, sourceUrl: string): string {
  if (asset?.type === "image" && asset.props.name) {
    return asset.props.name;
  }

  try {
    const pathname = new URL(sourceUrl, window.location.origin).pathname;
    return pathname.split("/").filter(Boolean).at(-1) || "reference-image";
  } catch {
    return "reference-image";
  }
}

function isSupportedReferenceImageType(mimeType: string): boolean {
  return SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType.toLowerCase());
}

export async function readReferenceImage(selection: ReferenceSelectionItem, signal: AbortSignal, t: Translate): Promise<{
  dataUrl: string;
  fileName: string;
  mimeType: string;
  nodeNumber: number;
}> {
  let response: Response;

  try {
    response = await fetch(selection.sourceUrl, { signal });
  } catch {
    throw new Error(t("readReferenceFailed"));
  }

  if (!response.ok) {
    throw new Error(t("readReferenceMissingFile"));
  }

  const blob = await response.blob();
  if (!isSupportedReferenceImageType(blob.type)) {
    throw new Error(t("referenceInvalidType"));
  }
  if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(t("referenceFileTooLarge"));
  }

  return {
    dataUrl: await blobToDataUrl(blob, t),
    nodeNumber: selection.nodeNumber,
    fileName: fileNameWithImageExtension(selection.name, blob.type),
    mimeType: blob.type
  };
}
