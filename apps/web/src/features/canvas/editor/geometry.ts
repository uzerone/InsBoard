import { type Camera, type CanvasBounds, type TLAsset, type TLShape } from "./types";

export const CAMERA_EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const DEFAULT_CAMERA_ANIMATION_DURATION = 220;

export const GRID_STEP = 24;

function cubicBezierCoordinate(t: number, control1: number, control2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * control1 + 3 * inverse * t * t * control2 + t * t * t;
}

export function cubicBezierEase(progress: number, x1: number, y1: number, x2: number, y2: number): number {
  if (progress <= 0) {
    return 0;
  }
  if (progress >= 1) {
    return 1;
  }
  let lower = 0;
  let upper = 1;
  let parameter = progress;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    parameter = (lower + upper) / 2;
    const x = cubicBezierCoordinate(parameter, x1, x2);
    if (Math.abs(x - progress) < 0.0001) {
      break;
    }
    if (x < progress) {
      lower = parameter;
    } else {
      upper = parameter;
    }
  }

  return cubicBezierCoordinate(parameter, y1, y2);
}

export function gridBackground(camera: Camera): { backgroundPosition: string; backgroundSize: string; backgroundImage: string; } {
  const step = GRID_STEP * camera.zoom;
  return {
    backgroundPosition: `${camera.x % step}px ${camera.y % step}px`,
    backgroundSize: `${step}px ${step}px`,
    backgroundImage: `radial-gradient(circle, var(--canvas-paper-grid) ${camera.zoom}px, transparent ${1.2 * camera.zoom}px)`
  };
}

export function shapeSize(shape: TLShape): { w: number; h: number; } {
  const w = typeof shape.props.w === "number" && Number.isFinite(shape.props.w) ? shape.props.w : 240;
  const h = typeof shape.props.h === "number" && Number.isFinite(shape.props.h) ? shape.props.h : 180;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

export function imageSizeAtOriginalRatio(shape: TLShape, asset: TLAsset | undefined): { w: number; h: number; } {
  const size = shapeSize(shape);
  if (!asset || !Number.isFinite(asset.props.w) || !Number.isFinite(asset.props.h) || asset.props.w <= 0 || asset.props.h <= 0) {
    return size;
  }
  return { w: size.w, h: size.w * asset.props.h / asset.props.w };
}

export function boundsForShape(shape: TLShape): CanvasBounds {
  const { w, h } = shapeSize(shape);
  return {
    x: shape.x,
    y: shape.y,
    w,
    h,
    center: { x: shape.x + w / 2, y: shape.y + h / 2 }
  };
}

export function snapCoordinate(value: number): number {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

export function dragTranslation(origin: { x: number; y: number; }, delta: { x: number; y: number; }, snap: boolean): { x: number; y: number; } {
  return snap ? { x: snapCoordinate(origin.x + delta.x) - origin.x, y: snapCoordinate(origin.y + delta.y) - origin.y } : delta;
}
