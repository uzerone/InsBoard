import type { GenerationPlan, WorkflowClientMessage, WorkflowServerEvent } from "@insboard/shared";
import type { Editor } from "../canvas/editor/Editor";
import type { TLShapePartial } from "../canvas/editor/types";
import { isWorkflowNode, workflowNodes, type WorkflowNode } from "./model";

export class WorkflowRunner {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private connectTimeout: ReturnType<typeof setTimeout> | undefined;
  private pending: WorkflowClientMessage | undefined;
  private runId = "";
  private connectionId = "";
  private cancelled = false;
  private disposed = false;
  private attempts = 0;
  private unsubscribe: () => void;

  constructor(private editor: Editor, private notify: (state: "connecting" | "running" | "done" | "error", error?: string) => void) {
    const restore = () => {
      if (this.runId || this.disposed) return;
      const node = workflowNodes(editor).find((item) => item.props.runId);
      if (!node) return;
      this.runId = node.props.runId;
      this.connectionId = node.props.connectionId;
      this.connect();
    };
    this.unsubscribe = editor.subscribe(restore);
    restore();
  }

  start(plan: GenerationPlan, retry: boolean): void {
    if (this.runId) return;
    this.runId = `workflow-run-${crypto.randomUUID()}`;
    this.connectionId = "";
    this.cancelled = false;
    this.attempts = 0;
    this.pending = { type: retry ? "retry_failed" : "execute_plan", requestId: crypto.randomUUID(), runId: this.runId, planId: plan.id, plan };
    this.updateNodes(plan.jobs.map((job) => ({
      id: job.id, props: {
        runId: this.runId, connectionId: "", planId: plan.id, status: job.status, outputs: job.outputs, error: ""
      }
    })));
    this.connect();
  }

  cancel(): void {
    if (!this.runId) return;
    this.cancelled = true;
    if (this.pending) {
      this.finish("cancelled");
      return;
    }
    if (this.socket?.readyState === WebSocket.OPEN) this.sendCancel();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.closeSocket();
  }

  private closeSocket(): void {
    clearTimeout(this.timer);
    clearTimeout(this.connectTimeout);
    clearInterval(this.heartbeat);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private sendCancel(): void {
    this.socket?.send(JSON.stringify({ type: "cancel_run", runId: this.runId, requestId: crypto.randomUUID() }));
  }

  private connect(): void {
    if (this.disposed || !this.runId) return;
    this.notify("connecting");
    const url = new URL("/api/workflow/ws", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (!this.pending) {
      url.searchParams.set("runId", this.runId);
      if (this.connectionId) url.searchParams.set("connectionId", this.connectionId);
    }
    const socket = new WebSocket(url);
    this.socket = socket;
    this.connectTimeout = setTimeout(() => socket.close(), 12_000);
    socket.onopen = () => {
      if (this.socket !== socket || this.disposed) return;
      clearTimeout(this.connectTimeout);
      this.attempts = 0;
      this.notify("running");
      if (this.pending) {
        socket.send(JSON.stringify(this.pending));
        this.pending = undefined;
      }
      if (this.cancelled) this.sendCancel();
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 20_000);
    };
    socket.onmessage = (message) => {
      if (this.socket !== socket || this.disposed) return;
      try { this.receive(JSON.parse(String(message.data)) as WorkflowServerEvent); } catch { this.notify("error"); }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket || this.disposed || !this.runId) return;
      clearTimeout(this.connectTimeout);
      clearInterval(this.heartbeat);
      this.socket = null;
      this.notify("connecting");
      this.timer = setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** Math.min(this.attempts++, 5)));
    };
  }

  private receive(event: WorkflowServerEvent): void {
    if (event.type === "connected") {
      this.connectionId = event.connectionId;
      this.updateNodes(this.activeNodes().map((node) => ({ id: node.id, props: { connectionId: event.connectionId } })));
      return;
    }
    if (event.runId !== this.runId) return;
    if (event.type === "plan_updated") {
      this.updateNodes(event.plan.jobs.flatMap((job) => {
        const node = this.editor.getShape(job.id);
        return node && isWorkflowNode(node) && node.props.runId === this.runId
          ? [{ id: node.id, props: { status: job.status, outputs: job.outputs, error: job.error ?? "" } }] : [];
      }));
    } else if (event.type === "error") {
      this.failActiveRun(event.code);
    } else if (event.type === "run_cancelled") {
      this.finish("cancelled");
    } else if (event.type === "run_done") {
      this.finish(event.status);
    }
  }

  private updateNodes(updates: TLShapePartial<WorkflowNode>[]): void {
    this.editor.run(() => this.editor.updateShapes<WorkflowNode>(updates), { history: "ignore" });
  }

  private activeNodes(): WorkflowNode[] {
    return workflowNodes(this.editor).filter((node) => node.props.runId === this.runId);
  }

  private failActiveRun(code: string): void {
    this.notify("error", code);
    this.updateNodes(this.activeNodes().filter((node) => node.props.status !== "succeeded").map((node) => ({
      id: node.id, props: { status: "failed", error: code }
    })));
    this.finish("failed");
  }

  private finish(status: "succeeded" | "failed" | "cancelled"): void {
    const updates = this.activeNodes().map((node) => ({
      id: node.id, props: {
        runId: "", connectionId: "",
        ...(["queued", "running"].includes(node.props.status) ? { status: status === "cancelled" ? "cancelled" as const : "blocked" as const } : {})
      }
    }));
    this.closeSocket();
    this.pending = undefined;
    this.updateNodes(updates);
    this.runId = "";
    this.notify(status === "failed" ? "error" : "done");
  }
}
