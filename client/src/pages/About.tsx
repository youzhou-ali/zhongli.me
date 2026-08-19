/** 设计提醒：数字打字机日记——“关于”页保留人味与空白，不把个人介绍做成履历表。 */
import { ArrowUpRight, Github, Mail, Rss } from "lucide-react";
import { PageLayout } from "@/components/SiteChrome";

export default function About() {
  return (
    <PageLayout>
      <section className="about-page intro-appear">
        <p className="eyebrow">ABOUT / 01</p>
        <div className="about-heading"><h1>写软件，也写下<br />软件之外的事。</h1><span className="status-dot" /></div>
        <div className="about-grid">
          <img className="about-portrait" src="https://github.com/youzhou-ali.png?size=320" alt="钟笠 / zhongli 的头像" />
          <div className="about-copy">
            <p>你好，我是<strong>钟笠 / zhongli</strong>，一名独立构建者与长期笔记者。我在这里记录关于工具、界面、工作节奏以及好奇心的零散观察。</p>
            <p>我相信好产品不是发出最大的声音，而是恰好在需要的时候，安静地完成一件事。</p>
            <div className="about-links">
              <a href="https://github.com/youzhou-ali" target="_blank" rel="noreferrer"><Github size={16} /> GitHub <ArrowUpRight size={13} /></a>
              <a href="mailto:upczhongli@163.com"><Mail size={16} /> 写封邮件 <ArrowUpRight size={13} /></a>
              <a href="#rss"><Rss size={16} /> 订阅 RSS <ArrowUpRight size={13} /></a>
            </div>
          </div>
        </div>
      </section>
      <section className="now-section">
        <p className="eyebrow">NOW / 2026.08</p>
        <div className="now-list"><p><span>01</span>整理一个面向个人研究的轻量笔记工具。</p><p><span>02</span>学习如何把复杂系统画得更简单。</p><p><span>03</span>在海边慢跑，并重新读纸质书。</p></div>
      </section>
    </PageLayout>
  );
}
