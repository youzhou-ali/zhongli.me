/** 设计提醒：数字打字机日记——索引页像一条连续的阅读轨道，避免卡片化信息噪声。 */
import { PageLayout } from "@/components/SiteChrome";
import PostList from "@/components/PostList";
import { posts } from "@/lib/blog";
import { restorePostListAnchorForPath } from "@/lib/postTransition";
import { useEffect } from "react";

export default function Posts() {
  const years = Array.from(new Set(posts.map((post) => post.date.slice(0, 4)))).join(" · ");
  useEffect(() => { restorePostListAnchorForPath("/posts"); }, []);
  return <PageLayout><section className="archive-page intro-appear"><p className="eyebrow">ARCHIVE / {years || "EMPTY"}</p><h1>所有笔记</h1><p className="archive-lede">共 {posts.length} 篇，全部由本地 Markdown 文件自动整理。</p><PostList posts={posts} /></section></PageLayout>;
}
