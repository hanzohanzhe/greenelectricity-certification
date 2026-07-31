# 12 开发日志：Sites-compatible Pilot 私有预览

- 状态：本地候选版本完成；Sites 私有保存版本暂缓
- 创建时间：2026-07-31
- 关联模块：09 部署与 Pilot 演示包、11 EvidencePackage UI

## 目标

- 建立已验证的 3B Git 检查点；
- 审查并修复 Sites-compatible 构建问题；
- 提供 Codex 内可继续调试的本地网页；
- 账户允许时只保存私有 Sites 版本，不公开发布；
- 为模块 13 前端 Pilot 打磨建立稳定候选。

## 明确边界

- 本模块不公开部署；
- 不部署 Cloudflare；
- 不加入真实数据、数据库、登录、上传或链上能力；
- 不改变匹配、Evidence 或 Merkle 算法。

## 2026-07-31 执行结果

- 已在 `e7e5b42` 建立并验证 3B 检查点。
- 已创建分支 `feat/sites-compatible-pilot-preview`。
- 保留 vinext、Vite、Sites 和 Cloudflare Worker 兼容构建配置。
- 删除仅用于 starter preview、且经引用检查确认未使用的两个文件。
- 删除未使用的 `react-loading-skeleton` 依赖和 `codex-preview` 元数据。
- 加固浏览器本地 EvidencePackage 下载失败处理，不改变证据算法或文件格式。
- 新增 Sites 兼容性测试，约束 hosting 配置、构建插件、元数据、依赖与三套场景资产。
- `npm run lint`、`npm test`、`npm run build` 均通过。
- 本地预览运行于 `http://localhost:3001/`；四个产品页签可见，浏览器控制台无错误。
- 未创建或公开部署 Sites 项目。当前模块改动按任务边界保持未提交；Sites 版本保存要求对应已提交、已推送的精确源码，因此留待检查点获批后执行。
- 未配置 D1、R2、身份验证、用户上传、真实数据、链上能力或 Cloudflare 正式部署。
