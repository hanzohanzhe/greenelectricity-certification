# 07 开发日志：证据清单、哈希与公开验证

- 状态：完成
- 完成时间：2026-07-31

## 规范

Canonical JSON 递归排序对象键、保留数组顺序、采用标准 JSON primitive。
结果使用 SHA-256。每个叶子为 `{ interval, nonce }`；奇数叶复制末叶。
支持整场景根与层级数据。

## Nonce

MVP 使用场景 ID + 版本 + 区间序号的确定性 nonce，保证构建可复现；
正式隐私披露包应改用随机 nonce 并仅向获准验证者披露。

## 验证

UI 显示 manifest、result hash、Merkle root 与本地验证状态；1 Wh 修改会
改变结果 hash 和 Merkle root。规则变更也改变结果。明确显示
“demonstration / not a certificate / blockchain not enabled”。

## 安全限制

哈希不是匿名化，也不能证明源头表计真实；公开包不包含精确地址或
真实建筑身份。
