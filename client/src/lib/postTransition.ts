/** 设计提醒：数字打字机日记——共享标题只负责导航定位，其他内容以克制的淡入保持阅读节奏。 */
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
};

type PostTransitionOptions = {
  onBeforeNavigate?: () => void;
  onAfterNavigate?: () => void;
};

const postListAnchorKey = "fieldnote-post-list-anchor";

export function rememberPostListAnchor(slug: string) {
  const title = document.getElementById(`post-title-anchor-${slug}`);
  const anchor: PostListAnchor = {
    slug,
    path: window.location.pathname,
    viewportOffset: title?.getBoundingClientRect().top ?? 0,
    scrollTop: window.scrollY,
  };
  sessionStorage.setItem(postListAnchorKey, JSON.stringify(anchor));
}

export function getPostListAnchor() {
  try {
    const stored = sessionStorage.getItem(postListAnchorKey);
    return stored ? (JSON.parse(stored) as PostListAnchor) : null;
  } catch {
    return null;
  }
}

export function restorePostListAnchor(anchor: PostListAnchor | null) {
  if (!anchor) return;
  const title = document.getElementById(`post-title-anchor-${anchor.slug}`);
  if (title) {
    const destination = window.scrollY + title.getBoundingClientRect().top - anchor.viewportOffset;
    window.scrollTo({ top: Math.max(0, destination), behavior: "instant" });
  } else {
    window.scrollTo({ top: anchor.scrollTop, behavior: "instant" });
  }
  sessionStorage.removeItem(postListAnchorKey);
}

export function restorePostListAnchorForPath(path: string) {
  const anchor = getPostListAnchor();
  if (!anchor || anchor.path !== path) return;
  requestAnimationFrame(() => restorePostListAnchor(anchor));
}

export function navigateWithPostTransition(
  event: MouseEvent<HTMLAnchorElement>,
  targetPath: string,
  direction: "forward" | "backward",
  setLocation: (path: string) => void,
  options: PostTransitionOptions = {},
) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const transitionDocument = document as ViewTransitionDocument;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  event.preventDefault();

  const updateRoute = () => {
    flushSync(() => setLocation(targetPath));
    if (direction === "forward") window.scrollTo({ top: 0, behavior: "instant" });
    options.onAfterNavigate?.();
  };

  options.onBeforeNavigate?.();
  if (!transitionDocument.startViewTransition || prefersReducedMotion) {
    updateRoute();
    return;
  }

  document.documentElement.dataset.postTransition = direction;
  const transition = transitionDocument.startViewTransition(() => {
    updateRoute();
  });
  transition.finished.finally(() => delete document.documentElement.dataset.postTransition);
}
