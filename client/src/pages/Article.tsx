import { ArrowLeft } from "lucide-react";
import { lazy, Suspense } from "react";
import { Link, useLocation, useRoute } from "wouter";
import ReadingProgress from "@/components/ReadingProgress";
import { PageLayout } from "@/components/SiteChrome";
import { posts } from "@/lib/blog";
import { getPostListAnchor, navigateWithPostTransition, restorePostListAnchor } from "@/lib/postTransition";

const MarkdownContent = lazy(() => import("@/components/MarkdownContent"));

export default function Article() {
  const [, params] = useRoute("/posts/:slug");
  const [, setLocation] = useLocation();
  const post = posts.find((item) => item.slug === params?.slug);

  if (!post) {
    return <PageLayout><section className="not-found-page"><p className="eyebrow">404 / LOST NOTE</p><h1>这条笔记不在这里。</h1><Link href="/posts" className="back-link"><ArrowLeft size={16} /> 回到文章索引</Link></section></PageLayout>;
  }

  const storedAnchor = getPostListAnchor();
  const listAnchor = storedAnchor?.slug === post.slug ? storedAnchor : null;
  const returnPath = listAnchor?.path || "/posts";

  return (
    <PageLayout>
      <ReadingProgress readingTime={post.readingTime} />
      <article className="article-page" id="article-reading-target">
        <Link href={returnPath} className="back-link" onClick={(event) => navigateWithPostTransition(event, returnPath, "backward", setLocation, { onAfterNavigate: () => restorePostListAnchor(listAnchor) })}><ArrowLeft size={16} /> Go back</Link>
        <p className="eyebrow">{post.category}</p>
        <h1 style={{ viewTransitionName: `post-title-${post.slug}` }}>{post.title}</h1>
        <div className="article-meta"><span>Published: {post.date}</span><span>• {post.readingTime} read</span></div>
        <p className="article-dek">{post.summary}</p>
        {post.visual && <img className="article-visual" src={post.visual} alt="文章封面" loading="lazy" decoding="async" />}
        <div className="article-body">
          <Suspense fallback={<p className="article-loading">正在加载正文…</p>}>
            <MarkdownContent content={post.content} />
          </Suspense>
        </div>
        <div className="article-end">— zhongli.me —</div>
      </article>
    </PageLayout>
  );
}
