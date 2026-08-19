import type { MouseEvent } from "react";
import { flushSync } from "react-dom";

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => { finished: Promise<void> };
};

type PostListAnchor = {
  slug: string;
  path: string;
  viewportOffset: number;
  scrollTop: number;
  savedAt: number;
};

type PostTransitionOptions = {
  onBeforeNavigate?: () => void;
  onAfterNavigate?: () => void;
};

const postListAnchorKey = "zhongli-post-list-anchor";
const anchorMaxAgeMs = 6 * 60 * 60 * 1000;

function useManualScrollRestoration() {
  if (typeof history !== "undefined" && "scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }
}

export function rememberPostListAnchor(slug: string) {
  useManualScrollRestoration();
  const title = document.getElementById(`post-title-anchor-${slug}`);
  const anchor: PostListAnchor = {
    slug,
    path: window.location.pathname,
    viewportOffset: title?.getBoundingClientRect().top ?? 0,
    scrollTop: window.scrollY,
    savedAt: Date.now(),
  };
  sessionStorage.setItem(postListAnchorKey, JSON.stringify(anchor));
}

export function getPostListAnchor() {
  try {
    const stored = sessionStorage.getItem(postListAnchorKey);
    if (!stored) return null;
    const anchor = JSON.parse(stored) as PostListAnchor;
    if (!anchor.savedAt || Date.now() - anchor.savedAt > anchorMaxAgeMs) {
      sessionStorage.removeItem(postListAnchorKey);
      return null;
    }
    return anchor;
  } catch {
    return null;
  }
}

function applyAnchor(anchor: PostListAnchor) {
  const title = document.getElementById(`post-title-anchor-${anchor.slug}`);
  if (!title) {
    window.scrollTo({ top: anchor.scrollTop, behavior: "instant" });
    return;
  }

  const currentOffset = title.getBoundingClientRect().top;
  const destination = window.scrollY + currentOffset - anchor.viewportOffset;
  window.scrollTo({ top: Math.max(0, destination), behavior: "instant" });
}

export function restorePostListAnchor(anchor: PostListAnchor | null) {
  if (!anchor) return;
  useManualScrollRestoration();

  // Apply immediately so View Transition captures the destination title at
  // exactly the same viewport offset as the source list item.
  applyAnchor(anchor);

  // Then correct after layout and web-font settling to avoid sub-pixel drift.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => applyAnchor(anchor));
  });
  document.fonts?.ready.then(() => requestAnimationFrame(() => applyAnchor(anchor))).catch(() => undefined);
}

export function restorePostListAnchorForPath(path: string) {
  const anchor = getPostListAnchor();
  if (!anchor || anchor.path !== path) return;
  restorePostListAnchor(anchor);
}

export function navigateWithPostTransition(
  event: MouseEvent<HTMLAnchorElement>,
  targetPath: string,
  direction: "forward" | "backward",
  setLocation: (path: string) => void,
  options: PostTransitionOptions = {},
) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  useManualScrollRestoration();
  event.preventDefault();
  options.onBeforeNavigate?.();

  const updateRoute = () => {
    flushSync(() => setLocation(targetPath));
    if (direction === "forward") window.scrollTo({ top: 0, behavior: "instant" });
    options.onAfterNavigate?.();
  };

  const transitionDocument = document as ViewTransitionDocument;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!transitionDocument.startViewTransition || prefersReducedMotion) {
    updateRoute();
    return;
  }

  document.documentElement.dataset.postTransition = direction;
  const transition = transitionDocument.startViewTransition(updateRoute);
  transition.finished.finally(() => {
    delete document.documentElement.dataset.postTransition;
  });
}
