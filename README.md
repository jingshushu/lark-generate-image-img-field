# 生成图片 img 字段捷径

飞书多维表 FaaS 字段捷径插件，用云雾图像模型为每行记录生成图片，并把结果写回附件字段。

## 功能

- 支持文本指令生成图片。
- 支持附件字段单图/多图作为参考图。
- 支持比例、分辨率、输出格式、生成数量、官方兜底等配置。
- 默认 API：`https://yunwu.ai/v1/images/generations`。
- 默认模型：`gpt-image-2-all`。
- 保留旧模型：`gpt-image-2`，用于需要任务轮询接口时手动切换。
- `gpt-image-2-all` 使用同步返回 URL 的接口，请求字段为 `model`、`prompt`、`n`、`size`、`image`，参考图直接传飞书附件临时 URL，避免大体积 base64 请求。
- `gpt-image-2-all` 的尺寸会自动映射为 `1024x1024`、`1536x1024` 或 `1024x1536`，参考图最多发送前 5 张。
- `gpt-image-2` 仍沿用旧任务接口，参考图会转成 base64 data URI。
- 授权：飞书托管 `HeaderBearerToken`，授权 ID 为 `yunwu_auth`，平台槽为 `connect_ai`。
- 不在代码侧关闭自动更新；创建字段时使用飞书原生「生成范围」和「自动更新」控制本次生成行数，避免整列误触发消耗额度。

## 开发

```bash
npm install
npm test
npm run typecheck
npm run build
npm run pack
```

本地调试授权在 `config.json` 中配置。可以先复制示例文件：

```bash
cp config.example.json config.json
```

然后把 `config.json` 中的占位 token 改成自己的云雾 Key：

```json
{
  "authorizations": [
    "sk-yunwu-local-debug-token"
  ]
}
```

打包产物会生成在 `output/` 下，例如：

```text
output/output_5_29_2026__5_57_14_PM.zip
```

上架图标在 `assets/icon.png`，源文件为 `assets/icon.svg`。

## 发布前检查

- 确认飞书字段捷径后台允许 `connect_ai` 承载云雾 API Key。
- 确认云雾正式域名仍为 `yunwu.ai`；如变更，需要同步更新 `basekit.addDomainList` 和 `src/constants.ts`。
- 确认线上字段创建面板展示「生成范围」和「自动更新」，并用自定义行数做首次验收。
- 用字段捷径调试助手验证纯文本、单参考图、多参考图、生成 4 张图四个场景。
