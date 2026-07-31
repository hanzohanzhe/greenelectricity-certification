# Codex任务：07 证据清单、哈希与公开验证

请为GreenProof MVP实现可复现的证据清单、SHA-256哈希、Merkle根和演示证明验证。不要接生产区块链。

## 目标

证明：

- 使用了哪些公开数据；
- 数据经过哪些转换；
- 使用了哪个分配规则；
- 相同输入和规则可以重算；
- 任一输入或结果被修改后验证失败。

不声称：

- 源头电表一定真实；
- 模拟结果是正式绿证；
- 数据已经写入区块链；
- 哈希等于匿名化。

## Evidence Manifest

至少包含：

- `scenarioId`
- 数据源名称、URL、版本、许可证；
- 下载时间；
- 原文件SHA-256；
- 清洗后文件SHA-256；
- 时间范围和粒度；
- provenance和质量摘要；
- 转换程序版本；
- 光伏模型参数；
- 租户缩放参数；
- 对齐方式；
- 分配规则和版本；
- 引擎版本；
- 最终结果哈希。

使用明确的Canonical JSON规范。测试对象字段顺序变化不会改变规范化结果。

## Merkle Tree

- 每个区间结果是叶子；
- 叶子包含区间数据和随机nonce；
- 使用SHA-256；
- 定义奇数叶子处理方式；
- 支持生成和验证单条Merkle路径；
- 支持每日根和整个场景根；
- nonce不放到公开URL，按披露包提供。

## 演示证明

生成：

- Proof ID；
- 场景名称；
- 时间范围；
- 总光伏和现场消纳；
- 两租户分配；
- 数据来源摘要；
- 规则版本；
- Manifest Hash；
- Merkle Root；
- 状态：`demonstration`；
- 二维码/验证URL。

验证页应显示：

- Source manifest unchanged；
- Scenario data unchanged；
- Allocation result unchanged；
- Merkle proof valid；
- Blockchain anchoring：Not enabled。

## 隐私

当前使用公开或匿名数据，但仍不得在公开证明中显示：

- 未经授权的精确建筑身份；
-原始数据集中的敏感标识；
- 精确住宅地址。

## 验收标准

- 修改任一区间1Wh后验证失败。
- 修改规则版本后结果哈希变化。
- 同一输入可重现相同manifest和Merkle根；随机nonce应来自版本化场景或明确的确定性测试路径。
- 验证器可以独立于主UI运行。
- 页面明确显示“非正式证书、未上链”。

## 完成后

更新本模块 `LOG.md`，记录Canonical JSON规范、叶子结构、nonce策略、Merkle算法、验证测试和安全限制。
