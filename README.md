# Vulgar Notes

编辑器使用 TypeScript（`strict: true`）、Plate / React 和 MathJax 4。桌面版使用 Tauri 2，公式编辑模块与正文引擎保持独立。

[打开网页版](https://zhaiyusci.github.io/vulgar-notes/)

[下载 Windows 桌面版](https://github.com/zhaiyusci/vulgar-notes/releases/latest)（免安装版 / 安装版）

## 关于名称的郑重声明

本项目郑重声明：**Vulgar Notes** 中的 **vulgar**，明确取现代英语中“低俗、粗俗、不雅”的含义。这个名字是有意这样取的。

本名称与旧历书中的同名术语无关，也不取“通用”“常用”等古义。请勿为本项目附会高雅寓意，或将其解释为对旧历书的致敬。**此处的 vulgar，就是低俗。**

取名时，一批 Markdown 编辑器已经把文雅的名字占了个遍。我们厌倦的，正是其中那种给源码套个壳、给预览换张皮，就端出一副重新发明写作的架势的产品：格式标记照打，误触照旧，公式照样在源码与预览之间来回折腾，低频格式操作照样打断思路。**该解决的写作问题没解决，抢好名字倒是比谁都快。**

**我们受够了这种 Markdown mania。** 换一套界面、加一个 `/` 菜单，再让用户背几组标记，不会自动让写作变好。文雅的名字让它们占着吧；本项目选择低俗，并把“别打断用户的思路”当作正事。

The word **vulgar** in **Vulgar Notes** deliberately means **crude, coarse, or in bad taste**, in the modern sense. This is the intended meaning of the name.

The name is unrelated to the historical almanac term "vulgar notes" and does not invoke archaic meanings such as "common" or "ordinary." Do not reinterpret it as a learned historical allusion or an expression of refined taste. **Here, vulgar means vulgar.**

When we went looking for a decent name, a crowd of Markdown editors had already helped themselves to the elegant ones. Our irritation is aimed squarely at the kind that wraps source text in another shell, reskins the preview, and acts as though it has reinvented writing. The same markup, accidental formatting, split source-and-preview math editing, and interruptions remain. **The writing problems stay unsolved; the good names get snapped up.**

**We are tired of this Markdown mania.** Another coat of paint, another slash menu, and another set of formatting incantations do not make writing better. They can keep the elegant names. We chose vulgarity, and we intend to spend our effort making prose and mathematics easier to write without interrupting thought.

## 交互原则：低频格式调整不要干扰思路

编辑器应保护写作与数学推导中思路的连续性。评价一种交互方式，要看它是否帮助用户顺畅表达正在思考的内容，以及它是否给正常输入增加了误触、记忆和纠错的负担。键盘、鼠标和菜单都只是手段，不预先规定哪一种优先。

公式输入是数学写作的核心过程，所以我们持续改进原位编辑、连续序列、光标移动和 LaTeX 命令输入，让表达尽量跟上思考。标题、列表等低频格式调整则适合在需要时显式调用，不应通过正文中的 `/` 菜单或 Markdown 自动转换随时介入输入。这正是优化公式输入、同时移除 `/` 快捷菜单的共同理由：减少对思路的打断。不要为了追随“Markdown mania”而增加并无实际收益的快捷语法。

- **正文输入保持可预测。** 不提供正文的 `/` 命令菜单，不把 `# `、`- `、`1. `、`> `、`**文字**`、反引号或美元定界符自动转换为文档结构或格式。
- **不擅自替换用户输入的符号。** 关闭箭头、分数、比较符号、智能引号等自动字符替换；例如 `->` 和 `1/2` 保留原样。
- **功能通过明确的操作调用。** 标题、列表、文本格式、公式等通过工具栏插入或设置；结构变体和行列操作通过右键菜单提供。这些入口在用户需要时提供操作，不拦截正常书写；点击定位、选中反馈、光标和撤销都应清晰可靠。
- **快捷键是辅助，不是必修课。** 保留保存、撤销、复制粘贴等常规快捷键以及已有的显式格式操作。新增快捷方式应根据任务频率、表达效率和对思路的干扰来取舍，不能仅因上游插件提供了它就默认开启。
- **数学区域有自己的输入语义。** 进入公式后，LaTeX 命令候选、上下标输入和结构编辑仍然可用。正文的 TeX 标签、交叉引用和文献引用入口也保留；这不意味着把正文变成 Markdown 源码编辑器。
- **交换格式与编辑交互分开。** Markdown 是导出格式，不是必须模仿的交互模型。原生 `.vulgar` 文档以 JSON 保存完整的可编辑结构，LaTeX 用于排版导出。

选择 Plate 的开源 Editor Kit 是为了复用成熟的富文本基础设施，不是为了开启它提供的每一项功能。后续引入或更新插件时，应检查是否重新带入了斜杠菜单、Markdown 输入规则或自动字符替换。

## 网页版与 GitHub Pages

网页版部署在 <https://zhaiyusci.github.io/vulgar-notes/>。它是静态网站，不需要运行 Node.js 服务，也没有文档上传或同步后端。浏览器通过文件选择打开 `.vulgar` 和 `.bib`，保存和导出以文件下载实现。各标签页的草稿使用独立的 sessionStorage；需要长期保留的内容请保存为 `.vulgar` 文件。

- `npm run web:build`：检查类型、构建编辑器并生成可直接托管的 `web-dist/`。
- `npm run web:prepare`：使用已构建的编辑器资源生成 `web-dist/`。
- `.github/workflows/pages.yml`：推送到 `master` 后，安装依赖、构建并运行测试，再发布到 GitHub Pages；也可手动触发。

发布目录中的脚本、样式、MathJax、New Computer Modern、BBoldX 和 mhchem 字体均使用相对路径，适用于 GitHub Pages 的仓库子目录。只发布生成的 `web-dist/`，不发布本地诊断文件、草稿或桌面构建产物。用户插入的网络媒体、PlantUML 图预览等功能仍会访问相应的第三方服务；静态托管不包含 AI 后端或多人协作服务。

## Tauri 桌面应用

Windows x64 的公开版本发布在 [GitHub Releases](https://github.com/zhaiyusci/vulgar-notes/releases/latest)，同时提供免安装程序、NSIS 安装包和 SHA-256 校验文件。网页版也可从右上角齿轮打开“首选项”，选择“下载 Windows 版”。免安装版需要系统已有 WebView2；安装版会在缺少运行时时下载并安装它。当前程序尚未进行代码签名。

- `npm run desktop:dev`：构建本地资源并启动桌面开发窗口；不占用网页预览的 8767 端口。
- `npm run desktop:build`：生成 Windows 程序和 NSIS 安装包。
- `npm run desktop:portable`：生成 `portable/Vulgar Notes-<version>.exe`，无需安装，直接运行；测试优先使用此版本。
- 程序：`src-tauri/target/release/math-document-editor.exe`。
- 安装包：`src-tauri/target/release/bundle/nsis/`。

Windows 构建需要 Rust stable MSVC、Visual Studio C++ 工具和 WebView2。安装依赖仍使用 `npm ci --legacy-peer-deps`。其他平台的系统依赖参考 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。当前打包目标为 Windows NSIS，尚未验证 macOS/Linux。

桌面版嵌入 `desktop-dist` 中的静态资源，不需要 Node.js 服务。MathJax 4.1.3、New Computer Modern、BBoldX 和 mhchem 字体随程序打包；正文和数学编辑无需联网，用户引用的网络媒体仍需要网络。原网页预览继续保留 CDN 配置。

桌面主窗口草稿保存在 WebView 的持久 localStorage，关闭后重新启动会恢复。网页版仍使用各标签页独立的 sessionStorage；浏览器现有草稿不会自动转移到桌面版，可先保存为 `.vulgar` 文档，再在桌面版打开。工具栏提供新建、打开、保存、另存为；桌面版保存会写回本次会话中打开的文件，首次保存或另存为才显示系统文件窗口。浏览器版保存以下载 `.vulgar` 文件实现。重启后主窗口草稿会恢复，但仍需重新打开文档以恢复该文件的保存目标。文件权限通过 Tauri 的 persisted-scope 插件保存，只恢复用户已选择文件的授权。卸载或清理应用数据前应保存重要文档。

“新建文档”（Ctrl/⌘+N）在桌面版打开独立窗口，在网页版打开独立标签页，从空白正文开始。原窗口的内容、撤销历史和保存路径保持不变。每份新文档的草稿、恢复副本和文件会话信息按独立标识隔离；重载同一个窗口或标签页会恢复它自己的草稿。配色、界面语言和完整文献库仍由本设备共享。当前不提供关闭后的文档窗口恢复列表，新建文档需保存为 `.vulgar` 文件以便再次打开。

Tauri 配置关闭原生文件拖放拦截，让编辑器继续处理段落排序。`src/platform.ts` 集中管理桌面存储和文件导出差异，公式模型不依赖 Tauri。

### 文献库与参考文献表

文献库中的“刷新”重新读取原来的 `.bib` 文件，保留文献库身份、已有引用键和当前搜索。取消选择、选择其他文件或解析失败时保留原内容。桌面版在本机记录原路径；支持 File System Access 的浏览器在本机保存文件句柄，刷新时读取新内容。浏览器不支持该接口、授权失效或旧文档没有关联源文件时，需要重新选择原来的同名 `.bib`。路径和句柄不会写入 `.vulgar` 文档，文档仍只携带已引用条目及其依赖。

“参考文献表格式”提供简洁、IEEE、Vancouver（NLM）、APA 第 7 版、Chicago 第 18 版及 GB/T 7714—2025，并显示实际格式预览。选项保存在当前文档中，正文引用和尾注继续按首次出现顺序统一编号。切换的是参考文献表条目格式，不是完整的作者—年份引用系统。正文末尾、悬浮预览、Markdown 和 LaTeX 导出使用同一格式；尾注中的富文本与公式保留。所选 CSL 格式的 LaTeX 导出使用预排版的 `thebibliography`，无需 Biber；简洁格式保留原来的 BibLaTeX 导出。

格式处理使用 citeproc-js 和固定版本的官方 CSL 样式与语言资源，均在本地打包，排版时不访问外部服务。来源、版本、许可证和处理器源码见 `licenses/citeproc/`、`licenses/csl/`；格式输出旁保留所需署名。

界面语言与配色方案在右上角齿轮打开的“首选项”中设置。保留浅色、纸张、青灰和深色，并提供 Catppuccin Latte / Frappé / Macchiato / Mocha、Nord、Tokyo Night、Dracula、Solarized Light / Dark，共 13 套配色，按系列分组。选择时即时预览，保存后在本设备保留；取消或 Esc 恢复原配色。配色同时应用于正文、公式和工具界面，不改变文档内容、数学字体或导出结果。只有切换语言需要重新加载，当前草稿会保留。原生文档扩展名为 `.vulgar`，内部仍使用 JSON；导出菜单仅提供 Markdown 和 LaTeX。

社区配色依据官方色板映射到本编辑器的界面角色；Catppuccin 使用 Mauve 强调色。部分原始配色中的弱对比文字色不适合作为小字号界面文字，因此改用同一色板中更易读的颜色；Solarized 的部分文字与链接色额外调整了对比度，保留原始背景色。来源及完整许可证随发布包保存在 `licenses/`：

- [Catppuccin 色板](https://catppuccin.com/palette/)与[样式指南](https://github.com/catppuccin/catppuccin/blob/main/docs/style-guide.md)。
- [Nord](https://github.com/nordtheme/nord)、[Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme)、[Dracula](https://draculatheme.com/spec)、[Solarized](https://ethanschoonover.com/solarized/)。

### 外观待办

- 用户自定义 CSS：计划在首选项中提供编辑、预览、启停和恢复默认入口。先明确正文样式与编辑器界面的作用范围，以及打印和导出时的处理方式；自定义样式不应改变公式数据或破坏原位编辑的定位。

MathJax 和编辑器会动态创建样式，因此 `dangerousDisableAssetCspModification` 仅设为 `["style-src"]`，保留已配置的 `style-src 'self' 'unsafe-inline'`。如果 Tauri 再向该指令注入 nonce/hash，浏览器会忽略 `unsafe-inline`，导致动态公式样式和行内布局失效。脚本的 nonce/hash 注入和其他 CSP 限制仍然保留。验证桌面排版时应检查打包后的策略，而不能只测试未经过 Tauri 处理的静态页面。

## 开发

首次安装依赖：`npm ci --legacy-peer-deps`。

- `npm run typecheck`：严格类型检查，不生成文件。
- `npm run build`：先检查类型，再编译浏览器脚本和 source map。
- `npm test`：构建后运行模型回归测试，测试实际生成的代码。
- `npm run dev`：构建并在 <http://127.0.0.1:8767/> 启动预览。

修改源文件后运行 `npm run build`，再刷新页面；服务器无需重启。启动前确保端口没有被另一个预览进程占用。MathJax 仍由 CDN 加载，首次打开需要网络连接。

## 源码

- `src/editor-model.ts`：公式树、区域、光标、选择、命令、结构变体及撤销；保存草稿的 JSON 在恢复时做运行时校验。
- `src/extensions.ts`：Unicode-math 字体、physics 常用结构和 mhchem 化学源码区域。
- `src/editor-ui.ts`：原位编辑、隐藏输入控件、命令候选、右键菜单、点击定位及渲染调度。
- `src/document-host.ts`：公式与正文之间的框架无关接口。
- `src/plate-host.tsx`：Plate 节点、React 容器、历史与公式模型之间的适配。
- `src/components/editor/editor-kit.tsx`、`src/components/ui/`：官方开源 Editor Kit 和配套 Plate UI / shadcn 组件。
- `src/plate-document.ts`：新文档存储、校验和旧稿迁移。
- `src/tex-import.ts`：保守的常用 TeX 结构导入；无法识别的源码保留原文。
- `src/dom.ts`：DOM 边界检查。
- `src/mathjax-config.ts`、`src/mathjax.d.ts`：MathJax 启动配置及使用到的 API 类型。
- `mathjax4_editor_prototype_document_typeset.html`：页面结构和 CSS。
- `editor-model.test.cjs`：模型回归测试。

根目录的 `editor-model.js`、`editor-ui.js`、`mathjax-config.js` 和对应 `.map` 都是构建产物，请勿手动修改。浏览器执行的是这些 JavaScript 文件；TypeScript 类型不进入运行时。构建脚本、测试入口和静态服务器保留 Node.js 的 `.cjs` 格式。

公式模型保留原有 JSON 格式；正文草稿会迁移到 Plate 的文档结构，旧草稿原样保留作为备份。TypeScript 帮助提前发现类型错误，但不能替代运行时校验和交互测试。

## 正文、行内与行间公式

正文采用 **Plate 53 / React 19**，直接使用官方开源 Editor Kit 的插件和配套界面：固定与浮动工具栏、六级标题、文本格式、列表、链接、表格、拖拽、引用、代码、媒体、分栏、折叠、目录、脚注和批注等；建议模式入口已隐藏，正文不区分编辑与阅读模式。Excalidraw 使用官方组件。依赖版本由 package-lock.json 固定。没有使用付费 Pro 模板。

公式模块继续使用原有 EditorModel 和 MathJax，不依赖 React、Slate 或 Plate。document-host.ts 定义进入/退出公式、快照同步、文档导出等边界；plate-host.tsx 是唯一负责正文引擎适配的模块。React 管公式外层 void 节点及 Slate 的空文本子节点，MathJax 只更新其中独立的 DOM 容器。官方 Equation / InlineEquation 节点的渲染被我们的原位编辑器接管，工具栏插入的公式走此适配层。

- Ctrl/⌘+Enter 插入行内公式；Ctrl/⌘+Shift+Enter 插入行间公式。
- 正文换行、列表、选区和历史使用 Plate；公式内继续保留自己的序列、区域和撤销历史。
- 行间公式独占一行，但不自动开始新段落。空的正文插入点显示在行间公式的左右边界，而非单独的空白行；相邻公式之间不因光标定位节点额外撑出一行；用户实际输入的文字、换行和段落保持原有含义。
- 公式快照与 LaTeX 同步到文档节点，文档撤销同步恢复数学模型。光标移动不创建内容历史。
- 复制公式保留结构树，并生成独立 ID。
- 公式、交叉引用和文献引用采用两步删除：先选中并高亮，再按删除键删除；长按不会跳过选中步骤。
- 行内/行间切换保留公式和周围正文；行间公式右键切换编号，未编号公式不占计数。MathJax 根据文档顺序重新编号。

草稿保存在 sessionStorage 的 math-plate-document-v1。首次打开迁移 math-tiptap-document-v1 或更早的 math-text-flow-state，旧键保持不变；损坏数据另存 recovery 键。公式 snapshot 格式不变。浏览器草稿不是永久存储，工具栏的打开/保存保留完整可编辑文档和公式快照。

Markdown 使用官方 @platejs/markdown。行内使用美元定界符，行间使用双美元定界符；编号公式在 opening fence 上保留 numbered 元数据，不编号公式不加该标记（自动编号不是标准 Markdown 特性）。LaTeX 导出仍使用 equation / equation*。普通分式、根式、函数、上下标等导入可转为可编辑树；任意 TeX 宏、环境不保证可解析，不能识别的公式保留源码并显示提示，不会伪造或损坏结构。JSON 是无损往返格式。

打开仅接受本工具的 `.vulgar` 文档及旧版 `.json` 文档，内容仍按原有 JSON 结构校验。先校验再替换当前正文，打开前保留一份恢复草稿，并清空旧文档的撤销历史。新文档默认保存为 `document.vulgar`；打开旧 `.json` 后直接保存仍写回原文件，另存为会建议使用 `.vulgar`，浏览器下载也使用新扩展名。Ctrl/⌘+O 打开，Ctrl/⌘+S 保存，Ctrl/⌘+Shift+S 另存为。导出仅提供 Markdown（.md）和 LaTeX（.tex 完整文档）。TeX 文件使用 LuaLaTeX 或 XeLaTeX 编译，自带 ctexart、Fandol 中文字体、New Computer Modern 数学字体、unicode-math 与 BBoldX 原生配置，以及 mathtools、extarrows、cancel、physics、mhchem 宏包。MathJax 专用的 `\pu` 在导出时通过官方 mhchemparser 展开为 TeX，不改变保存的公式结构。无需手工补充导言区；所需宏包和字体包含在完整 TeX Live 中。

服务边界：AI 后端未配置，所以没有启用 AI 菜单；附件使用本地 data URL（单文件限 2 MB）或用户提供的 URL，没有模拟上传，也没有接入 UploadThing。批注/建议是本地交互，不是多人实时协作服务。字体与部分绘图资源首次加载仍需要网络。

源码来源与许可证记录见 plate-vendor.json、licenses/。本地接入调整包含路径别名、MathJax 节点、无服务依赖的附件实现和公式元数据序列化。scripts/vendor-plate.mjs 用于追踪上游源码，**不要在日常构建时运行**，它会覆盖本地组件调整。

测试：text-flow.test.cjs 验证旧稿迁移、恢复与 TeX 导入；plate-host.test.cjs 在 Happy DOM 中使用真实 Plate 和公式适配层验证历史、复制、DOM 隔离、排版和 Markdown 元数据；完整 Kit 界面另用浏览器检查。公式模型及字形的原有测试保留。

官方文档：[Editor Kit](https://platejs.org/docs/feature-kits)、[Plate UI](https://platejs.org/docs/installation/plate-ui)、[Equation](https://platejs.org/docs/equation)。

当前字母样式按字符选择。确认 `\mathfrak` 等命令只修饰下一个字符，不创建字体区域；`\textnormal` 保留多字符描述入口。黑板体统一采用 BBoldX，导出配置使用 `\usepackage[bbsymbols]{bboldx}`，拉丁字母使用 `\mathbb`，希腊字母使用 `\bbalpha` 等原生命令。下方字体审计记录包含早期原型的对照结果。

## 字体、物理与化学

字体默认使用 `\sym…` 命令；例如输入 `\mathbf` 后确认，插入并导出 `\symbf`。`\mathrm` → `\symup`、`\mathbb` → `\symbb`，旧字体节点仍能恢复，内容不变。`\boldsymbol` 仍保留为符号加粗工具。

MathJax 固定为 **4.1.3**。`src/mathjax-unicode-fonts.ts` 在 `startup.ready` 中安装维护者提供的 [#3536 临时修复](https://github.com/mathjax/MathJax/issues/3536#issuecomment-4106084339)，并用独立的窄接口类型约束内部 API。默认仍为 `mathStyle: 'TeX'`，启用 `mathStyleGreekLC` 和 `mathStyleMathAlphabets`，使字体命令支持希腊字母。字体文件和页面字号保持原样。

相对维护者示例，本地补充了希腊变体字符的识别，以及 AMS `varkappa`、基础 `partial`/`nabla` 符号映射的同一字体处理。补丁仅涉及排版，模型和导出仍保留 `\sym…`，不把命令偷偷改成 `\boldsymbol`。维护者指出部分字体回退与 LaTeX 不完全一致，因此这里不宣称完整实现 unicode-math。

升级 MathJax 前须重新验证内部接口，并确认上游修复状态后移除临时补丁。运行 `node diagnostics/serve.cjs`，访问 `http://127.0.0.1:8768/?full` 和 `http://127.0.0.1:8768/?full&style=ISO` 可复跑真实浏览器字形断言，覆盖命令/Unicode 一致性、编辑器定位标记、正斜粗体、嵌套及希腊变体。`diagnostics/upstream-3536.txt` 保存原始修复说明；`greek-fonts-results.json` 为修复前记录。

附加 `&fonts` 可检查输入板全部 21 种 `sym` 字体：每种比较 44 个希腊字母、变体及 ∂/∇ 的命令输入、Unicode 输入、编辑定位标记，并检查嵌套 `symup` 后恢复外层字体。TeX/ISO 共 126 项一致性和作用域断言已通过，记录见 `diagnostics/all-fonts-greek-results.json`。这不代表所有字母都有专用字体字形：当前 NewCM 的 sans 正/斜/粗/粗斜可用；黑板体 Γ、Π、Σ、γ、π 使用专用字形，其他希腊字母回退；花体、手写体、哥特体通常回退到普通或加粗希腊字形，等宽字体对大小写也不完全一致。这里遵循维护者方案的字体回退，并未声称与 LaTeX unicode-math 完全相同。

本机 TeX Live 2026 对照：`diagnostics/tex-font-audit` 用 LuaHBTeX 1.24.0、unicode-math 0.8r、NewCMMath-Regular.otf 编译同一组 21×44 字符，覆盖 TeX/ISO 与命令/Unicode 两种输入。运行该目录的 `node generate.cjs`、`lualatex -interaction=nonstopmode -halt-on-error main.tex`、`node compare.cjs` 可复现；`main.pdf` 为实排样张，`glyphs.tsv` 为 LuaTeX 字形节点记录，`comparison.json` 比较字符码位（相同码位不保证 MathJax 子字体字形相同）。每次切换 math-style 后重新设置数学字体，确保 unicode-math 的映射更新。

实测差异：TeX 风格的 `symbfsf` 小写希腊为粗正体，当前 MathJax 为粗斜体；普通 sans 在 unicode-math 中保留默认希腊字形，MathJax 使用额外的 sans 字形；`symbb` 在 TeX 中仅 Γ/Π/γ/π 使用黑板体，其他希腊保留默认，MathJax 还将 Σ 映射为黑板体并加粗其余字符；普通花体/手写体在 TeX 风格下保留大写希腊正体，MathJax 改为斜体；粗花体/手写体/哥特体在 TeX 中不加粗希腊，MathJax 会加粗。ISO 下的 nabla 正斜体也有差异。这轮仅记录结果，尚未改为严格匹配 unicode-math。

12 套字体实测见 `diagnostics/font-coverage/font-comparison.pdf`、`results.json` 和 `font-internals.json`：每套字体独立启动 LuaLaTeX，ISO 风格，17 种命令 × 44 个希腊字母/符号，并检查 OpenType cmap 与 alpha 的替代字形。NewCM Regular/Sans、STIX Two、XITS、Asana、IBM Plex 的五个标准希腊数学区段均为 58/58，五个特殊黑板字符均存在，本轮实排无缺字；这不意味着存在完整的黑板/花体希腊字母。Libertinus 的粗 sans 两区段各缺 6 字符，Fira/GFS 没有对应粗 sans 区段，部分字体也缺特殊黑板字符。

KpMath 确实提供普通 sans 希腊扩展（如 alpha 的 U+E761/U+E7B1），需通过 `kpfonts-otf` 的 `\msansalpha` / `\mitsansalpha` 等命令访问；默认 `\symsfup` 不自动选取这些字形。补充实排见合集末页及 `kp-extra.tex`。NewCM Sans 是全局 sans 设计，且会交换部分 serif/sans 槽位（见字体自带说明），不能视为直接替换即可保证所有样式按钮语义一致。以上只做本机覆盖测试，未切换编辑器字体。

physics 与 mhchem 显式加载。物理输入板提供导数、偏导数、泛函导数、向量、梯度/散度/旋度、bra-ket、对易子、期望值等常用结构，各参数可原位编辑。`\dv`、`\pdv`、`\fdv` 右键可切换斜分式；`\mqty` 等矩阵输入别名进入现有动态矩阵模型。这里没有承诺完整解析 physics 的全部可选参数。由于 physics 将 `\div` 用作散度，原有除号节点输出 `\divisionsymbol`，保持 ÷ 的含义。

输入 `\ce` 或 `\pu` 后确认，进入化学式或单位源码区域，直接输入 `2 H2 + O2 -> 2 H2O` 或 `1.2e3 kg m/s^2`，无需再加外层花括号。编辑时原位显示源码，Enter、移出区域或点击其他位置后显示 mhchem 排版结果；再次点击可编辑源码。此区域内的数字、电荷、空格、`^`、`_` 和反斜杠按原始语法保留，不触发普通数学编辑快捷键。未完成或有误的语法显示为可编辑源码，不阻断其他公式。

参考：[MathJax physics](https://docs.mathjax.org/en/v4.0/input/tex/extensions/physics.html)、[mhchem](https://docs.mathjax.org/en/v4.0/input/tex/extensions/mhchem.html)、[支持的命令](https://docs.mathjax.org/en/v4.0/input/tex/macros/index.html)。

## Plate 接入记录

- 官方 registry 抓取于 2026-10-25，来源列表见 `plate-vendor.json`；MIT 许可证见 `licenses/`。
- 浏览器入口使用 ES modules 和按需分包（`dist/`）；数学模型的独立测试仍使用根目录生成的 `editor-model.js`。
- Excalidraw 的场景更新延迟到 Slate 渲染之后，只存持久场景数据，避免上游示例把整个临时 UI 状态写回导致节点路径失效。
- 依赖覆盖用于统一 Jotai 和修复 DOMPurify、lodash-es、nanoid、js-yaml 已知告警。当前 `npm audit`：0 critical、0 high、5 moderate、5 low；原始记录在 `diagnostics/plate-dependency-audit.json`，未做跨主要版本的自动强制降级。

## Cross-references and bibliography

Labels and cross-references have separate toolbar buttons and dialogs. The cross-reference dialog only offers `\ref` and `\eqref`. Insert literature citations from the **BibTeX libraries** manager, searching by author, title or key; there is no additional citation insertion button. Double-clicking an existing reference opens the editor for its own kind. The label toolbar button and an existing label marker open the same label editor. Labels may be attached to numbered display equations, numbered headings, or an inline anchor in prose; an inline anchor follows the current section counter rather than numbering the paragraph. Label markers float beside their targets without taking up text space and are hidden when printing. Clear a label to remove it. Missing, duplicate, or unnumbered targets display `??` with a red underline. Click a reference to select and highlight it, click its edge to place the caret beside it, Ctrl/Command-click to jump to its target, or double-click to edit its key.

In prose, `\label{key}` inserts a label anchor; typing the closing brace of `\ref{key}`, `\eqref{key}`, or `\cite{key1,key2}` creates a reference node. Choose literature from a BibTeX library, or use the dedicated **Insert endnote** toolbar button for an explanatory note. Insert → Endnote uses the same action. There is no separate manual bibliography entry action.

The native .vulgar document preserves labels, reference nodes, rich endnotes and legacy bibliography entries. TeX exports native commands, includes `hyperref`, and collects notes and references at the end. Without BibTeX citations, run LuaLaTeX or XeLaTeX twice to resolve references; the BibTeX compilation sequence is described below. Markdown preserves reference commands as literal text, bibliography keys as `\bibitem` text, equation labels in math fences and heading labels as `{#key}`; endnote references and final list rows include their shared numbers. Markdown renderers do not universally resolve TeX references.

Endnotes and cited BibTeX entries share one “Notes and references” list at the end of the document, numbered in order of first mention in the prose. Their markers use the same baseline `[n]` formatting in the body. Repeated references keep the same number. Endnotes retain their rich text and formulas and remain directly editable. Existing manual bibliography entries are preserved for compatibility and join the same list. Markdown and LaTeX exports also collect these entries into one list.

### BibTeX libraries

The **BibTeX libraries** button opens a separate library manager. Add UTF-8 `.bib` files, search by author, title or citation key, then insert a citation. The citation dialog searches these entries alongside hand-written references. Replace a library to refresh its source while keeping citation keys; duplicate keys and invalid BibTeX are reported before any library is replaced. Removing a library keeps the citation nodes, which become unresolved until the source is added again. Library management is separate from prose undo.

The importer accepts straight and typographic apostrophes in citation keys, preserving the original keys and raw entries. It recognizes the common `sept` month abbreviation. Undefined BibTeX strings produce nonblocking notices and are displayed by name; unsupported LaTeX formatting does not prevent importing the library. Malformed BibTeX structure is still rejected.

An attached `.bib` file is a source for choosing references. **Only cited entries and their necessary BibTeX dependencies are captured in the `.vulgar` document and draft, rather than the entire source library.** Complete libraries are saved separately in a local library catalog on this device, so refreshing the web page, restarting the desktop application, or opening another document does not narrow the library to its cited subset. Nothing is uploaded to a backend. When a document's captured entries exactly match a cached library, the full source becomes available again; conflicting versions preserve the document copy and show a notice. On a different device, or for documents saved before the local catalog existed, the manager labels captured subsets as **Document references only** and offers **Load full library**. Loading the original `.bib` once restores the full catalog for subsequent sessions. Library metadata sits outside the Plate prose tree, and mathematical formula snapshots remain independent.

With BibTeX citations, the single-file `.tex` export embeds the captured bibliography resources and uses `biblatex` with Biber. Compile with **LuaLaTeX → Biber → LuaLaTeX → LuaLaTeX**, running Biber on the document basename. A document with only endnotes or legacy hand-written entries uses `thebibliography` and requires no Biber. Endnote keys are stable and avoid collisions with library citation keys. Markdown includes the cited library entries as readable `\bibitem` text.
