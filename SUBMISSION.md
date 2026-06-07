# 上架提交信息

## 基础信息

- 插件名称：生成图片 img
- 插件类型：飞书多维表字段捷径 FaaS 插件
- 字段结果类型：附件
- 一句话介绍：在多维表中调用云雾图像模型，将文本和参考图生成的图片写回附件字段。

## 上传材料

- 打包产物：`output/output_6_7_2026__11_08_51_AM.zip`
- 图标 SVG：`assets/icon.svg`
- 图标 PNG：`assets/icon.png`

## 授权说明

插件使用飞书托管的 API Key 授权，授权项为「云雾 API Key」。用户在字段配置面板中关联账号后，插件通过 `context.fetch(..., "yunwu_auth")` 自动携带 Bearer Token，请求云雾接口。

## 外部域名

- `yunwu.ai`
- `feishu.cn`
- `feishucdn.com`
- `larksuitecdn.com`
- `larksuite.com`

## 验收场景

- 发布执行方式选择「异步执行」。
- 纯文本生成 1 张图。
- 单张参考图生成 1 张图。
- 多张参考图生成 1 张图。
- 生成 4 张图。
- 创建字段时选择「生成范围」为自定义行数，确认不会误触发整列生成。
