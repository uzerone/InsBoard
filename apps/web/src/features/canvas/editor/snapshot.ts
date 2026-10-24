import { type TLAsset, type TLEditorSnapshot, type TLShape, type TLStoreSnapshot } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeShape(value: unknown): TLShape | undefined {
  if (!isRecord(value) || value.typeName !== "shape" || typeof value.id !== "string" || typeof value.type !== "string") {
    return undefined;
  }

  return {
    ...(value as unknown as TLShape),
    id: value.id,
    typeName: "shape",
    type: value.type,
    x: typeof value.x === "number" && Number.isFinite(value.x) ? value.x : 0,
    y: typeof value.y === "number" && Number.isFinite(value.y) ? value.y : 0,
    props: isRecord(value.props) ? value.props : {}
  };
}

export function normalizeAsset(value: unknown): TLAsset | undefined {
  if (!isRecord(value) || value.typeName !== "asset" || typeof value.id !== "string" || value.type !== "image") {
    return undefined;
  }

  return {
    ...(value as unknown as TLAsset),
    id: value.id,
    typeName: "asset",
    type: "image",
    props: {
      ...(isRecord(value.props) ? value.props : {}),
      src: isRecord(value.props) && typeof value.props.src === "string" ? value.props.src : "",
      w: isRecord(value.props) && typeof value.props.w === "number" ? value.props.w : 0,
      h: isRecord(value.props) && typeof value.props.h === "number" ? value.props.h : 0,
      name: isRecord(value.props) && typeof value.props.name === "string" ? value.props.name : "",
      mimeType: isRecord(value.props) && typeof value.props.mimeType === "string" ? value.props.mimeType : "image/png"
    }
  };
}

export function recordsFromSnapshot(snapshot: TLEditorSnapshot | TLStoreSnapshot | undefined): Record<string, unknown> {
  if (!snapshot || !isRecord(snapshot)) {
    return {};
  }

  if (isRecord(snapshot.document) && isRecord(snapshot.document.store)) {
    return snapshot.document.store;
  }

  return isRecord(snapshot.store) ? snapshot.store : {};
}
