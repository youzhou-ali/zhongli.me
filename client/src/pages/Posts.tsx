/** 设计提醒：数字打字机日记——索引页像一条连续的阅读轨道，避免卡片化信息噪声。 */
import { PageLayout } from "@/components/SiteChrome";
import PostList from "@/components/PostList";
import { posts } from "@/lib/blog";

export default function Posts() {
  return <PageLayout><section className="archive-page intro-appear"><p className="eyebrow">ARCHIVE / 2026</p><h1>所有笔记</h1><p className="archive-lede">关于构建、界面、工作方式与持续好奇。</p><PostList posts={posts} /></section></PageLayout>;
}
