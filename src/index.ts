import {
  AuthorizationType,
  basekit,
  FieldCode,
  FieldComponent,
  FieldType
} from "@lark-opdev/block-basekit-server-api";
import {
  DEFAULT_IMAGE_COUNT,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_RESOLUTION,
  DEFAULT_SIZE,
  YUNWU_AUTH_ID
} from "./constants";
import { executeImageGeneration } from "./imageClient";

const shortcutIcon = "https://lf3-static.bytednsdoc.com/obj/eden-cn/eqgeh7upeubqnulog/chatbot.svg";

basekit.addDomainList(["yunwu.ai", "feishu.cn", "feishucdn.com", "larksuitecdn.com", "larksuite.com"]);

basekit.addField({
  authorizations: [
    {
      id: YUNWU_AUTH_ID,
      label: "云雾 API Key",
      platform: "connect_ai",
      type: AuthorizationType.HeaderBearerToken,
      required: true,
      instructionsUrl: "https://yunwu.apifox.cn/api-447792717",
      icon: {
        light: shortcutIcon,
        dark: shortcutIcon
      }
    }
  ],
  formItems: [
    {
      key: "model",
      label: "模型",
      component: FieldComponent.SingleSelect,
      props: {
        options: [
          { label: "gpt-image-2-all（推荐）", value: "gpt-image-2-all" },
          { label: "gpt-image-2", value: "gpt-image-2" }
        ]
      },
      defaultValue: { label: "gpt-image-2-all（推荐）", value: "gpt-image-2-all" }
    },
    {
      key: "prompt",
      label: "输入指令",
      component: FieldComponent.Input,
      props: {
        placeholder: "写入生成图片的完整指令，可在输入框中引用多维表字段",
        mode: "textarea"
      },
      validator: {
        required: true
      }
    },
    {
      key: "referenceImages",
      label: "图片内容（支持多图）",
      component: FieldComponent.FieldSelect,
      props: {
        supportType: [FieldType.Attachment]
      },
      validator: {
        required: false,
        maxItems: 16
      }
    },
    {
      key: "size",
      label: "画面比例",
      component: FieldComponent.SingleSelect,
      props: {
        options: [
          { label: "auto", value: "auto" },
          { label: "1:1", value: "1:1" },
          { label: "3:2", value: "3:2" },
          { label: "2:3", value: "2:3" },
          { label: "4:3", value: "4:3" },
          { label: "3:4", value: "3:4" },
          { label: "5:4", value: "5:4" },
          { label: "4:5", value: "4:5" },
          { label: "16:9", value: "16:9" },
          { label: "9:16", value: "9:16" },
          { label: "2:1", value: "2:1" },
          { label: "1:2", value: "1:2" },
          { label: "3:1", value: "3:1" },
          { label: "1:3", value: "1:3" },
          { label: "21:9", value: "21:9" },
          { label: "9:21", value: "9:21" },
          { label: "自定义像素", value: "custom" }
        ]
      },
      defaultValue: { label: DEFAULT_SIZE, value: DEFAULT_SIZE }
    },
    {
      key: "customSize",
      label: "自定义尺寸",
      component: FieldComponent.Input,
      props: {
        placeholder: "例如 2048x1152；仅当画面比例选择自定义像素时生效"
      }
    },
    {
      key: "resolution",
      label: "分辨率",
      component: FieldComponent.SingleSelect,
      props: {
        options: [
          { label: "1k", value: "1k" },
          { label: "2k", value: "2k" },
          { label: "4k", value: "4k" }
        ]
      },
      defaultValue: { label: DEFAULT_RESOLUTION, value: DEFAULT_RESOLUTION }
    },
    {
      key: "imageCount",
      label: "最大生成图片数",
      component: FieldComponent.Input,
      props: {
        placeholder: "1-4"
      },
      defaultValue: String(DEFAULT_IMAGE_COUNT),
      validator: {
        required: false
      }
    },
    {
      key: "outputFormat",
      label: "输出格式",
      component: FieldComponent.SingleSelect,
      props: {
        options: [
          { label: "png", value: "png" },
          { label: "jpeg", value: "jpeg" },
          { label: "webp", value: "webp" }
        ]
      },
      defaultValue: { label: DEFAULT_OUTPUT_FORMAT, value: DEFAULT_OUTPUT_FORMAT }
    },
    {
      key: "officialFallback",
      label: "官方兜底",
      component: FieldComponent.Radio,
      props: {
        options: [
          { label: "否", value: "false" },
          { label: "是", value: "true" }
        ]
      },
      defaultValue: { label: "否", value: "false" }
    }
  ],
  resultType: {
    type: FieldType.Attachment
  },
  execute: async (formItemParams, context) => {
    try {
      return await executeImageGeneration(formItemParams, context);
    } catch (error) {
      return {
        code: FieldCode.Error,
        msg: error instanceof Error ? error.message : String(error)
      };
    }
  }
});

export default basekit;
