import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/*
 * A section page made of several related parts (e.g. Health: score, overlap,
 * allocation), each with an anchor, and "On this page" links that stay pinned
 * under the app header. /investments/health#overlap opens the page at that
 * part. The pinned links highlight the part being read.
 */

export interface Part {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
}

// How long a deep link keeps re-aligning while parts above it load.
const SETTLE_MS = 2500;

// The space taken by the app header and the pinned links, read from the page
// so a different header height or wrapped links still land right.
function stickyOffset(bar: HTMLElement | null): number {
  const header = document.querySelector(".app-header")?.getBoundingClientRect().height ?? 0;
  return header + (bar?.getBoundingClientRect().height ?? 0) + 12;
}

export function PageParts({ parts }: { parts: Part[] }) {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const barRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Set when a click already scrolled, so the hash change doesn't scroll again.
  const scrolledByClick = useRef(false);
  const [active, setActive] = useState(parts[0]?.id ?? "");

  function scrollToPart(id: string, behavior: ScrollBehavior) {
    // The first part goes to the very top, page title included.
    if (id === parts[0]?.id) {
      window.scrollTo({ top: 0, behavior });
      return;
    }
    const element = document.getElementById(id);
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY - stickyOffset(barRef.current);
    window.scrollTo({ top: Math.max(0, top), behavior });
  }

  // Opening a link to a part (or a redirect from an old path). Parts above it
  // load their data after this runs and push it down, so keep it aligned as
  // the page grows, until it settles or the user scrolls on their own.
  useEffect(() => {
    if (!hash) return;
    if (scrolledByClick.current) {
      scrolledByClick.current = false;
      return;
    }
    const id = decodeURIComponent(hash.slice(1));
    if (!parts.some(part => part.id === id)) return;

    let stopped = false;
    const stop = () => { stopped = true; };
    const align = () => { if (!stopped) scrollToPart(id, "auto"); };
    const observer = new ResizeObserver(align);
    if (containerRef.current) observer.observe(containerRef.current);
    align();

    const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    events.forEach(event => window.addEventListener(event, stop, { passive: true, once: true }));
    const timer = window.setTimeout(stop, SETTLE_MS);

    return () => {
      stop();
      observer.disconnect();
      window.clearTimeout(timer);
      events.forEach(event => window.removeEventListener(event, stop));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  // Highlight the part being read: the last one whose top has passed the
  // pinned links (the last part once the page can't scroll further).
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const offset = stickyOffset(barRef.current) + 8;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current = parts[0]?.id ?? "";
      for (const part of parts) {
        const element = document.getElementById(part.id);
        if (element && element.getBoundingClientRect().top <= offset) current = part.id;
      }
      setActive(atBottom && window.scrollY > 0 ? parts[parts.length - 1].id : current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [parts]);

  return (
    <div className="stack" style={{ gap: 44 }} ref={containerRef}>
      {parts.length > 1 && (
        <nav className="on-page" aria-label="On this page" ref={barRef}>
          <span className="small ink-3">On this page</span>
          {parts.map(part => (
            <a
              key={part.id}
              href={`#${part.id}`}
              aria-current={active === part.id ? "location" : undefined}
              onClick={event => {
                event.preventDefault();
                scrollToPart(part.id, "smooth");
                // Keep the URL shareable without scrolling a second time.
                if (hash !== `#${part.id}`) {
                  scrolledByClick.current = true;
                  navigate({ hash: part.id }, { replace: true });
                }
              }}
            >
              {part.title}
            </a>
          ))}
        </nav>
      )}

      {parts.map(part => (
        <section key={part.id} id={part.id} className="page-part" aria-labelledby={`${part.id}-title`}>
          <header>
            <h3 id={`${part.id}-title`}>{part.title}</h3>
            {part.description && <p>{part.description}</p>}
          </header>
          {part.content}
        </section>
      ))}
    </div>
  );
}
