import { Github, Mail } from "lucide-react";
import { Link } from "wouter";
import PostList from "@/components/PostList";
import { PageLayout } from "@/components/SiteChrome";
import { posts } from "@/lib/blog";
import { restorePostListAnchorForPath } from "@/lib/postTransition";
import { useEffect } from "react";

const avatarUrl = "https://avatars.githubusercontent.com/u/55781835?v=4";

export default function Home() {
  useEffect(() => { restorePostListAnchorForPath("/"); }, []);

  return (
    <PageLayout>
      <section id="hero" className="home-intro intro-appear">
        <Link href="/about" className="portrait-wrap" aria-label="关于 zhongli">
          <img
            src={avatarUrl}
            alt="钟笠 / zhongli"
            onError={(event) => { event.currentTarget.src = "/avatar.svg"; }}
          />
        </Link>
        <div className="intro-copy">
          <h1>Hi, I'm <em>@zhongli</em>.</h1>
          <p>写软件，也记录软件之外的事。这里主要是技术、工具、工作方式，以及一些值得慢下来想清楚的问题。</p>
          <div className="intro-links" aria-label="个人链接">
            <a href="https://github.com/youzhou-ali" target="_blank" rel="noreferrer" aria-label="GitHub"><Github size={20} /></a>
            <a href="mailto:upczhongli@163.com" aria-label="发送邮件"><Mail size={20} /></a>
          </div>
        </div>
      </section>

      <div className="section-divider" />

      <section className="home-posts">
        <PostList posts={posts} />
        <div className="all-posts-wrap"><Link href="/posts" className="all-posts-link">All Posts →</Link></div>
      </section>
    </PageLayout>
  );
}
