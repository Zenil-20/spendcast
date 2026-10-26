import { useEffect, useRef } from "react";

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName));
}

// Runs `handler` when `key` is pressed outside a text field, with no modifier
// keys and no dialog open.
export function useShortcut(key: string, handler: () => void, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== key || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) {
        return;
      }

      if (document.querySelector("[role='dialog']")) {
        return;
      }

      event.preventDefault();
      handlerRef.current();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [key, enabled]);
}
