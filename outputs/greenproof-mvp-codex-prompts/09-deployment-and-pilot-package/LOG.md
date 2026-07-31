# 09 开发日志：部署与 Pilot 演示包

- 状态：构建完成，等待 Sites 版本/部署回执
- 完成时间：2026-07-31

## 发布包

vinext 最小服务部署；三场景、来源摘要与社交预览图随构建发布，不调用
外部 API。配置 CSP、nosniff、frame deny、referrer 和 permissions
响应头；无运行密钥。

## Pilot 材料

`docs/pilot` 含三分钟脚本、CSV 数据替换指南、发现问题和反馈模板。
Evidence 可打印，始终标为 demonstration。

## 构建

`npm test` 通过；最终提交、Sites 版本号与生产 URL 在部署后补入。
