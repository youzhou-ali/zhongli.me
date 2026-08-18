/** 设计提醒：数字打字机日记——文章源文件应保持纯文本、可迁移，并把阅读信息自动整理为稳定索引。 */
export type Post = {
  slug: string;
  title: string;
  date: string;
  readingTime: string;
  readingMinutes: number;
  summary: string;
  category: string;
  visual?: string;
  content: string;
};

type Frontmatter = Record<string, string>;

const markdownFiles = import.meta.glob("../../../content/posts/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function cleanValue(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(raw: string, filePath: string): Post {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) throw new Error(`文章 ${filePath} 缺少 Frontmatter。`);

  const frontmatter = match[1].split("\n").reduce<Frontmatter>((result, line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) return result;
    const key = line.slice(0, separatorIndex).trim();
    const value = cleanValue(line.slice(separatorIndex + 1));
    if (key) result[key] = value;
    return result;
  }, {});

  const content = match[2].trim();
  const plainText = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#[\]()>*_`~!|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hanCharacters = (plainText.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinWords = (plainText.match(/[A-Za-z0-9]+/g) ?? []).length;
  const readingMinutes = Math.max(1, Math.ceil((hanCharacters + latinWords) / 320));
  const fallbackSlug = filePath.split("/").pop()?.replace(/\.md$/, "") ?? "untitled";

  return {
    slug: frontmatter.slug || fallbackSlug,
    title: frontmatter.title || "未命名笔记",
    date: frontmatter.date || "2026.01.01",
    readingMinutes,
    readingTime: `${readingMinutes} 分钟`,
    summary: frontmatter.summary || "这是一篇尚未添加摘要的笔记。",
    category: frontmatter.category || "笔记",
    visual: frontmatter.visual,
    content,
  };
}

export const posts = Object.entries(markdownFiles)
  .map(([path, raw]) => parseFrontmatter(raw, path))
  .sort((first, second) => second.date.localeCompare(first.date));

export const socialLinks = [
  { label: "GitHub", href: "https://github.com" },
  { label: "X", href: "https://x.com" },
  { label: "即刻", href: "https://okjike.com" },
  { label: "邮件", href: "mailto:hello@fieldnote.page" },
];
