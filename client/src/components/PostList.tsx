/** 设计提醒：数字打字机日记——文章列表应首先服务扫描与阅读，装饰只在必要处提供定位感。 */
import { ArrowUpRight, CalendarDays, Clock3 } from "lucide-react";
import { Link } from "wouter";
import type { Post } from "@/lib/blog";

export default function PostList({ posts, animated = false }: { posts: Post[]; animated?: boolean }) {
  return (
    <div className="post-list">
      {posts.map((post, index) => (
        <article className={`post-row ${animated ? "intro-appear" : ""}`} key={post.slug} style={animated ? { animationDelay: `${180 + index * 45}ms` } : undefined}>
          <div className="post-copy">
            <div className="post-kicker"><span>{post.category}</span></div>
            <Link href={`/posts/${post.slug}`} className="post-title">
              {post.title}<ArrowUpRight className="title-arrow" size={16} strokeWidth={1.6} />
            </Link>
            <div className="post-meta"><span><CalendarDays size={13} /> {post.date}</span><i>·</i><span><Clock3 size={13} /> {post.readingTime}</span></div>
            <p>{post.summary}</p>
          </div>
          {post.visual && <img className="post-visual" src={post.visual} alt="与文章主题对应的技术笔记插画" />}
        </article>
      ))}
    </div>
  );
}
