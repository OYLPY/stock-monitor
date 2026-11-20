import { randomUUID } from "node:crypto";
import { logInternalApiError } from "../security/logging.ts";

export type ApiValidationDetail = Readonly<{
  path: string;
  code: string;
}>;

const API_ERRORS = {
  VALIDATION_FAILED: { status: 400, message: "请求参数无效" },
  INVALID_JSON: { status: 400, message: "JSON 格式无效" },
  REQUEST_TOO_LARGE: { status: 413, message: "请求体超过大小限制" },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "请求类型不受支持" },
  LOCAL_ORIGIN_REQUIRED: { status: 403, message: "请求来源无效" },
  MARKET_DATA_NOT_CONFIGURED: {
    status: 503,
    message: "尚未配置本机行情来源凭据。",
  },
  MARKET_DATA_DAILY_LIMIT: {
    status: 429,
    message: "本机今日免费行情请求额度已用完。",
  },
  MARKET_DATA_CREDENTIAL_REJECTED: {
    status: 502,
    message: "行情来源未接受本机凭据。",
  },
  MARKET_DATA_ACCESS_NOT_ENTITLED: {
    status: 403,
    message: "当前行情凭据或计划无权访问该证券。",
  },
  MARKET_DATA_SYMBOL_UNAVAILABLE: {
    status: 422,
    message: "行情来源没有返回该证券的可用日线。",
  },
  MARKET_DATA_INVALID_RESPONSE: {
    status: 502,
    message: "行情来源返回的数据无法通过校验。",
  },
  MARKET_DATA_UNAVAILABLE: {
    status: 503,
    message: "行情来源暂时不可用；本机保留已有数据。",
  },
  BACKUP_FAILED: {
    status: 500,
    message: "本机数据库备份失败，请检查磁盘空间和目录权限。",
  },
  INTERNAL_ERROR: { status: 500, message: "系统暂时无法处理请求" },
} as const;

export type ApiErrorCode = keyof typeof API_ERRORS;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: readonly ApiValidationDetail[];

  constructor(
    code: ApiErrorCode,
    details: readonly ApiValidationDetail[] = [],
  ) {
    super(API_ERRORS[code].message);
    this.code = code;
    this.details = details;
    this.name = "ApiError";
  }
}

function jsonResponse(body: unknown, status: number, requestId: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": requestId,
    },
  });
}

export function successResponse(data: unknown, status = 200): Response {
  const requestId = randomUUID();
  return jsonResponse({ data, meta: { requestId } }, status, requestId);
}

export function errorResponse(cause: unknown): Response {
  const requestId = randomUUID();
  const error =
    cause instanceof ApiError ? cause : new ApiError("INTERNAL_ERROR");

  if (error.code === "INTERNAL_ERROR" || error.code === "BACKUP_FAILED") {
    logInternalApiError(requestId, error.code);
  }

  return jsonResponse(
    {
      error: {
        code: error.code,
        message: API_ERRORS[error.code].message,
        details:
          error.code === "VALIDATION_FAILED" ? error.details.slice(0, 20) : [],
        retryable: false,
      },
      requestId,
    },
    API_ERRORS[error.code].status,
    requestId,
  );
}
