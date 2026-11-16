import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { errorResponse, successResponse } from "./errors";
import { parseJsonRequest } from "./request";

afterEach(() => vi.restoreAllMocks());

function jsonRequest(body: string, contentType = "application/json") {
  return new Request("http://127.0.0.1:3000/api/v1/test", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("API request boundaries", () => {
  it("parses only the output of the supplied strict schema", async () => {
    const schema = z.strictObject({ count: z.number().int().min(1) });

    await expect(
      parseJsonRequest(jsonRequest('{"count":2}'), schema),
    ).resolves.toEqual({
      count: 2,
    });

    const error = await parseJsonRequest(
      jsonRequest('{"count":2,"apiKey":"sentinel-secret"}'),
      schema,
    ).catch((caught: unknown) => caught);
    const response = errorResponse(error);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).not.toContain("apiKey");
    expect(body).not.toContain("sentinel-secret");
    expect(body).toContain("UNKNOWN_KEY");
  });

  it("rejects malformed JSON and unsupported content types without echoing input", async () => {
    const schema = z.strictObject({ value: z.string() });
    const malformed = await parseJsonRequest(
      jsonRequest('{"value":"private-marker"'),
      schema,
    ).catch((caught: unknown) => caught);
    const malformedResponse = errorResponse(malformed);
    const malformedBody = await malformedResponse.text();

    expect(malformedResponse.status).toBe(400);
    expect(malformedBody).not.toContain("private-marker");
    await expect(
      parseJsonRequest(jsonRequest("{}", "text/plain"), schema),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("rejects JSON bodies larger than 64 KiB", async () => {
    await expect(
      parseJsonRequest(
        jsonRequest(`{"value":"${"x".repeat(65_537)}"}`),
        z.unknown(),
      ),
    ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
  });
});

describe("API responses", () => {
  it("adds no-store and a server-generated request ID to success envelopes", async () => {
    const response = successResponse({ status: "offline" });
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe(body.meta.requestId);
    expect(body.data).toEqual({ status: "offline" });
  });

  it("returns a generic error and logs no exception text or secret", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const response = errorResponse(new Error("API_KEY=sentinel-secret"));
    const body = await response.text();
    const logged = consoleError.mock.calls
      .map(([value]) => String(value))
      .join(" ");

    expect(response.status).toBe(500);
    expect(body).not.toContain("sentinel-secret");
    expect(logged).not.toContain("sentinel-secret");
    expect(logged).toContain("INTERNAL_ERROR");
  });

  it("redacts secret field names from validation paths", async () => {
    const schema = z.strictObject({ apiKey: z.string().min(8) });
    const error = await parseJsonRequest(
      jsonRequest('{"apiKey":"short"}'),
      schema,
    ).catch((caught: unknown) => caught);
    const body = await errorResponse(error).text();

    expect(body).not.toContain("apiKey");
    expect(body).not.toContain("short");
    expect(body).toContain("[redacted]");
  });
});
