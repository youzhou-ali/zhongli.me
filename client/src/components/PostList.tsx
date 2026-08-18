/** 设计提醒：数字打字机日记——文章列表应首先服务扫描与阅读，装饰只在必要处提供定位感。 */
import { ArrowUpRight, CalendarDays, Clock3 } from "lucide-react";
import { flushSync } from "react-dom";
import { Link, useLocation } from "wouter";
import type { Post } from "@/lib/blog";

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => { finished: Promise<void> };
};

export default function PostList({ posts, animated = false }: { posts: Post[]; animated?: boolean }) {
  const [, setLocation] = useLocation();

  const openPost = (event: React.MouseEvent<HTMLAnchorElement>, slug: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const targetPath = `/posts/${slug}`;
    const transitionDocument = document as ViewTransitionDocument;
    if (!transitionDocument.startViewTransition) return;

    event.preventDefault();
    document.documentElement.classList.add("is-post-transitioning");
    const transition = transitionDocument.startViewTransition(() => {
      flushSync(() => setLocation(targetPath));
    });
    transition.finished.finally(() => document.documentElement.classList.remove("is-post-transitioning"));
  };

  return (
    <div className="post-list">
      {posts.map((post, index) => (
        <article className={`post-row ${animated ? "intro-appear" : ""}`} key={post.slug} style={animated ? { animationDelay: `${180 + index * 45}ms` } : undefined}>
          <div className="post-copy">
            <div className="post-kicker"><span>{post.category}</span></div>
            <Link href={`/posts/${post.slug}`} className="post-title" onClick={(event) => openPost(event, post.slug)}>
              <span className="shared-post-title" style={{ viewTransitionName: `post-title-${post.slug}` }}>{post.title}</span><ArrowUpRight className="title-arrow" size={16} strokeWidth={1.6} />
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
