/** 设计提醒：数字打字机日记——索引页像一条连续的阅读轨道，避免卡片化信息噪声。 */
import { PageLayout } from "@/components/SiteChrome";
import PostList from "@/components/PostList";
import { getPostDateParts, posts, type Post } from "@/lib/blog";
import { restorePostListAnchorForPath } from "@/lib/postTransition";
import { useEffect } from "react";

const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

type MonthGroup = {
  month: number;
  posts: Post[];
};

type YearGroup = {
  year: number;
  posts: Post[];
  months: MonthGroup[];
};

function groupPostsByDate(allPosts: Post[]): YearGroup[] {
  const grouped = new Map<number, Map<number, Post[]>>();

  allPosts.forEach((post) => {
    const { year, month } = getPostDateParts(post.date);
    const months = grouped.get(year) ?? new Map<number, Post[]>();
    const monthPosts = months.get(month) ?? [];
    monthPosts.push(post);
    months.set(month, monthPosts);
    grouped.set(year, months);
  });

  return Array.from(grouped.entries())
    .sort(([firstYear], [secondYear]) => secondYear - firstYear)
    .map(([year, months]) => {
      const monthGroups = Array.from(months.entries())
        .sort(([firstMonth], [secondMonth]) => secondMonth - firstMonth)
        .map(([month, monthPosts]) => ({ month, posts: monthPosts }));

      return { year, posts: monthGroups.flatMap((group) => group.posts), months: monthGroups };
    });
}

export default function Posts() {
  const yearGroups = groupPostsByDate(posts);
  useEffect(() => { restorePostListAnchorForPath("/posts"); }, []);
  return (
    <PageLayout>
      <section className="archive-page intro-appear">
        <p className="eyebrow">ARCHIVE / {yearGroups.length ? `${yearGroups[yearGroups.length - 1].year}—${yearGroups[0].year}` : "EMPTY"}</p>
        <h1>All Posts</h1>
        <p className="archive-lede">按年份和月份浏览全部 {posts.length} 篇文章。</p>
        <div className="archive-groups">
          {yearGroups.map((yearGroup) => (
            <section className="archive-year" key={yearGroup.year} aria-labelledby={`archive-year-${yearGroup.year}`}>
              <h2 id={`archive-year-${yearGroup.year}`}>{yearGroup.year}<sup>{yearGroup.posts.length}</sup></h2>
              {yearGroup.months.map((monthGroup) => (
                <section className="archive-month" key={`${yearGroup.year}-${monthGroup.month}`} aria-labelledby={`archive-month-${yearGroup.year}-${monthGroup.month}`}>
                  <h3 id={`archive-month-${yearGroup.year}-${monthGroup.month}`}>{monthNames[monthGroup.month - 1]}<sup>{monthGroup.posts.length}</sup></h3>
                  <PostList posts={monthGroup.posts} />
                </section>
              ))}
            </section>
          ))}
        </div>
      </section>
    </PageLayout>
  );
}
