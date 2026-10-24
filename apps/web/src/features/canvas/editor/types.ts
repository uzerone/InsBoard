
export type TLShapeId = string;

export type TLAssetId = string;

export interface TLAsset {
  id: TLAssetId;
  typeName: "asset";
  type: "image";
  props: {
    src: string;
    w: number;
    h: number;
    name: string;
    mimeType: string;
    isAnimated?: boolean;
    [key: string]: unknown;
  };
  meta?: Record<string, unknown>;
}

export interface TLBaseShape<TProps extends object = Record<string, unknown>> {
  id: TLShapeId;
  typeName: "shape";
  type: string;
  x: number;
  y: number;
  rotation?: number;
  opacity?: number;
  props: TProps;
  meta?: Record<string, unknown>;
}

export interface TLImageShape extends TLBaseShape<{
  assetId: TLAssetId | null;
  w: number;
  h: number;
  url?: string;
  playing?: boolean;
  crop?: unknown;
  flipX?: boolean;
  flipY?: boolean;
  altText?: string;
  [key: string]: unknown;
}> {
  type: "image";
}

export type TLShape = TLBaseShape<any>;

export type TLShapePartial<TShape extends TLBaseShape<any> = TLShape> = {
  id: TLShapeId;
  type?: TShape["type"];
  x?: number;
  y?: number;
  props?: Partial<TShape["props"]>;
  meta?: Record<string, unknown>;
};

export interface TLStoreSnapshot {
  snapToGrid?: boolean;
  lastNodeNumber?: number;
  store: Record<string, TLShape | TLAsset | unknown>;
}

export interface TLEditorSnapshot {
  snapToGrid?: boolean;
  lastNodeNumber?: number;
  document?: TLStoreSnapshot;
  store?: Record<string, TLShape | TLAsset | unknown>;
}

export interface TLAssetStore {
  upload(asset: TLAsset, file: File): Promise<{ src: string; }>;
  resolve(asset: TLAsset): string | null;
}

export interface CanvasBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  center: { x: number; y: number; };
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface CameraAnimationOptions {
  animation?: {
    duration?: number;
  };
  inset?: number;
}

export type StoreListener = (change?: unknown) => void;

export type EditorEventListener = () => void;
