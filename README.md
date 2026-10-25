# MathJax 原位公式编辑原型

编辑器使用 TypeScript（`strict: true`）、原生 DOM 和 MathJax 4。无需前端框架。

## 开发

首次安装依赖：`npm ci`。

- `npm run typecheck`：严格类型检查，不生成文件。
- `npm run build`：先检查类型，再编译浏览器脚本和 source map。
- `npm test`：构建后运行模型回归测试，测试实际生成的代码。
- `npm run dev`：构建并在 <http://127.0.0.1:8767/> 启动预览。

修改源文件后运行 `npm run build`，再刷新页面；服务器无需重启。启动前确保端口没有被另一个预览进程占用。MathJax 仍由 CDN 加载，首次打开需要网络连接。

## 源码

- `src/editor-model.ts`：公式树、区域、光标、选择、命令、结构变体及撤销；保存草稿的 JSON 在恢复时做运行时校验。
- `src/extensions.ts`：Unicode-math 字体、physics 常用结构和 mhchem 化学源码区域。
- `src/editor-ui.ts`：原位编辑、隐藏输入控件、命令候选、右键菜单、点击定位及渲染调度。
- `src/dom.ts`：DOM 边界检查。
- `src/mathjax-config.ts`、`src/mathjax.d.ts`：MathJax 启动配置及使用到的 API 类型。
- `mathjax4_editor_prototype_document_typeset.html`：页面结构和 CSS。
- `editor-model.test.cjs`：模型回归测试。

根目录的 `editor-model.js`、`editor-ui.js`、`mathjax-config.js` 和对应 `.map` 都是构建产物，请勿手动修改。浏览器执行的是这些 JavaScript 文件；TypeScript 类型不进入运行时。构建脚本、测试入口和静态服务器保留 Node.js 的 `.cjs` 格式。

草稿仍使用原有的 sessionStorage 键和 JSON 格式，迁移不清空草稿。TypeScript 帮助提前发现类型错误，但不能替代运行时校验和交互测试。

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
