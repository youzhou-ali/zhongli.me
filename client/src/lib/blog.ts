/** 设计提醒：数字打字机日记——内容具体、节制、以清晰阅读节奏为第一优先。 */
export type Post = {
  slug: string;
  title: string;
  date: string;
  readingTime: string;
  summary: string;
  category: string;
  visual?: string;
  body: string[];
};

export const posts: Post[] = [
  {
    slug: "making-small-tools-feel-alive",
    title: "让小工具重新有生命力",
    date: "2026.08.11",
    readingTime: "6 分钟",
    category: "构建",
    visual: "/manus-storage/fieldnote-debugging_af9af70a.png",
    summary: "把软件做得更小，不是删掉功能，而是让每一个动作都更接近人的意图。",
    body: [
      "我最近重新审视自己每天打开的软件。真正被留下来的，不是功能最多的，而是那些能在十秒内让我完成一件小事的工具。",
      "小工具不需要假装成平台。它需要有一个明确的入口、一个可靠的结果，以及一种让人愿意再次回来的节奏。",
      "如果一个功能无法用一句话说明它为谁省下了什么，就先不要把它放进来。克制不是缺少野心，而是在为下一次使用留下空间。",
    ],
  },
  {
    slug: "notes-before-the-solution",
    title: "答案出现之前，先把问题写下来",
    date: "2026.07.28",
    readingTime: "4 分钟",
    category: "笔记",
    visual: "/manus-storage/fieldnote-notes_11c7de25.png",
    summary: "写作不是交付答案的最后一步；它常常是把问题缩小到可以开始的第一步。",
    body: [
      "面对一个复杂问题，我会先写一页非常糟糕的笔记。它不必优雅，也不必完整；它只要诚实地记录我还不知道什么。",
      "把模糊的不安换成一行行具体的疑问后，问题通常已经失去了一半威慑力。接下来不是寻找灵感，而是逐项验证。",
      "这是我保留纸笔的理由：它们不会替我自动补全，也不会在我还没想清楚前给出一个看似漂亮的答案。",
    ],
  },
  {
    slug: "a-slower-way-to-ship",
    title: "更慢一点地交付",
    date: "2026.07.02",
    readingTime: "5 分钟",
    category: "工作方式",
    summary: "发布速度并不只由敲键盘的速度决定；减少返工，往往才是更快的路径。",
    body: [
      "我开始在动手前多留半小时，写下这次改动不应该破坏的三件事。这个小小的仪式让后续的实现更安静。",
      "更慢地开始并不等于更慢地完成。它只是把焦虑从代码里拿走，放回到它应该被处理的地方。",
    ],
  },
  {
    slug: "the-comfort-of-boring-interfaces",
    title: "无聊界面的可靠感",
    date: "2026.06.18",
    readingTime: "7 分钟",
    category: "界面",
    summary: "最好的界面有时像一条熟悉的回家路：不要求你欣赏它，但永远能把你带到目的地。",
    body: [
      "当界面尝试同时表达品牌、野心、个性和所有功能时，人的注意力总会先被借走。可靠的界面选择先完成一件事。",
      "所谓无聊，不是缺乏判断，而是每一个判断都服务于重复使用后的确定感。",
    ],
  },
  {
    slug: "working-with-an-empty-calendar",
    title: "给日历留一点空白",
    date: "2026.05.29",
    readingTime: "3 分钟",
    category: "节奏",
    summary: "不被安排的半天，是我把零散观察重新连成线的地方。",
    body: [
      "日历空白时，最先出现的通常是焦虑。但过一会儿，那些长久被延后的阅读、修补和整理，会自己浮上来。",
      "空白并非什么都不做，而是不提前决定应该做什么。",
    ],
  },
  {
    slug: "the-last-ten-percent",
    title: "最后百分之十的价值",
    date: "2026.05.12",
    readingTime: "5 分钟",
    category: "构建",
    summary: "命名、空状态、错误提示和退出路径，决定了一个东西是否真的能被人使用。",
    body: [
      "最后百分之十常被看成装饰，因为它看上去不再增加新功能。但它让前面九成的努力有机会抵达真实的人。",
      "我现在会把它当成产品最诚实的部分：系统在这里承认不确定，也在这里给人选择。",
    ],
  },
];

export const socialLinks = [
  { label: "GitHub", href: "https://github.com" },
  { label: "X", href: "https://x.com" },
  { label: "即刻", href: "https://okjike.com" },
  { label: "邮件", href: "mailto:hello@fieldnote.page" },
];
