import { useEffect, useRef, type ReactNode } from "react";

export function CanvasDialog({ title, children, onClose, busy = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return <dialog ref={dialogRef} className="canvas-dialog" aria-label={title} aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}>
    <h2>{title}</h2>
    {children}
  </dialog>;
}
