# 续作产品模块 11：EvidencePackage 下载、导入与 UI 真实验证接入

请执行续作阶段 3B：实现 EvidencePackage 下载、导入和 UI 真实验证接入。

项目仓库：
https://github.com/hanzohanzhe/greenelectricity-certification.git

## 当前状态

- main 基线提交：`39a6ff9963260b3aabc213779eeee152729b9ae2`
- 阶段 3A 功能分支：`feat/independent-evidence-verifier`
- 3A 已实现：
  - `EvidencePackage 1.0.0`
  - `generateMerkleProof(...)`
  - `verifyMerkleProof(...)`
  - `buildEvidencePackage(...)`
  - `verifyEvidencePackage(...)`
  - 结构化 `checks/errors/warnings`
  - 固定 Golden Dataset
- 3A 固定值：
  - manifestHash：`c699d1ce6c6df2be3a752670dba986103f4992aa8d9e44d7ee356a2a092d01a2`
  - Merkle root：`6d98a77eac429550b10687a15670301a9253e60fd7c987897fbde49f5a95f659`

## 本轮目标

让用户能在 Evidence 页面生成并下载真实 EvidencePackage，也能从本地导入 JSON 包，由独立验证器重新计算并展示验证结果。彻底移除 UI 中硬编码的“验证成功”状态。

## 本轮不要

- 修改绿电匹配或租户分配算法；
- 修改已有场景 JSON；
- 开发 QR；
- 添加区块链、钱包、Daml、Token 或零知识证明；
- 添加登录、数据库或服务端存储；
- 把证明包上传到服务器；
- 部署网站或创建 Sites 项目；
- 生成图片；
- 安装 Playwright 或重量级密码学依赖；
- 自动推送 GitHub。

## 一、开始前检查

1. 运行：
   - `git status --short`
   - `git branch --show-current`
   - `git log -3 --oneline`
2. 阅读：
   - `lib/evidence.ts`
   - `lib/contracts.ts`
   - `tests/evidence-verifier.test.ts`
   - `tests/fixtures/evidence-package.golden.json`
   - `components/GreenProofApp.tsx`
   - `docs/methodology/matching-and-evidence.md`
3. 确认当前前端的验证勾选和“1 Wh tamper”是否仍由硬编码布尔状态驱动。
4. 不覆盖或丢弃阶段 3A 的未提交修改。

## 二、先建立 3A 检查点

如果 3A 尚未提交：

1. 确认修改范围与 3A 结果一致。
2. 运行：
   - `npm run lint`
   - `npm test`
   - `npm run build`
   - `git diff --check`
3. 仅暂存 3A 文件：
   - `lib/contracts.ts`
   - `lib/evidence.ts`
   - `tests/evidence-verifier.test.ts`
   - `tests/fixtures/evidence-package.golden.json`
   - `tests/generate-evidence-fixture.ts`
   - `docs/methodology/matching-and-evidence.md`
   - `package.json`
4. 创建提交：`feat: add independent evidence package verification`
5. 不要推送。
6. 如果 Git 身份未配置，保留暂存区并停止，不得伪造身份。

提交成功后创建分支：`feat/evidence-package-ui`。

## 三、实现纯函数文件接口

新增不依赖 React 的轻量模块，例如 `lib/evidence-file.ts`，至少实现：

- `serializeEvidencePackage(package)`
- `parseEvidencePackage(text)`
- `evidencePackageFilename(package)`
- 下载所需的 MIME/Blob 数据构造辅助函数
- 最大导入文件大小常量

要求：

1. 导出 JSON 必须确定性；
2. JSON 能重新解析并通过 `verifyEvidencePackage`；
3. 文件名安全，只允许合理的字母、数字、短横线和版本信息；
4. 不信任文件名、MIME 或扩展名，最终以内容解析和验证结果为准；
5. 对无效 JSON、空文件、超限文件、错误 schema 和缺失字段返回结构化错误；
6. 不执行导入文件中的任何代码或 URL；
7. 不引入第三方序列化或密码学依赖；
8. 下载完成后正确释放 Object URL；
9. 证明包始终只在浏览器本地处理。

## 四、接入 Evidence UI

1. Generate demo proof
   - 使用 `buildEvidencePackage(scenario, selectedRule)`；
   - 随后立即调用 `verifyEvidencePackage`；
   - 不再使用 `buildEvidence` 结果或硬编码布尔值判断成功。

2. Download evidence package
   - 下载完整 JSON EvidencePackage；
   - 使用安全、可预测的文件名；
   - 下载前明确提示：该包包含完整场景和所有区间数据，未来真实 Pilot 数据可能具有敏感性。

3. Load evidence package
   - 使用本地单文件选择器；
   - 检查文件大小；
   - 读取文本并调用 `parseEvidencePackage` 和 `verifyEvidencePackage`；
   - 不上传文件，不把内容写入 URL、日志、localStorage 或外部服务。

4. 验证结果展示
   - 直接渲染 `VerificationResult`；
   - 显示总状态 `valid / invalid`；
   - 显示每个真实 check：
     - `canonicalIntervalResultHash`
     - `merkleRoot`
     - `inclusionProofs`
     - `manifestHash`
     - `attestationBinding`
     - `scenarioId`
     - `period`
     - `rule`
     - `totals`
   - errors 显示 code 和安全、易懂的信息；
   - warnings 始终显示可信签发、时间戳、演示 nonce 和非正式证书边界。

5. 真实 1 Wh tamper 演示
   - 删除只切换 true/false 的实现；
   - 深拷贝当前 EvidencePackage；
   - 修改一个区间的受保护值 1 Wh；
   - 把修改后的包真实传给 `verifyEvidencePackage`；
   - 展示实际失败的 checks/errors；
   - Restore original 必须重新验证原始包。

6. 单区间 inclusion proof
   - 允许验证当前选定区间或至少第一个区间；
   - 使用 `verifyMerkleProof`；
   - 显示 leafIndex、路径长度和真实验证结果；
   - 不把包内声明的 leafHash 直接当作验证成功依据。

7. UI 状态必须区分：
   - 尚未生成或导入；
   - 正在生成；
   - 正在读取；
   - 验证通过；
   - 验证失败；
   - 文件解析失败。

8. 保持现有免责声明：
   - Demonstration
   - Not an official certificate
   - Blockchain anchoring not enabled

禁止使用“不可篡改”“已上链”“区块链验证通过”等表述。

## 五、兼容性和范围

1. 不改变 `buildEvidencePackage`、`verifyEvidencePackage` 或 Merkle 算法含义；
2. 不改变匹配引擎和原有结果；
3. 不改变场景 JSON；
4. 保持现有三场景和三分配规则；
5. URL 不得包含证明包、nonce、区间数据或敏感字段；
6. 不添加服务端上传端点；
7. 不降低 TypeScript 或 ESLint 严格度；
8. 不使用 `eslint-disable`、`ts-ignore` 或硬编码验证结果。

## 六、自动化测试

至少覆盖：

1. 合法 Golden EvidencePackage 序列化后重新解析；
2. 解析后的包仍通过 `verifyEvidencePackage`；
3. 重复序列化产生相同文本；
4. 安全文件名；
5. 无效 JSON；
6. 空文件；
7. 缺失字段；
8. 错误 schemaVersion；
9. 超限文件；
10. 1 Wh 篡改文件解析成功但验证失败；
11. 下载包中的 manifestHash 和 Merkle root 与 Golden fixture 一致；
12. UI 使用的验证状态来自 `VerificationResult`；
13. tamper 演示调用真实验证器；
14. 原有 16 项测试继续通过。

测试中不得重新生成 Golden 预期值，继续读取固定 fixture。

## 七、文档

更新方法学或新增用户说明，记录：

- 如何生成和下载证明包；
- 如何离线导入和验证；
- 所有验证在浏览器本地完成；
- EvidencePackage 包含完整区间数据，真实 Pilot 需要访问控制；
- 验证成功只证明包内自洽；
- 没有签名、可信时间戳或外部锚定；
- 完整重写并重新哈希的包仍可能自洽，因此不能证明签发者身份。

## 八、验证

依次运行：

- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
- `git diff --stat`
- `git status --short`

验收标准：

- Lint 0 error、0 warning；
- 所有旧测试和新增测试通过；
- 生产构建通过；
- 前端不再包含硬编码验证成功状态；
- 合法包显示全部检查通过；
- 修改 1 Wh 后真实验证失败；
- 导入损坏 JSON 不导致页面崩溃；
- 文件不上传或写入 URL；
- 没有修改匹配算法、场景 JSON 或无关功能。

## 九、Git 要求

- 不自动提交阶段 3B；
- 不推送；
- 不合并 main；
- 保持所有 3B 修改供人工审核。

## 最终汇报

1. 3A 检查点提交 SHA；
2. 3B 所在分支；
3. 下载和导入流程；
4. UI 如何调用真实验证器；
5. 已删除的硬编码验证逻辑；
6. 文件和隐私保护；
7. 修改文件列表；
8. 新增测试及完整结果；
9. `git diff --stat`；
10. 仍不能证明的事项；
11. 下一步建议：独立验证页面/CLI，或先进行 Pilot 用户测试。

如果任何命令长时间无输出，请停止等待并报告卡点，不要无限等待。
