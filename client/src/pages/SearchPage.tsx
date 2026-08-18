/** 设计提醒：数字打字机日记——搜索应像快速翻阅索引，直达结果而不制造额外界面层级。 */
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PageLayout } from "@/components/SiteChrome";
import PostList from "@/components/PostList";
import { posts } from "@/lib/blog";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const matchedPosts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return posts;
    return posts.filter((post) => `${post.title} ${post.summary} ${post.category}`.toLowerCase().includes(normalized));
  }, [query]);
  return (
    <PageLayout>
      <section className="search-page intro-appear">
        <p className="eyebrow">SEARCH / INDEX</p><h1>找一条笔记</h1>
        <label className="search-field"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入标题、主题或关键词" /><kbd>⌘ K</kbd></label>
        <p className="search-result-count">{query ? `找到 ${matchedPosts.length} 条相关笔记` : "全部笔记已列出"}</p>
        {matchedPosts.length ? <PostList posts={matchedPosts} /> : <div className="empty-state"><span>∅</span><p>没有找到这条线索。换一个词试试？</p></div>}
      </section>
    </PageLayout>
  );
}
