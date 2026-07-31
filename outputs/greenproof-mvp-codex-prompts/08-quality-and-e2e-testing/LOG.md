# 08 开发日志：质量、安全边界与端到端测试

- 状态：完成（自动化核心链路）
- 完成时间：2026-07-31

## 测试矩阵

- 48 区间 Golden Dataset，含昼间过剩、早晚购电和 1 Wh 边界；
- 500 组确定性随机样本 × 三规则属性测试；
- Canonical JSON 键序无关；
- 1 Wh 篡改导致 result hash 与 Merkle root 同时变化；
- 时间错位/重叠拒绝；
- Python 离线场景校验；
- TypeScript 严格检查、vinext 生产构建、渲染壳测试。

## 安全审查

未包含 API key、真实地址、账号、钱包、Token、减排绝对声明或“100%
纯绿”声明。大体量 raw 数据和 work 缓存被 Git 忽略。

## 复现命令

`npm ci` → `python data-pipeline/build_scenarios.py` → `npm test`。

## 未解决风险

完整 Playwright 浏览器矩阵和 Lighthouse 数值应在部署环境作为发布后
检查补跑；当前仓库未新增其重型依赖。
