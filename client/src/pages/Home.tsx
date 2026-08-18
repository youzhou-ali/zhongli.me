/** 设计提醒：数字打字机日记——首页以个人介绍与文章索引构成一条从身份到阅读的安静轨道。 */
import { ArrowRight, Github, Linkedin, Mail, Rss, Send } from "lucide-react";
import { Link } from "wouter";
import PostList from "@/components/PostList";
import { PageLayout } from "@/components/SiteChrome";
import { posts } from "@/lib/blog";

export default function Home() {
  return (
    <PageLayout>
      <section className="home-intro intro-appear">
        <div className="portrait-wrap"><img src="/manus-storage/fieldnote-avatar_eb41ac62.png" alt="林默的插画头像" /><span className="status-dot" title="正在记录" /></div>
        <div className="intro-copy">
          <div className="intro-title"><p className="eyebrow">FIELDNOTE / PERSONAL LOG</p><h1>你好，我是 <em>林默</em><span className="cursor">_</span></h1></div>
          <p>独立构建者，长期笔记者。<br />把复杂的技术问题、慢一点的工作方式与偶尔的灵感，写成可被回看的笔记。</p>
          <div className="intro-links"><a href="#rss" aria-label="订阅 RSS"><Rss size={18} /></a><a href="https://github.com" target="_blank" rel="noreferrer" aria-label="GitHub"><Github size={18} /></a><a href="https://linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn"><Linkedin size={18} /></a><a href="mailto:hello@fieldnote.page" aria-label="发送邮件"><Mail size={18} /></a><a href="https://t.me" target="_blank" rel="noreferrer" aria-label="Telegram"><Send size={17} /></a></div>
        </div>
      </section>
      <section className="home-posts"><div className="section-head intro-appear" style={{ animationDelay: "120ms" }}><p className="eyebrow">LATEST / 06</p><span>最近更新</span></div><PostList posts={posts} animated /><Link href="/posts" className="all-posts-link">查看全部笔记 <ArrowRight size={16} /></Link></section>
    </PageLayout>
  );
}
