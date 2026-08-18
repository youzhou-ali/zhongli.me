/** 设计提醒：数字打字机日记——共享标题只负责导航定位，其他内容以克制的淡入保持阅读节奏。 */
import type { MouseEvent } from "react";
import { flushSync } from "react-dom";

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => { finished: Promise<void> };
};

export function navigateWithPostTransition(
  event: MouseEvent<HTMLAnchorElement>,
  targetPath: string,
  direction: "forward" | "backward",
  setLocation: (path: string) => void,
) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const transitionDocument = document as ViewTransitionDocument;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!transitionDocument.startViewTransition || prefersReducedMotion) return;

  event.preventDefault();
  document.documentElement.dataset.postTransition = direction;
  const transition = transitionDocument.startViewTransition(() => {
    flushSync(() => setLocation(targetPath));
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  transition.finished.finally(() => delete document.documentElement.dataset.postTransition);
}
