# 参考源码分析记录

参考仓库：https://github.com/steipete/steipete.me

该公开仓库使用 Astro，并将文章内容放在 `src/content/blog`。组件目录中包含 `Card.astro`、`Breadcrumb.astro` 和 `ThemeToggle.astro` 等与文章索引、页面导航和过渡相关的组件；站点自身还记录了对 View Transitions API 的使用。

本项目继续保留 React 静态站点架构，但会借鉴其“内容与组件分层”的组织方式：将可编辑 Markdown 显式置于项目根级 `content/posts`，避免嵌套在编译源目录后难以从文件树发现。标题过渡将采用浏览器的原生 View Transition API，并以 CSS 定义从文章列表标题位置到详情标题位置的水平移动和淡入效果。

进一步查看 `Card.astro` 后确认，参考站点在列表标题上使用文章标题 slug 作为 `viewTransitionName`；详情布局中的同名标题即可被浏览器识别为共享元素并在跨页面导航时平移。其文章内容放在 `src/content/blog`，但本项目会将相同的 Markdown 内容集合提升到项目根级 `content/posts`，以便在管理界面的文件树中直接发现和维护。
