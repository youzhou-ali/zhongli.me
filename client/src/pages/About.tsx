import { ArrowUpRight, Github, Mail } from "lucide-react";
import { PageLayout } from "@/components/SiteChrome";

const avatarUrl = "https://avatars.githubusercontent.com/u/55781835?v=4";

export default function About() {
  return (
    <PageLayout>
      <section className="about-page intro-appear">
        <p className="eyebrow">ABOUT</p>
        <div className="about-heading"><h1>写软件，也写下软件之外的事。</h1></div>
        <div className="about-grid">
          <img
            className="about-portrait"
            src={avatarUrl}
            alt="钟笠 / zhongli"
            onError={(event) => { event.currentTarget.src = "/avatar.svg"; }}
          />
          <div className="about-copy">
            <p>你好，我是<strong>钟笠 / zhongli</strong>。这里记录技术、工具、工作方式，以及一些值得反复想一想的问题。</p>
            <p>我偏爱简单、可解释、能长期维护的东西，也希望这个站点本身保持同样的气质。</p>
            <div className="about-links">
              <a href="https://github.com/youzhou-ali" target="_blank" rel="noreferrer"><Github size={16} /> GitHub <ArrowUpRight size={13} /></a>
              <a href="mailto:upczhongli@163.com"><Mail size={16} /> Email <ArrowUpRight size={13} /></a>
            </div>
          </div>
        </div>
      </section>
      <section className="now-section">
        <p className="eyebrow">NOW / 2026.08</p>
        <div className="now-list"><p><span>01</span>持续整理个人博客与写作工作流。</p><p><span>02</span>关注 AI、软件工程和个人工具。</p><p><span>03</span>把复杂系统尽量解释得更简单。</p></div>
      </section>
    </PageLayout>
  );
}
