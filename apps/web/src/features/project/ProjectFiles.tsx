import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";

interface ProjectFilesProps {
  ready: boolean;
  begin: (importing: boolean) => Promise<unknown>;
  end: () => void;
}

export function ProjectFiles({ ready, begin, end }: ProjectFilesProps) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const reportError = async (response: Response) => {
    const body = await response.json().catch(() => null) as { error?: { message?: string; }; } | null;
    throw new Error(body?.error?.message || t("projectFileFailed"));
  };
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(false); setMessage(t("projectFileSaving"));
    try {
      const snapshot = await begin(false);
      const response = await fetch("/api/project/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshot }) });
      if (!response.ok) await reportError(response);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `InsBoard-${new Date().toISOString().slice(0, 10)}.idb`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(t("projectFileSaved"));
    } catch (error) { setError(true); setMessage(error instanceof Error ? error.message : t("projectFileFailed")); }
    finally { end(); setBusy(false); }
  };
  const open = async (file: File) => {
    if (busy) return;
    setBusy(true); setError(false); setMessage(t("projectFileOpening"));
    try {
      if (!file.name.toLowerCase().endsWith(".idb") || file.size > 512 * 1024 * 1024) throw new Error(t("projectFileInvalid"));
      await begin(true);
      const response = await fetch("/api/project/import", { method: "POST", headers: { "Content-Type": "application/x-insboard" }, body: file });
      if (!response.ok) await reportError(response);
      window.location.reload();
    } catch (error) { setError(true); setMessage(error instanceof Error ? error.message : t("projectFileFailed")); end(); setBusy(false); }
  };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !["s", "o"].includes(event.key.toLowerCase())) return;
      event.preventDefault();
      if (!ready || busy) return;
      if (event.key.toLowerCase() === "s") void save();
      else input.current?.click();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });
  return <div className="project-files" role="group" aria-label={t("projectFileActions")}>
    <input ref={input} type="file" accept=".idb" hidden aria-label={t("projectFileOpen")} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void open(file); }} />
    <button className="project-file-action" type="button" disabled={!ready || busy} aria-keyshortcuts="Meta+O Control+O" title={`${t("projectFileOpenHint")} · ${navigator.platform.includes("Mac") ? "⌘O" : "Ctrl+O"}`} onClick={() => input.current?.click()}>{t("projectFileOpen")}</button>
    <button className="project-file-action" type="button" disabled={!ready || busy} aria-keyshortcuts="Meta+S Control+S" title={`${t("projectFileSaveHint")} · ${navigator.platform.includes("Mac") ? "⌘S" : "Ctrl+S"}`} onClick={() => void save()}>{t("projectFileSave")}</button>
    {message && <div className="project-file-message" data-error={error} role={error ? "alert" : "status"}><span>{message}</span>{!busy && <button type="button" aria-label={t("projectFileDismiss")} onClick={() => setMessage("")}>×</button>}</div>}
  </div>;
}
