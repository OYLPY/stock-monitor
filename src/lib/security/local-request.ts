import { ApiError } from "../api/errors";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export function assertLocalRequest(request: Request): void {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new ApiError("LOCAL_ORIGIN_REQUIRED");
  }

  const host = request.headers.get("host")?.trim().toLowerCase();
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    !LOOPBACK_HOSTNAMES.has(url.hostname) ||
    !host ||
    host !== url.host.toLowerCase()
  ) {
    throw new ApiError("LOCAL_ORIGIN_REQUIRED");
  }

  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const origin = request.headers.get("origin");
  const source =
    origin === null || origin === "null"
      ? request.headers.get("referer")
      : origin;
  if (!source) throw new ApiError("LOCAL_ORIGIN_REQUIRED");

  try {
    if (new URL(source).origin !== url.origin) {
      throw new ApiError("LOCAL_ORIGIN_REQUIRED");
    }
  } catch {
    throw new ApiError("LOCAL_ORIGIN_REQUIRED");
  }
}
