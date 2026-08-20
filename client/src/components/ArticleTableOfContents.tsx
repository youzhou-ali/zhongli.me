import { ListTree, PanelRightClose } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

type ArticleHeading = {
  depth: number;
  id: string;
  text: string;
};

function cleanHeadingText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function headingId(text: string, index: number) {
  const slug = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

  return slug || `section-${index + 1}`;
}

export function extractArticleHeadings(content: string): ArticleHeading[] {
  const headings: ArticleHeading[] = [];
  const idCounts = new Map<string, number>();
  let insideFence = false;

  content.split("\n").forEach((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      insideFence = !insideFence;
      return;
    }
    if (insideFence) return;

    const match = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return;

    const text = cleanHeadingText(match[2]);
    if (!text) return;

    const baseId = headingId(text, headings.length);
    const duplicateIndex = idCounts.get(baseId) ?? 0;
    idCounts.set(baseId, duplicateIndex + 1);
    headings.push({
      depth: match[1].length,
      id: duplicateIndex ? `${baseId}-${duplicateIndex + 1}` : baseId,
      text,
    });
  });

  return headings;
}

export default function ArticleTableOfContents({ content }: { content: string }) {
  const headings = useMemo(() => extractArticleHeadings(content), [content]);
  const [activeId, setActiveId] = useState("");
  const [isOpen, setIsOpen] = useState(() => window.matchMedia("(min-width: 1360px)").matches);

  useEffect(() => {
    const renderedHeadings = Array.from(document.querySelectorAll<HTMLElement>("#article-reading-target .article-body h2, #article-reading-target .article-body h3, #article-reading-target .article-body h4, #article-reading-target .article-body h5, #article-reading-target .article-body h6"));
    renderedHeadings.forEach((heading, index) => {
      const articleHeading = headings[index];
      if (articleHeading) heading.id = articleHeading.id;
    });

    const updateActiveHeading = () => {
      let currentId = renderedHeadings[0]?.id ?? "";
      renderedHeadings.forEach((heading) => {
        if (heading.getBoundingClientRect().top <= 140) currentId = heading.id;
      });
      setActiveId(currentId);
    };

    try {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (hash) document.getElementById(hash)?.scrollIntoView();
    } catch {
      // Ignore malformed URL hashes and keep the first heading active.
    }

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    return () => window.removeEventListener("scroll", updateActiveHeading);
  }, [headings]);

  if (!headings.length) return null;

  return (
    <aside className={`article-toc ${isOpen ? "is-open" : "is-collapsed"}`} aria-label="文章目录导航">
      <button
        type="button"
        className="article-toc-toggle"
        aria-expanded={isOpen}
        aria-controls="article-toc-panel"
        title={isOpen ? "收起目录" : "展开目录"}
        onClick={() => setIsOpen((value) => !value)}
      >
        {isOpen ? <PanelRightClose size={18} aria-hidden="true" /> : <ListTree size={18} aria-hidden="true" />}
        <span className="sr-only">{isOpen ? "收起目录" : "展开目录"}</span>
      </button>
      <nav id="article-toc-panel" className="article-toc-panel" aria-label="Markdown 标题目录">
        <div className="article-toc-heading">目录 <span>{headings.length}</span></div>
        <ol>
          {headings.map((heading) => (
            <li key={heading.id} style={{ "--heading-depth": heading.depth } as CSSProperties}>
              <a
                href={`#${heading.id}`}
                className={activeId === heading.id ? "is-active" : undefined}
                aria-current={activeId === heading.id ? "location" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  const url = new URL(window.location.href);
                  url.hash = heading.id;
                  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
                  document.getElementById(heading.id)?.scrollIntoView();
                  setActiveId(heading.id);
                  if (!window.matchMedia("(min-width: 1360px)").matches) setIsOpen(false);
                }}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );
}
