import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

/*
 * Toasts are shown in a reserved slot inside the sticky header (<ToastSlot />),
 * so they never cover charts, tables or text. Pages without the header (sign-in)
 * fall back to a small bar at the bottom of the screen.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success("Expense added");
 *   toast.error("Couldn't save", { action: { label: "Retry", onClick: retry } });
 *   toast("Deleted", { action: { label: "Undo", onClick: undo } });
 *   await toast.promise(save(), { loading: "Saving…", success: "Saved", error: e => e.message });
 */

export type ToastKind = "success" | "error" | "warning" | "info" | "loading";

export interface ToastOptions {
  kind?: ToastKind;
  action?: { label: string; onClick: () => void };
  // Milliseconds on screen; null keeps it until dismissed.
  duration?: number | null;
  // Runs when the toast closes without its action being used: it timed out,
  // was closed, or was pushed out of a full queue. Use it to commit something
  // that the action (Undo) could still cancel.
  onDismiss?: () => void;
  // Reusing an id replaces that toast (e.g. "Saving…" becomes "Saved").
  id?: string;
}

interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  action?: ToastOptions["action"];
  onDismiss?: () => void;
  duration: number | null;
  count: number;
  // Bumped whenever the toast's timer restarts.
  version: number;
}

type PromiseMessages<T> = {
  loading: string;
  success: string | ((value: T) => string);
  error?: string | ((error: Error) => string);
};

export interface ToastApi {
  (message: string, options?: ToastOptions | "error"): string;
  success: (message: string, options?: Omit<ToastOptions, "kind">) => string;
  error: (message: string, options?: Omit<ToastOptions, "kind">) => string;
  warning: (message: string, options?: Omit<ToastOptions, "kind">) => string;
  info: (message: string, options?: Omit<ToastOptions, "kind">) => string;
  loading: (message: string, options?: Omit<ToastOptions, "kind" | "duration">) => string;
  promise: <T>(promise: Promise<T>, messages: PromiseMessages<T>) => Promise<T>;
  dismiss: (id?: string) => void;
}

const DURATIONS: Record<ToastKind, number | null> = {
  success: 3500,
  info: 4500,
  warning: 6500,
  error: 8000,
  loading: null
};
// A toast with an action (Undo, Retry) stays long enough to use it.
const ACTION_MIN_DURATION = 6000;
const MAX_TOASTS = 5;

interface ViewState {
  toasts: ToastItem[];
  paused: boolean;
  remaining: (id: string) => number | null;
  setHovered: (hovered: boolean) => void;
  dismiss: (id: string, reason?: "closed" | "action") => void;
  registerSlot: () => () => void;
}

const ApiContext = createContext<ToastApi | null>(null);
const ViewContext = createContext<ViewState | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const [slots, setSlots] = useState(0);
  const toastsRef = useRef<ToastItem[]>([]);
  // Time left for each toast, kept outside state so pausing doesn't re-render.
  const remainingRef = useRef(new Map<string, number>());
  // Bumped each time a toast is (re)shown, so a running timer knows its saved
  // time left is stale.
  const resetsRef = useRef(new Map<string, number>());

  const paused = hovered || hidden;
  const top = toasts[toasts.length - 1];

  // The list is updated through the ref first, so several calls in the same
  // tick see each other's changes.
  const commit = useCallback((next: ToastItem[], removed: ToastItem[]) => {
    toastsRef.current = next;
    setToasts(next);

    for (const item of removed) {
      remainingRef.current.delete(item.id);
      resetsRef.current.delete(item.id);
      item.onDismiss?.();
    }
  }, []);

  // Closes one toast (or all). "action" means its action button was used, so
  // its onDismiss doesn't run.
  const dismiss = useCallback((id?: string, reason: "closed" | "action" = "closed") => {
    const current = toastsRef.current;
    const removed = id ? current.filter(item => item.id === id) : current;
    if (!removed.length) return;

    commit(
      id ? current.filter(item => item.id !== id) : [],
      reason === "action" ? [] : removed
    );
    if (reason === "action") {
      removed.forEach(item => {
        remainingRef.current.delete(item.id);
        resetsRef.current.delete(item.id);
      });
    }
  }, [commit]);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    const kind = options.kind ?? "success";
    let duration = options.duration !== undefined ? options.duration : DURATIONS[kind];
    if (options.action && duration !== null) duration = Math.max(duration, ACTION_MIN_DURATION);

    // Same message again: count it instead of stacking duplicates.
    const duplicate = !options.id && !options.action
      ? toastsRef.current.find(item => item.kind === kind && item.message === message)
      : undefined;
    const id = options.id ?? duplicate?.id ?? `toast-${nextId++}`;

    if (duration !== null) remainingRef.current.set(id, duration);
    else remainingRef.current.delete(id);
    resetsRef.current.set(id, (resetsRef.current.get(id) ?? 0) + 1);

    const current = toastsRef.current;
    const existing = current.find(item => item.id === id);
    const item: ToastItem = {
      id,
      kind,
      message,
      action: options.action,
      onDismiss: options.onDismiss,
      duration,
      count: duplicate ? (existing?.count ?? 1) + 1 : 1,
      version: (existing?.version ?? 0) + 1
    };
    const rest = current.filter(entry => entry.id !== id);
    const evicted: ToastItem[] = [];

    // Keep the stack short; drop the oldest non-error first.
    while (rest.length >= MAX_TOASTS) {
      const index = rest.findIndex(entry => entry.kind !== "error");
      evicted.push(...rest.splice(index === -1 ? 0 : index, 1));
    }

    commit([...rest, item], evicted);
    return id;
  }, [commit]);

  // Only the newest toast is on screen, so only its timer runs. It pauses
  // while hovered or focused and while the browser tab is in the background.
  useEffect(() => {
    if (!top || top.duration === null || paused) return;

    const remaining = remainingRef.current.get(top.id) ?? top.duration;
    const resets = resetsRef.current.get(top.id);
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss(top.id), remaining);

    return () => {
      window.clearTimeout(timer);
      // Save the time left, unless the toast was re-shown meanwhile (which
      // already reset its full duration).
      if (resetsRef.current.get(top.id) === resets && remainingRef.current.has(top.id)) {
        remainingRef.current.set(top.id, Math.max(0, remaining - (Date.now() - started)));
      }
    };
  }, [top?.id, top?.version, top?.duration, paused, dismiss]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const api = useMemo<ToastApi>(() => {
    const call = ((message: string, options?: ToastOptions | "error") =>
      show(message, options === "error" ? { kind: "error" } : options)) as ToastApi;

    call.success = (message, options) => show(message, { ...options, kind: "success" });
    call.error = (message, options) => show(message, { ...options, kind: "error" });
    call.warning = (message, options) => show(message, { ...options, kind: "warning" });
    call.info = (message, options) => show(message, { ...options, kind: "info" });
    call.loading = (message, options) => show(message, { ...options, kind: "loading", duration: null });
    call.dismiss = dismiss;
    call.promise = async (promise, messages) => {
      const id = show(messages.loading, { kind: "loading", duration: null });

      try {
        const value = await promise;
        show(typeof messages.success === "function" ? messages.success(value) : messages.success, { kind: "success", id });
        return value;
      } catch (error) {
        const fallback = (error as Error)?.message || "Something went wrong.";
        const message = typeof messages.error === "function" ? messages.error(error as Error) : messages.error ?? fallback;
        show(message, { kind: "error", id });
        throw error;
      }
    };

    return call;
  }, [show, dismiss]);

  const registerSlot = useCallback(() => {
    setSlots(count => count + 1);
    return () => setSlots(count => count - 1);
  }, []);

  const view = useMemo<ViewState>(() => ({
    toasts,
    paused,
    remaining: id => remainingRef.current.get(id) ?? null,
    setHovered,
    dismiss,
    registerSlot
  }), [toasts, paused, dismiss, registerSlot]);

  return (
    <ApiContext.Provider value={api}>
      <ViewContext.Provider value={view}>
        {children}
        {slots === 0 && (
          <div className="toast-floating">
            <ToastSlotContent />
          </div>
        )}
      </ViewContext.Provider>
    </ApiContext.Provider>
  );
}

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={16} />,
  error: <XCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />,
  loading: <span className="spinner" />
};

// The reserved place for toasts, rendered inside the app header.
export function ToastSlot() {
  const view = useContext(ViewContext);

  useEffect(() => view?.registerSlot(), [view?.registerSlot]);

  return (
    <div className="toast-slot">
      <ToastSlotContent />
    </div>
  );
}

function ToastSlotContent() {
  const view = useContext(ViewContext)!;
  const top = view.toasts[view.toasts.length - 1];
  const queued = view.toasts.length - 1;
  const remaining = top ? view.remaining(top.id) : null;

  return (
    // The live region stays mounted so screen readers announce new toasts.
    <div className="toast-live" role="status" aria-live="polite" aria-atomic="true">
      {top && (
        <div
          key={top.id}
          className={`app-toast ${top.kind}`}
          role={top.kind === "error" ? "alert" : undefined}
          title={top.message}
          onMouseEnter={() => view.setHovered(true)}
          onMouseLeave={() => view.setHovered(false)}
          onFocus={() => view.setHovered(true)}
          onBlur={() => view.setHovered(false)}
          onKeyDown={event => { if (event.key === "Escape") view.dismiss(top.id); }}
        >
          <span className="t-icon" aria-hidden="true">{ICONS[top.kind]}</span>
          <span className="t-msg">
            {top.message}
            {top.count > 1 && <span className="t-count"> ×{top.count}</span>}
          </span>
          {top.action && (
            <button
              type="button"
              className="t-action"
              onClick={() => {
                top.action!.onClick();
                view.dismiss(top.id, "action");
              }}
            >
              {top.action.label}
            </button>
          )}
          {queued > 0 && <span className="t-queue" title={`${queued} more`}>+{queued}</span>}
          {top.kind !== "loading" && (
            <button type="button" className="t-close" aria-label="Dismiss notification" onClick={() => view.dismiss(top.id)}>
              <X size={14} />
            </button>
          )}
          {top.duration !== null && remaining !== null && (
            <Progress key={`${top.id}-${top.version}`} remaining={remaining} paused={view.paused} />
          )}
        </div>
      )}
    </div>
  );
}

// Time-left line. Its duration is fixed when it appears, so pausing (hover)
// and resuming doesn't make it jump.
function Progress({ remaining, paused }: { remaining: number; paused: boolean }) {
  const [duration] = useState(remaining);

  return (
    <span
      className="t-progress"
      aria-hidden="true"
      style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? "paused" : "running" }}
    />
  );
}

export function useToast(): ToastApi {
  const api = useContext(ApiContext);

  if (!api) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return api;
}
