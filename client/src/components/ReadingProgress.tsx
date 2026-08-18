/** 设计提醒：数字打字机日记——阅读辅助应始终轻量，既可感知又不抢走正文注意力。 */
import { useEffect, useState } from "react";

export default function ReadingProgress({ readingTime }: { readingTime: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const updateProgress = () => {
      const article = document.getElementById("article-reading-target");
      if (!article) return;
      const start = article.getBoundingClientRect().top + window.scrollY;
      const articleEnd = start + article.offsetHeight;
      const viewportBottom = window.scrollY + window.innerHeight;

      // 文章末尾进入视口即代表读者已抵达全文结尾，避免页脚高度影响 100% 状态。
      if (viewportBottom >= articleEnd - 6) {
        setProgress(100);
        return;
      }

      const readableDistance = Math.max(1, article.offsetHeight - window.innerHeight);
      const distanceRead = Math.min(readableDistance, Math.max(0, window.scrollY - start));
      setProgress(Math.round((distanceRead / readableDistance) * 100));
    };

    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    return () => {
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, []);

  return (
    <div className="reading-progress" aria-label={`文章阅读进度 ${progress}%`}>
      <div className="reading-progress-track"><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
      <div className="reading-progress-copy"><span>{progress === 100 ? "已读完" : `已读 ${progress}%`}</span><span>预计 {readingTime}</span></div>
    </div>
  );
}
