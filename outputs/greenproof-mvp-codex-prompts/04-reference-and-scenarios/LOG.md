# 04 开发日志：英国参考数据与场景构建

- 状态：完成
- 完成时间：2026-07-31

## 场景

- `cambridge-campus-real`：2022-06-15，同日两栋匿名建筑小时汇总需求 +
  同日剑桥模型 PV；构建 hash `cd711c4d…3d3ddc`。
- `cambridge-weather-driven`：PC1/PC3 风格年量缩放需求 + 同日模型 PV，
  标为 `aligned_typical_day`；hash `fbcb7c60…589f9d`。
- `uk-system-context`：2022 冬季建筑/PV + NESO 2025-01-08 全国需求背景，
  明确为典型日对齐；hash `c0775630…284da`。

## NESO

使用官方 2025 CSV 的 Settlement Date、Period、ND；48 个半小时聚合为
24 个小时背景点。只作为系统上下文，绝不缩小冒充建筑需求。

## 复现

`python data-pipeline/build_scenarios.py` 生成三场景；相同输入产生相同
内容 hash；`validate_scenario.py` 可离线验证。
