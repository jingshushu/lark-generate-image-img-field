import { FieldCode } from "@lark-opdev/block-basekit-server-api";
import {
  DEFAULT_IMAGE_COUNT,
  DEFAULT_MODEL,
  DEFAULT_OFFICIAL_FALLBACK,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_RESOLUTION,
  DEFAULT_SIZE,
  DIRECT_MODEL,
  INITIAL_POLL_DELAY_MS,
  MAX_OUTPUT_ATTACHMENTS,
  MAX_REFERENCE_IMAGES,
  POLL_INTERVAL_MS,
  TASK_MODEL,
  TASK_TIMEOUT_MS,
  YUNWU_API_BASE_URL,
  YUNWU_AUTH_ID,
  YUNWU_GENERATIONS_ENDPOINT
} from "./constants";

export type ShortcutResult = {
  code: FieldCode;
  data?: unknown;
  msg?: string;
};

type SelectValue = string | { value?: string | number | boolean; label?: string };

type ReferenceAttachment = {
  name?: string;
  type?: string;
  mimeType?: string;
  tmp_url?: string;
  url?: string;
};

type ExecuteParams = {
  prompt?: string;
  model?: SelectValue;
  referenceImages?: ReferenceAttachment[] | ReferenceAttachment;
  size?: SelectValue;
  customSize?: string;
  resolution?: SelectValue;
  imageCount?: string | number;
  outputFormat?: SelectValue;
  officialFallback?: SelectValue | boolean;
};

type FetchLike = (url: string, init?: RequestInit, authorizationId?: string) => Promise<Response>;

type ExecuteContext = {
  logID?: string;
  fetch: FetchLike;
};

type RuntimeOptions = {
  initialPollDelayMs?: number;
  pollIntervalMs?: number;
  taskTimeoutMs?: number;
};

type GeneratedAttachment = {
  name: string;
  content: string;
  contentType: "attachment/url";
};

type GeneratedImageUrl = {
  sourceId: string;
  url: string;
  index: number;
  model: string;
};

class FieldMappedError extends Error {
  readonly code: FieldCode;

  constructor(code: FieldCode, message: string) {
    super(message);
    this.code = code;
  }
}

export async function executeImageGeneration(
  formItemParams: ExecuteParams,
  context: ExecuteContext,
  runtimeOptions: RuntimeOptions = {}
): Promise<ShortcutResult> {
  const startedAt = Date.now();
  try {
    debugLog(context, "start", {
      params: redactParamsForLog(formItemParams)
    });
    const normalized = normalizeParams(formItemParams);
    const resultUrls =
      normalized.model === DIRECT_MODEL
        ? await createDirectImages(normalized, getReferenceImageUrls(normalized.referenceImages), context)
        : await createTaskImages(
            normalized,
            await downloadReferenceImages(normalized.referenceImages, context.fetch),
            context.fetch,
            runtimeOptions
          );
    const data = resultUrls.slice(0, MAX_OUTPUT_ATTACHMENTS).map((image: GeneratedImageUrl) =>
      toAttachment(image.url, image.sourceId, image.index, normalized.outputFormat, image.model)
    );

    if (data.length === 0) {
      throw new FieldMappedError(FieldCode.Error, "云雾任务完成但没有返回图片 URL");
    }

    debugLog(context, "complete", {
      durationMs: Date.now() - startedAt,
      imageCount: data.length
    });
    return {
      code: FieldCode.Success,
      data
    };
  } catch (error) {
    debugLog(context, "error", {
      durationMs: Date.now() - startedAt,
      code: error instanceof FieldMappedError ? error.code : FieldCode.Error,
      message: error instanceof Error ? error.message : String(error)
    });
    if (error instanceof FieldMappedError) {
      return {
        code: error.code,
        msg: withLogId(error.message, context.logID)
      };
    }

    return {
      code: FieldCode.Error,
      msg: withLogId(error instanceof Error ? error.message : String(error), context.logID)
    };
  }
}

function normalizeParams(params: ExecuteParams) {
  const prompt = String(params.prompt ?? "").trim();
  if (!prompt) {
    throw new FieldMappedError(FieldCode.ConfigError, "输入指令不能为空");
  }

  const referenceImages = normalizeReferenceImages(params.referenceImages);
  if (referenceImages.length > MAX_REFERENCE_IMAGES) {
    throw new FieldMappedError(FieldCode.ConfigError, `图片内容最多支持 ${MAX_REFERENCE_IMAGES} 张参考图`);
  }

  const imageCount = parseInteger(params.imageCount, DEFAULT_IMAGE_COUNT);
  if (imageCount < 1 || imageCount > 4) {
    throw new FieldMappedError(FieldCode.ConfigError, "最大生成图片数必须在 1 到 4 之间");
  }

  const selectedSize = selectToString(params.size, DEFAULT_SIZE);
  const size = selectedSize === "custom" ? String(params.customSize ?? "").trim() : selectedSize;
  if (selectedSize === "custom" && !/^\d+x\d+$/i.test(size)) {
    throw new FieldMappedError(FieldCode.ConfigError, "自定义尺寸需使用类似 2048x1152 的格式");
  }

  return {
    model: selectToString(params.model, DEFAULT_MODEL),
    prompt,
    referenceImages,
    imageCount,
    size,
    resolution: selectToString(params.resolution, DEFAULT_RESOLUTION),
    outputFormat: selectToString(params.outputFormat, DEFAULT_OUTPUT_FORMAT),
    officialFallback: selectToBoolean(params.officialFallback, DEFAULT_OFFICIAL_FALLBACK)
  };
}

function normalizeReferenceImages(value: ExecuteParams["referenceImages"]): ReferenceAttachment[] {
  if (!value) {
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item): item is ReferenceAttachment => Boolean(item));
}

function getReferenceImageUrls(attachments: ReferenceAttachment[]) {
  return attachments.slice(0, 5).map((attachment) => {
    const url = attachment.tmp_url ?? attachment.url;
    if (!url) {
      throw new FieldMappedError(FieldCode.ConfigError, "图片内容附件缺少临时下载地址");
    }
    return url;
  });
}

function selectToString(value: SelectValue | undefined, fallback: string) {
  if (value && typeof value === "object" && value.value !== undefined) {
    return String(value.value);
  }
  if (value === undefined || value === "") {
    return fallback;
  }
  return String(value);
}

function selectToBoolean(value: SelectValue | boolean | undefined, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  const raw = selectToString(value, String(fallback)).toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "是";
}

function parseInteger(value: string | number | undefined, fallback: number) {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new FieldMappedError(FieldCode.ConfigError, "最大生成图片数必须是数字");
  }
  return parsed;
}

async function downloadReferenceImages(attachments: ReferenceAttachment[], fetchImpl: FetchLike) {
  const imageUrls: string[] = [];

  for (const attachment of attachments) {
    const url = attachment.tmp_url ?? attachment.url;
    if (!url) {
      throw new FieldMappedError(FieldCode.ConfigError, "图片内容附件缺少临时下载地址");
    }

    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new FieldMappedError(FieldCode.Error, `参考图下载失败：${response.status} ${response.statusText}`);
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const mimeType = attachment.type ?? attachment.mimeType ?? inferMimeType(attachment.name);
    imageUrls.push(`data:${mimeType};base64,${imageBuffer.toString("base64")}`);
  }

  return imageUrls;
}

async function createTasks(
  params: ReturnType<typeof normalizeParams>,
  imageUrls: string[],
  fetchImpl: FetchLike
) {
  const taskIds: string[] = [];
  const requestUrl = `${YUNWU_API_BASE_URL}${YUNWU_GENERATIONS_ENDPOINT}`;

  for (let index = 0; index < params.imageCount; index += 1) {
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      n: 1,
      size: params.size,
      resolution: params.resolution,
      output_format: params.outputFormat,
      official_fallback: params.officialFallback
    };

    if (imageUrls.length > 0) {
      body.image_urls = imageUrls;
    }

    const response = await fetchImpl(
      requestUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      },
      YUNWU_AUTH_ID
    );

    await assertProviderResponse(response, "createTask", requestUrl);
    const payload = await response.json();
    const taskId = extractTaskId(payload);
    if (!taskId) {
      throw new FieldMappedError(FieldCode.Error, "云雾接口没有返回 task_id");
    }
    taskIds.push(taskId);
  }

  return taskIds;
}

async function createDirectImages(
  params: ReturnType<typeof normalizeParams>,
  imageUrls: string[],
  context: ExecuteContext
) {
  const requestUrl = `${YUNWU_API_BASE_URL}${YUNWU_GENERATIONS_ENDPOINT}`;
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: params.imageCount,
    size: normalizeDirectSize(params.size)
  };

  if (imageUrls.length > 0) {
    body.image = imageUrls.slice(0, 5);
  }

  const bodyText = JSON.stringify(body);
  logDirectRequest(body, bodyText.length);
  const startedAt = Date.now();

  const response = await fetchWithNetworkRetry(
    context.fetch,
    requestUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: bodyText
    },
    YUNWU_AUTH_ID,
    "createDirectImages"
  );

  console.log(
    JSON.stringify({
      type: "yunwu_direct_response",
      logID: context.logID,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt
    })
  );
  await assertProviderResponse(response, "createDirectImages", requestUrl);
  const payload = await response.json();
  const urls = extractDirectImageUrls(payload);
  if (urls.length === 0) {
    throw new FieldMappedError(FieldCode.Error, "云雾接口没有返回图片 URL");
  }

  return urls.map((url: string, index: number) => ({
    sourceId: "direct",
    url,
    index,
    model: params.model
  }));
}

async function fetchWithNetworkRetry(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  authorizationId: string,
  phase: string
) {
  const maxAttempts = 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchImpl(url, init, authorizationId);
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= maxAttempts) {
        throw error;
      }
      console.log(
        JSON.stringify({
          type: "yunwu_network_retry",
          phase,
          attempt,
          message: error instanceof Error ? error.message : String(error)
        })
      );
      await sleep(1200);
    }
  }

  throw lastError;
}

async function createTaskImages(
  params: ReturnType<typeof normalizeParams>,
  imageUrls: string[],
  fetchImpl: FetchLike,
  runtimeOptions: RuntimeOptions
) {
  const taskIds = await createTasks(params, imageUrls, fetchImpl);
  return pollTasks(taskIds, fetchImpl, runtimeOptions);
}

async function pollTasks(taskIds: string[], fetchImpl: FetchLike, runtimeOptions: RuntimeOptions) {
  const imageUrls: GeneratedImageUrl[] = [];

  for (const taskId of taskIds) {
    const taskUrls = await pollTask(taskId, fetchImpl, runtimeOptions);
    imageUrls.push(...taskUrls.map((url, index) => ({ sourceId: taskId, url, index, model: TASK_MODEL })));
  }

  return imageUrls;
}

async function pollTask(taskId: string, fetchImpl: FetchLike, runtimeOptions: RuntimeOptions) {
  const initialDelay = runtimeOptions.initialPollDelayMs ?? INITIAL_POLL_DELAY_MS;
  const pollInterval = runtimeOptions.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeout = runtimeOptions.taskTimeoutMs ?? TASK_TIMEOUT_MS;
  const deadline = Date.now() + timeout;

  await sleep(initialDelay);

  while (Date.now() <= deadline) {
    const response = await fetchImpl(`${YUNWU_API_BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET"
    });
    await assertProviderResponse(response, "pollTask", taskId);

    const payload = await response.json();
    const data = payload?.data ?? payload;
    const status = String(data?.status ?? "").toLowerCase();

    if (status === "completed") {
      const urls = extractImageUrls(data);
      if (urls.length === 0) {
        throw new FieldMappedError(FieldCode.Error, `任务 ${taskId} 完成但没有返回图片 URL`);
      }
      return urls;
    }

    if (status === "failed") {
      const message = data?.error?.message ?? data?.message ?? `任务 ${taskId} 生成失败`;
      throw new FieldMappedError(FieldCode.Error, String(message));
    }

    await sleep(pollInterval);
  }

  throw new FieldMappedError(FieldCode.Error, `任务 ${taskId} 轮询超时`);
}

async function assertProviderResponse(response: Response, phase: string, target: string) {
  if (response.ok) {
    return;
  }

  const message = await parseProviderError(response);
  console.log(
    JSON.stringify({
      type: "yunwu_provider_error",
      phase,
      target,
      status: response.status,
      message
    })
  );
  throw new FieldMappedError(mapStatusToFieldCode(response.status), `云雾接口调用失败：${message}`);
}

async function parseProviderError(response: Response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    return payload?.error?.message ?? payload?.message ?? text;
  } catch {
    return text || response.statusText;
  }
}

function mapStatusToFieldCode(status: number) {
  if (status === 401 || status === 403) {
    return FieldCode.AuthorizationError;
  }
  if (status === 402) {
    return FieldCode.QuotaExhausted;
  }
  if (status === 429) {
    return FieldCode.RateLimit;
  }
  if (status >= 400 && status < 500) {
    return FieldCode.InvalidArgument;
  }
  return FieldCode.Error;
}

function extractTaskId(payload: any) {
  if (typeof payload?.data?.task_id === "string") {
    return payload.data.task_id;
  }
  if (Array.isArray(payload?.data) && typeof payload.data[0]?.task_id === "string") {
    return payload.data[0].task_id;
  }
  return null;
}

function extractImageUrls(data: any) {
  const images = data?.result?.images;
  if (!Array.isArray(images)) {
    return [];
  }

  return images.flatMap((image) => {
    if (Array.isArray(image?.url)) {
      return image.url.filter((url: unknown): url is string => typeof url === "string" && url.length > 0);
    }
    return typeof image?.url === "string" ? [image.url] : [];
  });
}

function extractDirectImageUrls(payload: any) {
  if (!Array.isArray(payload?.data)) {
    return [];
  }

  return payload.data
    .map((image: any) => image?.url)
    .filter((url: unknown): url is string => typeof url === "string" && url.length > 0);
}

function normalizeDirectSize(size: string) {
  if (/^(1024x1024|1536x1024|1024x1536)$/i.test(size)) {
    return size.toLowerCase();
  }
  if (size === "custom") {
    return "1024x1024";
  }

  const [width, height] = size.split(":").map((value) => Number.parseFloat(value));
  if (Number.isFinite(width) && Number.isFinite(height)) {
    if (width > height) {
      return "1536x1024";
    }
    if (height > width) {
      return "1024x1536";
    }
  }

  return "1024x1024";
}

function toAttachment(
  url: string,
  sourceId: string,
  index: number,
  outputFormat: string,
  model: string
): GeneratedAttachment {
  return {
    name: `${sanitizeFilePart(model)}-${sanitizeFilePart(sourceId)}-${index + 1}.${outputFormat}`,
    content: url,
    contentType: "attachment/url"
  };
}

function inferMimeType(name = "") {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerName.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/png";
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^\w.-]+/g, "_");
}

function isTransientNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network timeout/i.test(message);
}

function logDirectRequest(body: Record<string, unknown>, bodyLength: number) {
  const images = Array.isArray(body.image) ? body.image : [];
  console.log(
    JSON.stringify({
      type: "yunwu_direct_request",
      model: body.model,
      size: body.size,
      n: body.n,
      bodyLength,
      imageMode: images.length > 0 ? "url" : "none",
      imageCount: images.length,
      imageHosts: images.map((url) => hostFromUrl(String(url)))
    })
  );
}

function hostFromUrl(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withLogId(message: string, logID?: string) {
  return logID ? `${message} (logID: ${logID})` : message;
}

function debugLog(context: ExecuteContext, event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      type: "generate_image_img",
      event,
      logID: context.logID,
      ...data
    })
  );
}

function redactParamsForLog(params: ExecuteParams) {
  return {
    promptLength: String(params.prompt ?? "").length,
    model: selectToString(params.model, DEFAULT_MODEL),
    referenceImageCount: normalizeReferenceImages(params.referenceImages).length,
    size: selectToString(params.size, DEFAULT_SIZE),
    customSize: params.customSize,
    resolution: selectToString(params.resolution, DEFAULT_RESOLUTION),
    imageCount: params.imageCount,
    outputFormat: selectToString(params.outputFormat, DEFAULT_OUTPUT_FORMAT),
    officialFallback: params.officialFallback
  };
}
