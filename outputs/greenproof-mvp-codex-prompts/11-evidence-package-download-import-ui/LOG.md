# 11 开发日志：EvidencePackage 下载、导入与 UI 真实验证

- 状态：完成，3B 修改未提交
- 开始时间：2026-07-31
- 来源：用户提供的续作阶段 3B Prompt
- 关联原模块：06 数字孪生前端、07 证据哈希、08 质量与测试

## 基线

- 3A 检查点：`23d3415 feat: add independent evidence package verification`
- 3B 分支：`feat/evidence-package-ui`
- Golden manifestHash：`c699d1ce6c6df2be3a752670dba986103f4992aa8d9e44d7ee356a2a092d01a2`
- Golden Merkle root：`6d98a77eac429550b10687a15670301a9253e60fd7c987897fbde49f5a95f659`

## 计划产出

- 浏览器本地确定性序列化、解析和安全文件名；
- EvidencePackage 生成、下载和本地导入；
- 直接渲染独立验证器的 checks/errors/warnings；
- 真实 1 Wh 篡改与单区间 inclusion proof；
- 文件接口、UI 纯逻辑和回归测试；
- 本地处理与信任边界文档。

## 已实现

- `lib/evidence-file.ts` 提供确定性序列化、结构化解析错误、5 MiB 上限、安全文件名和 Blob；
- Evidence 页生成后立即调用独立验证器，导入文件也使用同一验证路径；
- 所有九项 checks、errors、warnings 直接来自 `VerificationResult`；
- 1 Wh 演示修改真实包后重新验证，恢复时重新验证原包；
- 单区间验证重新计算 leaf 与 Merkle path；
- 下载 Object URL 使用后释放，不上传、不写 URL 或浏览器存储；
- 新增文件接口和 UI 接线防回归测试。

## 验收

- `npm run lint`：通过，0 error、0 warning；
- `npm test`：通过，22 项单元测试、TypeScript、生产构建和渲染壳测试全部成功；
- `npm run build`：独立复跑通过；
- 原 Golden manifestHash 和 Merkle root 未改变；
- 未修改匹配引擎、场景 JSON、部署或链上功能。
