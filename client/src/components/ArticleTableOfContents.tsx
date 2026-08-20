import { type CSSProperties, useEffect, useMemo } from "react";

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

  useEffect(() => {
    const renderedHeadings = document.querySelectorAll<HTMLElement>("#article-reading-target .article-body h2, #article-reading-target .article-body h3, #article-reading-target .article-body h4, #article-reading-target .article-body h5, #article-reading-target .article-body h6");
    renderedHeadings.forEach((heading, index) => {
      const articleHeading = headings[index];
      if (articleHeading) heading.id = articleHeading.id;
    });

    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) document.getElementById(hash)?.scrollIntoView();
  }, [headings]);

  if (!headings.length) return null;

  return (
    <nav className="article-toc" aria-label="文章目录">
      <details open={headings.length <= 12}>
        <summary>目录 <span>{headings.length}</span></summary>
        <ol>
          {headings.map((heading) => (
            <li key={heading.id} style={{ "--heading-depth": heading.depth } as CSSProperties}>
              <a href={`#${heading.id}`}>{heading.text}</a>
            </li>
          ))}
        </ol>
      </details>
    </nav>
  );
}
