/** 设计提醒：数字打字机日记——长文页面以舒适行宽、清楚层级和可靠返回路径保护阅读心流。 */
import { ArrowLeft, CalendarDays, Clock3 } from "lucide-react";
import { Streamdown } from "streamdown";
import { Link, useRoute } from "wouter";
import ReadingProgress from "@/components/ReadingProgress";
import { PageLayout } from "@/components/SiteChrome";
import { posts } from "@/lib/blog";

export default function Article() {
  const [, params] = useRoute("/posts/:slug");
  const post = posts.find((item) => item.slug === params?.slug);
  if (!post) return <PageLayout><section className="not-found-page"><p className="eyebrow">404 / LOST NOTE</p><h1>这条笔记不在这里。</h1><Link href="/posts" className="back-link"><ArrowLeft size={16} /> 回到文章索引</Link></section></PageLayout>;
  return (
    <PageLayout>
      <ReadingProgress readingTime={post.readingTime} />
      <article className="article-page article-detail-enter" id="article-reading-target">
        <Link href="/posts" className="back-link"><ArrowLeft size={16} /> 全部笔记</Link>
        <p className="eyebrow">{post.category}</p><h1 className="article-transition-title" style={{ viewTransitionName: `post-title-${post.slug}` }}>{post.title}</h1>
        <div className="article-meta"><span><CalendarDays size={14} /> {post.date}</span><i>·</i><span><Clock3 size={14} /> 预计 {post.readingTime}</span></div>
        <p className="article-dek">{post.summary}</p>
        {post.visual && <img className="article-visual" src={post.visual} alt="与文章主题对应的技术笔记插画" />}
        <div className="article-body"><Streamdown>{post.content}</Streamdown></div>
        <div className="article-end">— 记录于一段安静的工作时间 —</div>
      </article>
    </PageLayout>
  );
}
