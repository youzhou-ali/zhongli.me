import { Link, useLocation } from "wouter";
import type { Post } from "@/lib/blog";
import { navigateWithPostTransition, rememberPostListAnchor } from "@/lib/postTransition";

export default function PostList({ posts, animated = false }: { posts: Post[]; animated?: boolean }) {
  const [, setLocation] = useLocation();

  return (
    <ul className="post-list">
      {posts.map((post, index) => (
        <li className={`post-row ${animated ? "intro-appear" : ""}`} key={post.slug} style={animated ? { animationDelay: `${80 + index * 35}ms` } : undefined}>
          <Link
            href={`/posts/${post.slug}`}
            className="post-title"
            onClick={(event) => navigateWithPostTransition(event, `/posts/${post.slug}`, "forward", setLocation, { onBeforeNavigate: () => rememberPostListAnchor(post.slug) })}
          >
            <h3 id={`post-title-anchor-${post.slug}`} style={{ viewTransitionName: `post-title-${post.slug}` }}>{post.title}</h3>
          </Link>
          <div className="post-meta"><span>Published: {post.date}</span><span>• {post.readingTime} read</span></div>
          <p>{post.summary}</p>
        </li>
      ))}
    </ul>
  );
}
