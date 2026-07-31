# 产品模块 12：Sites-compatible Pilot 私有预览

请执行产品模块 12：把当前 GreenProof MVP 整理成可由 ChatGPT Sites 构建、保存版本和私有预览的稳定候选，并启动本地网页供后续前端调试。

本阶段不是公开发布。不要把 Site 设置为 anyone on the internet，不要部署 Cloudflare；Cloudflare 正式发布属于后续独立模块。

## 一、当前基线

- 项目仓库：`https://github.com/hanzohanzhe/greenelectricity-certification.git`
- main 基线：`39a6ff9963260b3aabc213779eeee152729b9ae2`
- 3A 检查点：`23d3415 feat: add independent evidence package verification`
- 当前分支预计为：`feat/evidence-package-ui`
- 3B 当前预计尚未提交，已实现：
  - EvidencePackage 确定性下载；
  - 浏览器本地 JSON 导入；
  - 独立 `VerificationResult` UI；
  - 真实 1 Wh 篡改；
  - 单区间 Merkle inclusion proof；
  - 22 项单元测试和生产构建通过。
- 当前项目包含 `.openai/hosting.json`，但尚无 `project_id`，不得把它描述成已创建或已发布的 Site。
- 当前不使用 D1、R2、登录、数据库或服务端上传。

## 二、本轮唯一目标

得到一个满足以下条件的 review candidate：

1. 当前 3B 有可追溯 Git 检查点；
2. 现有项目保持 vinext、Vite 和 Sites-compatible 结构；
3. 本地开发页面可以由用户在 Codex 内查看和继续调试；
4. 生产构建可以作为 Sites 保存版本的候选；
5. 如果账户和地区支持 Sites，只保存私有版本或私有预览，不公开部署；
6. 如果 Sites 当前对账户或英国地区不可用，仍完成相同技术标准的本地候选，并明确报告平台限制，不得把平台不可用伪装成代码失败。

## 三、本轮不要

- 不改变绿电匹配、租户分配或守恒算法；
- 不改变 EvidencePackage、Canonical JSON、SHA-256 或 Merkle 算法语义；
- 不改变三个场景 JSON；
- 不添加真实学院、业主或电表数据；
- 不添加登录、数据库、D1、R2、服务端上传或持久化；
- 不添加区块链、钱包、Token、Daml 或零知识证明；
- 不开发 QR；
- 不部署 Cloudflare；
- 不公开发布 Site；
- 不切换为标准 Next.js 或大规模更换框架；
- 不进行与 Sites 兼容性无关的大规模 UI 重设计；
- 不生成社交分享图或其他图片；视觉定稿和分享图留给后续前端打磨/正式发布阶段；
- 不安装 Playwright 或重量级依赖；
- 不推送 GitHub；
- 不合并 main。

## 四、开始前检查

1. 阅读：
   - `README.md`
   - `.gitignore`
   - `.openai/hosting.json`
   - `package.json`
   - `vite.config.ts`
   - `app/page.tsx`
   - `app/layout.tsx`
   - `app/globals.css`
   - `components/GreenProofApp.tsx`
   - `lib/evidence-file.ts`
   - `tests/evidence-file.test.ts`
   - `outputs/greenproof-mvp-codex-prompts/README.md`
   - `outputs/greenproof-mvp-codex-prompts/TASKS.md`
   - 模块 11 的 `PROMPT.md` 和 `LOG.md`
2. 运行：
   - `git status --short`
   - `git branch --show-current`
   - `git log -3 --oneline`
   - `git diff --check`
   - `git diff --stat`
3. 确认：
   - 3A 检查点存在；
   - 3B 未提交修改与模块 11 日志一致；
   - `lib/energy-engine.ts` 和 `public/data/scenarios/*.json` 没有被 3B 修改；
   - 未跟踪的 Prompt 路线图文件不含凭证、隐私数据或异常大文件；
   - 当前 Evidence UI 不再使用硬编码验证成功状态。

不得覆盖、丢弃或重做已经完成的 3A/3B 功能。

## 五、先建立 3B 检查点

1. 在提交前依次运行：
   - `npm run lint`
   - `npm test`
   - `npm run build`
   - `git diff --check`
2. 检查所有准备提交的文件，尤其包括：
   - Evidence UI 和 CSS；
   - `lib/evidence-file.ts`；
   - `tests/evidence-file.test.ts`；
   - 方法学和 README；
   - `.gitignore` 中只放行 Prompt 开发日志目录的规则；
   - 01—12 Prompt 路线图文件。
3. 对准备版本管理的 Prompt 目录做敏感信息扫描。若发现疑似密钥、真实隐私数据、许可证不明大文件或机器专属配置，停止，不得提交。
4. 不使用 `git add .`；只暂存逐项检查过的文件。
5. 暂存后运行：
   - `git diff --cached --stat`
   - `git diff --cached --check`
6. 创建提交：

   `feat: add browser-local evidence package workflow`

7. 不要推送。
8. 如果 Git 身份未配置，保留暂存区并报告，不得伪造身份。

提交成功后创建分支：

`feat/sites-compatible-pilot-preview`

## 六、Sites-compatible 审查

保持当前架构，检查并修复真正影响 Sites 构建和预览的问题：

1. `.openai/hosting.json`
   - 保持 JSON 合法；
   - `d1` 和 `r2` 继续为 `null`；
   - 不手工编造 `project_id`；
   - 不写入密钥、账户 ID、域名或机器路径。
2. 构建系统
   - 保留现有包管理器和锁文件；
   - 保留 vinext、Vite 和 Cloudflare Worker-compatible ESM 输出；
   - 保留 Sites Vite 插件；
   - 不改用另一套脚手架；
   - 不为静态演示增加数据库或服务端状态。
3. Starter 清理
   - 检查 `app/_sites-preview` 是否仍被产品页面引用；
   - 只有确认完全未引用时才删除 starter preview 文件；
   - 只有确认没有其他使用者时才移除 `react-loading-skeleton` 并刷新锁文件；
   - 清除仍存在的 starter/codex-preview metadata；
   - `app/layout.tsx` 使用 GreenProof 自己的 title 和 description；
   - 不为了清理 starter 改变产品交互或视觉方向。
4. 路由和资源
   - 确认 `/` 能加载；
   - 确认 `?view=twin`、`matching`、`summary`、`evidence` 在直接打开和刷新后可用；
   - 确认三个 `public/data/scenarios` 场景在生产构建中可访问；
   - 不把 EvidencePackage、nonce、区间数据或敏感信息写进 URL。
5. 浏览器兼容
   - 确认 Web Crypto、Blob、本地文件选择、Object URL 下载在目标浏览器失败时给出可理解状态；
   - 不增加服务器上传回退；
   - 继续明确显示 demonstration、not an official certificate、blockchain anchoring not enabled。

只修复实际发现的兼容性问题，不进行推测性重构。

## 七、本地预览

1. 启动现有开发服务器，使用终端输出的准确 Local URL；
2. 在 Codex 内置浏览器中打开一次该 URL；
3. 保持开发服务器运行，供用户进入下一阶段继续调试；
4. 本轮只做最小 smoke check：
   - 页面成功加载；
   - 四个标签可见；
   - 无明显运行时错误；
5. 不执行截图、逐元素 DOM 检查、响应式矩阵或完整交互验收；这些属于模块 13，除非用户在执行过程中明确要求。

## 八、Sites 私有版本处理

在代码和生产构建通过后：

1. 检查当前账户是否实际支持 Sites；
2. 如果支持：
   - 只创建/关联项目并保存一个 reviewable version，或使用 owner-only 私有预览；
   - 不选择 anyone on the internet；
   - 不执行公开 Deploy；
   - 记录项目/版本标识，但不得把秘密值写入代码；
3. 如果不支持或因英国地区限制不可用：
   - 不尝试绕过地区、账户或工作区限制；
   - 保留本地 Sites-compatible 构建；
   - 报告准确限制和本地预览地址；
   - 继续把项目视为可进入模块 13 的前端调试候选。

不要声称保存版本等于公开部署。不要编造 Site URL。

## 九、测试要求

若发现兼容性缺陷并修改代码，应补充最小、确定性的回归测试。至少保留并验证：

- 原有匹配引擎和随机守恒测试；
- 1 Wh 篡改测试；
- Golden EvidencePackage；
- 独立 Evidence 验证器；
- 文件序列化、解析、大小限制和安全文件名；
- Evidence UI 真实验证接线；
- 生产构建和渲染壳测试。

不得在测试中重新生成 Golden 预期值。

## 十、最终验证

完成修改后依次运行：

- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
- `git diff --stat`
- `git status --short`

如果项目已有额外格式检查，一并运行。

验收标准：

- Lint 0 error、0 warning；
- TypeScript 严格检查通过；
- 全部旧测试和新增测试通过；
- 生产构建通过；
- 本地网页可打开；
- 四个产品标签存在；
- 三个场景和 Evidence 功能未退化；
- `.openai/hosting.json` 无伪造 project ID 或敏感数据；
- 无数据库、上传、公开部署、Cloudflare 部署或无关功能；
- 匹配算法、场景 JSON 和 Golden 固定值未变化。

## 十一、Git 要求

- 允许按上述步骤提交已验证的 3B 检查点；
- 模块 12 本身的兼容性修改不要自动提交；
- 不推送；
- 不合并 main；
- 保持模块 12 的修改供用户调试和人工审查。

## 十二、最终汇报

只汇报：

1. 模块 12 Prompt 保存位置；
2. 3B 检查点提交 SHA；
3. 当前功能分支；
4. Sites compatibility 审查结论；
5. 实际修复的兼容性问题；
6. 本地预览准确地址和开发服务器状态；
7. 是否成功保存 Sites 私有版本；若没有，说明账户/地区/平台限制；
8. 修改文件列表；
9. 三项验证命令完整结果；
10. `git diff --stat` 和 `git status --short`；
11. 是否可以进入模块 13 前端调试；
12. 仍需用户注意的隐私、访问和发布边界。

如果任何命令长时间没有输出，停止等待并报告具体卡点，不要无限等待。
