import { describe, expect, it, vi } from "vitest";
import { FieldCode } from "@lark-opdev/block-basekit-server-api";
import { executeImageGeneration } from "../src/imageClient";
import { YUNWU_AUTH_ID } from "../src/constants";

const pngBytes = Buffer.from("fake image");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeContext(fetchImpl: any, logID = "log_test") {
  return {
    logID,
    fetch: fetchImpl
  };
}

describe("executeImageGeneration", () => {
  it("serializes prompt and generation options into the Yunwu task request", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: [{ task_id: "task_1" }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 200,
          data: {
            id: "task_1",
            status: "completed",
            result: { images: [{ url: ["https://yunwu.ai/result/task_1.png"] }] }
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "生成一张产品海报",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [],
        size: { value: "16:9", label: "16:9" },
        customSize: "",
        resolution: { value: "4k", label: "4K" },
        imageCount: "1",
        outputFormat: { value: "webp", label: "webp" },
        officialFallback: { value: "true", label: "是" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://yunwu.ai/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: "生成一张产品海报",
          n: 1,
          size: "16:9",
          resolution: "4k",
          output_format: "webp",
          official_fallback: true
        })
      }),
      YUNWU_AUTH_ID
    );
  });

  it("uses the direct gpt-image-2-all API without task polling", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        created: 1710000000,
        data: [{ revised_prompt: "一张海报", url: "https://yunwu.ai/result/all.png" }]
      })
    );

    const result = await executeImageGeneration(
      {
        prompt: "生成一张产品海报",
        model: { value: "gpt-image-2-all", label: "gpt-image-2-all" },
        referenceImages: [],
        size: { value: "16:9", label: "16:9" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          name: "gpt-image-2-all-direct-1.png",
          content: "https://yunwu.ai/result/all.png",
          contentType: "attachment/url"
        }
      ]
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://yunwu.ai/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "gpt-image-2-all",
          prompt: "生成一张产品海报",
          n: 1,
          size: "1536x1024"
        })
      }),
      YUNWU_AUTH_ID
    );
  });

  it("logs the direct provider response and completed execution", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://yunwu.ai/result/logged.png" }]
      })
    );

    const result = await executeImageGeneration(
      {
        prompt: "记录耗时",
        model: { value: "gpt-image-2-all", label: "gpt-image-2-all" },
        referenceImages: [],
        imageCount: "1"
      },
      makeContext(fetchImpl, "log_diagnostics")
    );

    const logs = logSpy.mock.calls.map(([entry]) => String(entry));
    logSpy.mockRestore();

    expect(result.code).toBe(FieldCode.Success);
    expect(logs.some((entry) => entry.includes('"type":"yunwu_direct_response"'))).toBe(true);
    expect(logs.some((entry) => entry.includes('"event":"complete"') && entry.includes('"logID":"log_diagnostics"'))).toBe(
      true
    );
  });

  it("sends reference image URLs directly in the gpt-image-2-all image field", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          created: 1710000000,
          data: [{ url: "https://yunwu.ai/result/ref-all.png" }]
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "融合参考图",
        model: { value: "gpt-image-2-all", label: "gpt-image-2-all" },
        referenceImages: [
          { name: "a.png", type: "image/png", tmp_url: "https://feishu.cn/a.png" },
          { name: "b.jpg", type: "image/jpeg", tmp_url: "https://feishu.cn/b.jpg" }
        ],
        size: { value: "9:16", label: "9:16" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result.code).toBe(FieldCode.Success);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.size).toBe("1024x1536");
    expect(body.image).toEqual([
      "https://feishu.cn/a.png",
      "https://feishu.cn/b.jpg"
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries transient socket hang ups for the direct model", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("request to https://yunwu.ai/v1/images/generations failed, reason: socket hang up"))
      .mockResolvedValueOnce(
        jsonResponse({
          created: 1710000000,
          data: [{ url: "https://yunwu.ai/result/retry.png" }]
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "重试测试",
        model: { value: "gpt-image-2-all", label: "gpt-image-2-all" },
        referenceImages: [{ name: "a.png", type: "image/png", tmp_url: "https://feishu.cn/a.png" }],
        size: { value: "16:9", label: "16:9" },
        imageCount: "1"
      },
      makeContext(fetchImpl)
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("downloads single and multiple attachment inputs as base64 data URIs", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(pngBytes))
      .mockResolvedValueOnce(new Response(pngBytes))
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: [{ task_id: "task_ref" }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 200,
          data: {
            id: "task_ref",
            status: "completed",
            result: { images: [{ url: ["https://yunwu.ai/result/ref.png"] }] }
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "把参考图融合成插画",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [
          { name: "a.png", type: "image/png", tmp_url: "https://feishu.cn/a.png" },
          { name: "b.jpg", mimeType: "image/jpeg", tmp_url: "https://feishu.cn/b.jpg" }
        ],
        size: { value: "custom", label: "custom" },
        customSize: "2048x1152",
        resolution: { value: "2k", label: "2K" },
        imageCount: 1,
        outputFormat: { value: "png", label: "png" },
        officialFallback: { value: "false", label: "否" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.Success);
    const taskBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(taskBody.size).toBe("2048x1152");
    expect(taskBody.image_urls).toEqual([
      `data:image/png;base64,${pngBytes.toString("base64")}`,
      `data:image/jpeg;base64,${pngBytes.toString("base64")}`
    ]);
  });

  it("creates multiple tasks when the requested image count is greater than one", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: [{ task_id: "task_1" }] }))
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: [{ task_id: "task_2" }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 200,
          data: {
            id: "task_1",
            status: "completed",
            result: { images: [{ url: ["https://yunwu.ai/result/1.png"] }] }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 200,
          data: {
            id: "task_2",
            status: "completed",
            result: { images: [{ url: ["https://yunwu.ai/result/2.png"] }] }
          }
        })
      );

    const result = await executeImageGeneration(
      {
        prompt: "四宫格变体",
        model: { value: "gpt-image-2", label: "gpt-image-2" },
        referenceImages: [],
        size: { value: "1:1", label: "1:1" },
        customSize: "",
        resolution: { value: "1k", label: "1K" },
        imageCount: 2,
        outputFormat: { value: "png", label: "png" },
        officialFallback: { value: "false", label: "否" }
      },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result).toEqual({
      code: FieldCode.Success,
      data: [
        {
          name: "gpt-image-2-task_1-1.png",
          content: "https://yunwu.ai/result/1.png",
          contentType: "attachment/url"
        },
        {
          name: "gpt-image-2-task_2-1.png",
          content: "https://yunwu.ai/result/2.png",
          contentType: "attachment/url"
        }
      ]
    });
  });

  it("maps validation failures and provider errors to field codes", async () => {
    const invalidPrompt = await executeImageGeneration(
      { prompt: "   ", imageCount: 1, referenceImages: [] },
      makeContext(vi.fn())
    );
    expect(invalidPrompt.code).toBe(FieldCode.ConfigError);

    const unauthorizedFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ error: { message: "bad key" } }, 401));
    const unauthorized = await executeImageGeneration(
      { prompt: "test", imageCount: 1, referenceImages: [] },
      makeContext(unauthorizedFetch),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );
    expect(unauthorized.code).toBe(FieldCode.AuthorizationError);

    const rateLimitedFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ message: "too many" }, 429));
    const rateLimited = await executeImageGeneration(
      { prompt: "test", imageCount: 1, referenceImages: [] },
      makeContext(rateLimitedFetch),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );
    expect(rateLimited.code).toBe(FieldCode.RateLimit);

    const quotaFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ message: "insufficient balance" }, 402));
    const quota = await executeImageGeneration(
      { prompt: "test", imageCount: 1, referenceImages: [] },
      makeContext(quotaFetch),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );
    expect(quota.code).toBe(FieldCode.QuotaExhausted);
  });

  it("maps failed tasks and timeouts to generic field errors with log IDs", async () => {
    const failedTaskFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: [{ task_id: "task_failed" }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 200,
          data: {
            id: "task_failed",
            status: "failed",
            error: { message: "content rejected" }
          }
        })
      );

    const failedTask = await executeImageGeneration(
      { prompt: "test", model: { value: "gpt-image-2", label: "gpt-image-2" }, imageCount: 1, referenceImages: [] },
      makeContext(failedTaskFetch, "log_failed"),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );
    expect(failedTask.code).toBe(FieldCode.Error);
    expect(failedTask.msg).toContain("content rejected");
    expect(failedTask.msg).toContain("log_failed");

    const timeoutFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ code: 200, data: [{ task_id: "task_slow" }] }));
    const timeout = await executeImageGeneration(
      { prompt: "test", model: { value: "gpt-image-2", label: "gpt-image-2" }, imageCount: 1, referenceImages: [] },
      makeContext(timeoutFetch, "log_timeout"),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: -1 }
    );
    expect(timeout.code).toBe(FieldCode.Error);
    expect(timeout.msg).toContain("轮询超时");
    expect(timeout.msg).toContain("log_timeout");
  });

  it("caps attachment output at the Feishu field limit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: [{ task_id: "task_many" }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 200,
          data: {
            id: "task_many",
            status: "completed",
            result: {
              images: [
                {
                  url: [
                    "https://yunwu.ai/result/1.png",
                    "https://yunwu.ai/result/2.png",
                    "https://yunwu.ai/result/3.png",
                    "https://yunwu.ai/result/4.png",
                    "https://yunwu.ai/result/5.png",
                    "https://yunwu.ai/result/6.png"
                  ]
                }
              ]
            }
          }
        })
      );

    const result = await executeImageGeneration(
      { prompt: "test", model: { value: "gpt-image-2", label: "gpt-image-2" }, imageCount: 1, referenceImages: [] },
      makeContext(fetchImpl),
      { initialPollDelayMs: 0, pollIntervalMs: 0, taskTimeoutMs: 100 }
    );

    expect(result.code).toBe(FieldCode.Success);
    expect(result.data).toHaveLength(5);
  });
});
