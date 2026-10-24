import {
  type GeneratedAsset,
  type GenerationRecord
} from "@insboard/shared";
import { type Translate } from "../../shared/i18n";
import { isRecord } from "../../shared/validation";
import { rememberAssetMetadata } from "../canvas/assets";
import { boundsForShape } from "../canvas/editor/geometry";
import { boundsOf, findVacantPosition, type PlacementRect } from "../canvas/editor/placement";
import { layoutGenerationBatch } from "./layout";
import { type Editor } from "../canvas/editor/Editor";
import {
  type TLAsset,
  type TLAssetId,
  type TLImageShape,
  type TLShapeId,
  type TLShapePartial
} from "../canvas/editor/types";
import { canvasNodeNumber } from "../canvas/node-number";
import { type ReferenceSelectionItem } from "../canvas/references";
import { type GenerationPlaceholderShape, GENERATION_PLACEHOLDER_TYPE } from "./placeholder-model";
import {
  type ActiveGenerationPlaceholders,
  type GenerationPlaceholderPlacement,
  type GenerationSubmitInput
} from "./types";

function createCanvasAssetId(assetId: string): TLAssetId {
  return `asset:${assetId}` as TLAssetId;
}

function createCanvasShapeId(): TLShapeId {
  return `shape:${crypto.randomUUID()}` as TLShapeId;
}

function createGenerationPlaceholdersFromPlacements(
  editor: Editor,
  placements: GenerationPlaceholderPlacement[],
  requestId: string,
  options: { selectPlaceholders?: boolean; } = {}
): ActiveGenerationPlaceholders {
  const placeholderIds = placements.map((placement) => placement.id);

  editor.run(() => {
    editor.createShapes<GenerationPlaceholderShape>(
      placements.map((placement, index) => ({
        id: placement.id,
        type: GENERATION_PLACEHOLDER_TYPE,
        x: placement.x,
        y: placement.y,
        props: {
          w: placement.width,
          h: placement.height,
          targetWidth: placement.targetWidth,
          targetHeight: placement.targetHeight,
          status: "loading",
          error: "",
          requestId: String(requestId),
          outputIndex: index
        }
      }))
    );
    editor.bringToFront(placeholderIds);
  }, { history: "ignore" });
  if (options.selectPlaceholders ?? true) {
    editor.select(...placeholderIds);
  }

  return {
    requestId,
    placements
  };
}

export function createGenerationPlaceholders(
  editor: Editor,
  input: GenerationSubmitInput,
  requestId: string,
  options: { references?: ReferenceSelectionItem[]; selectPlaceholders?: boolean; } = {}
): ActiveGenerationPlaceholders {
  const references = (options.references ?? []).map(reference => {
    const live = editor.getCurrentPageShapes().find(shape => canvasNodeNumber(shape) === reference.nodeNumber);
    return live ? boundsForShape(live) : { x: reference.canvasX, y: reference.canvasY, w: reference.canvasWidth, h: reference.canvasHeight };
  });
  const placements = layoutGenerationBatch(input.count, input.size, editor.getViewportPageBounds(), editor.getCurrentPageShapes().map(boundsForShape), references, editor.getCamera().zoom)
    .map(bounds => ({ id: createCanvasShapeId(), x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, targetWidth: input.size.width, targetHeight: input.size.height }));
  return createGenerationPlaceholdersFromPlacements(editor, placements, requestId, options);
}

export function generationContextBounds(editor: Editor, placements: GenerationPlaceholderPlacement[], references: ReferenceSelectionItem[] = []) {
  const context = references.map(reference => {
    const live = editor.getCurrentPageShapes().find(shape => canvasNodeNumber(shape) === reference.nodeNumber);
    return live ? boundsForShape(live) : { x: reference.canvasX, y: reference.canvasY, w: reference.canvasWidth, h: reference.canvasHeight };
  });
  return boundsOf([...context, ...placements.map(placement => ({ x: placement.x, y: placement.y, w: placement.width, h: placement.height }))]);
}

export function isGenerationPlaceholderShape(shape: unknown): shape is GenerationPlaceholderShape {
  return isRecord(shape) && shape.type === GENERATION_PLACEHOLDER_TYPE;
}

function livePlacement(editor: Editor, placement: GenerationPlaceholderPlacement): GenerationPlaceholderPlacement {
  const shape = editor.getShape(placement.id);
  if (!isGenerationPlaceholderShape(shape)) {
    return placement;
  }

  return {
    ...placement,
    x: shape.x,
    y: shape.y,
    width: shape.props.w,
    height: shape.props.h
  };
}

function createImageAsset(asset: GeneratedAsset): TLAsset {
  rememberAssetMetadata(asset.id, {
    width: asset.width,
    height: asset.height
  });

  return {
    id: createCanvasAssetId(asset.id),
    typeName: "asset",
    type: "image",
    props: {
      src: asset.url,
      w: asset.width,
      h: asset.height,
      name: asset.fileName,
      mimeType: asset.mimeType,
      isAnimated: false
    },
    meta: {
      localAssetId: asset.id,
      prompt: asset.prompt,
      effectivePrompt: asset.effectivePrompt
    }
  };
}

function createImageShape(
  asset: GeneratedAsset,
  placement: GenerationPlaceholderPlacement,
  promptValue: string
): Partial<TLImageShape> & { id: TLShapeId; type: "image"; } {
  const assetId = createCanvasAssetId(asset.id);

  return {
    id: createCanvasShapeId(),
    type: "image",
    x: placement.x,
    y: placement.y,
    props: {
      assetId,
      w: asset.width,
      h: asset.height,
      url: asset.url,
      playing: true,
      crop: null,
      flipX: false,
      flipY: false,
      altText: promptValue
    }
  };
}

export function replaceGenerationPlaceholders(editor: Editor, placeholderSet: ActiveGenerationPlaceholders, record: GenerationRecord, t: Translate): number {
  const assets: TLAsset[] = [];
  const imageShapes: Array<Partial<TLImageShape> & { id: TLShapeId; type: "image"; }> = [];
  const replacedPlaceholderIds: TLShapeId[] = [];
  const failedUpdates: Array<TLShapePartial<GenerationPlaceholderShape>> = [];
  const replacements = new Map<TLShapeId, TLShapeId>();
  const selectedIds = editor.getSelectedShapeIds();
  const replacing = new Set(placeholderSet.placements.filter((placement, index) => isGenerationPlaceholderShape(editor.getShape(placement.id)) && record.outputs[index]?.status === "succeeded" && record.outputs[index].asset).map(placement => placement.id));
  const occupied: PlacementRect[] = editor.getCurrentPageShapes().filter(shape => !replacing.has(shape.id)).map(boundsForShape);

  placeholderSet.placements.forEach((placement, index) => {
    const placeholderShape = editor.getShape(placement.id);
    if (!isGenerationPlaceholderShape(placeholderShape)) {
      return;
    }

    const output = record.outputs[index];
    if (output?.status === "succeeded" && output.asset) {
      const live = livePlacement(editor, placement);
      const vacant = findVacantPosition({ x: live.x, y: live.y, w: output.asset.width, h: output.asset.height }, occupied);
      occupied.push(vacant);
      const resolvedPlacement = { ...live, x: vacant.x, y: vacant.y };
      assets.push(createImageAsset(output.asset));
      imageShapes.push({
        ...createImageShape(output.asset, resolvedPlacement, record.prompt),
        meta: {
          nodeNumber: canvasNodeNumber(placeholderShape),
          revealGenerationResult: true,
          revealIndex: imageShapes.length
        }
      });
      replacements.set(placement.id, imageShapes[imageShapes.length - 1].id);
      replacedPlaceholderIds.push(placement.id);
      return;
    }

    failedUpdates.push({
      id: placement.id,
      type: GENERATION_PLACEHOLDER_TYPE,
      props: {
        status: "failed",
        error: output?.error || record.error || t("generationErrorDefault")
      }
    });
  });

  editor.run(() => {
    if (replacedPlaceholderIds.length > 0) {
      editor.deleteShapes(replacedPlaceholderIds);
    }
    if (assets.length > 0) {
      editor.createAssets(assets);
    }
    if (imageShapes.length > 0) {
      editor.createShapes(imageShapes);
    }
    if (failedUpdates.length > 0) {
      editor.updateShapes<GenerationPlaceholderShape>(failedUpdates);
    }
  }, { history: "ignore" });

  if (selectedIds.some(id => replacements.has(id))) {
    editor.select(...selectedIds.map(id => replacements.get(id) ?? id));
  }

  return imageShapes.length;
}

export function markGenerationPlaceholdersFailed(editor: Editor, placeholderSet: ActiveGenerationPlaceholders, error: string): void {
  const updates = placeholderSet.placements.flatMap((placement) => {
    const shape = editor.getShape(placement.id);
    if (!isGenerationPlaceholderShape(shape) || shape.props.status !== "loading") {
      return [];
    }

    return [
      {
        id: placement.id,
        type: GENERATION_PLACEHOLDER_TYPE,
        props: {
          status: "failed",
          error
        }
      } satisfies TLShapePartial<GenerationPlaceholderShape>
    ];
  });

  if (updates.length > 0) {
    editor.run(() => editor.updateShapes<GenerationPlaceholderShape>(updates), { history: "ignore" });
  }
}

export function placeholderSetForGenerationRecord(editor: Editor, record: GenerationRecord): ActiveGenerationPlaceholders | undefined {
  const placements = editor
    .getCurrentPageShapes()
    .flatMap((shape) => {
      if (!isGenerationPlaceholderShape(shape) || shape.props.requestId !== record.id) {
        return [];
      }

      return [
        {
          id: shape.id,
          x: shape.x,
          y: shape.y,
          width: shape.props.w,
          height: shape.props.h,
          targetWidth: shape.props.targetWidth,
          targetHeight: shape.props.targetHeight
        } satisfies GenerationPlaceholderPlacement
      ];
    })
    .sort((left, right) => {
      const leftShape = editor.getShape(left.id);
      const rightShape = editor.getShape(right.id);
      const leftIndex = isGenerationPlaceholderShape(leftShape) ? leftShape.props.outputIndex : 0;
      const rightIndex = isGenerationPlaceholderShape(rightShape) ? rightShape.props.outputIndex : 0;
      return leftIndex - rightIndex;
    });

  return placements.length > 0
    ? {
      requestId: record.id,
      placements
    }
    : undefined;
}
