/** 设计提醒：数字打字机日记——阅读辅助应始终轻量，既可感知又不抢走正文注意力。 */
import { useEffect, useState } from "react";

export default function ReadingProgress({ readingTime }: { readingTime: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const updateProgress = () => {
      const article = document.getElementById("article-reading-target");
      if (!article) return;
      const start = article.getBoundingClientRect().top + window.scrollY;
      const end = Math.max(start + 1, start + article.offsetHeight - window.innerHeight * 0.2);
      const nextProgress = Math.round(Math.min(100, Math.max(0, ((window.scrollY - start) / (end - start)) * 100)));
      setProgress(nextProgress);
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
