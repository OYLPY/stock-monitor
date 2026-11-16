import { describe, expect, it } from "vitest";
import { assertLocalRequest } from "./local-request";

function localRequest(
  method: string,
  headers: Record<string, string> = {},
  url = "http://127.0.0.1:3000/api/v1/test",
) {
  const parsed = new URL(url);
  return new Request(url, {
    method,
    headers: { host: parsed.host, ...headers },
  });
}

describe("local request security", () => {
  it("allows reads on the bound loopback host and same-origin mutations", () => {
    expect(() => assertLocalRequest(localRequest("GET"))).not.toThrow();
    expect(() =>
      assertLocalRequest(
        localRequest("POST", { origin: "http://127.0.0.1:3000" }),
      ),
    ).not.toThrow();
  });

  it("allows localhost and a same-origin Referer when Origin is absent or null", () => {
    expect(() =>
      assertLocalRequest(
        localRequest(
          "POST",
          { origin: "null", referer: "http://localhost:3000/page" },
          "http://localhost:3000/api/v1/test",
        ),
      ),
    ).not.toThrow();
  });

  it("allows Next-normalized localhost URLs for matching loopback host and origin", () => {
    expect(() =>
      assertLocalRequest(
        localRequest(
          "POST",
          {
            host: "127.0.0.1:3005",
            origin: "http://127.0.0.1:3005",
          },
          "http://localhost:3005/api/v1/test",
        ),
      ),
    ).not.toThrow();
  });

  it("rejects non-loopback hosts, host mismatches, and cross-origin mutations", () => {
    expect(() =>
      assertLocalRequest(
        localRequest("GET", {}, "http://attacker.example/api/v1/test"),
      ),
    ).toThrow(expect.objectContaining({ code: "LOCAL_ORIGIN_REQUIRED" }));
    expect(() =>
      assertLocalRequest(localRequest("GET", { host: "attacker.example" })),
    ).toThrow(expect.objectContaining({ code: "LOCAL_ORIGIN_REQUIRED" }));
    expect(() =>
      assertLocalRequest(
        localRequest("POST", { origin: "http://attacker.example" }),
      ),
    ).toThrow(expect.objectContaining({ code: "LOCAL_ORIGIN_REQUIRED" }));
    expect(() =>
      assertLocalRequest(
        localRequest(
          "POST",
          {
            host: "127.0.0.1:3001",
            origin: "http://127.0.0.1:3000",
          },
          "http://localhost:3000/api/v1/test",
        ),
      ),
    ).toThrow(expect.objectContaining({ code: "LOCAL_ORIGIN_REQUIRED" }));
    expect(() => assertLocalRequest(localRequest("POST"))).toThrow(
      expect.objectContaining({ code: "LOCAL_ORIGIN_REQUIRED" }),
    );
    expect(() =>
      assertLocalRequest(
        localRequest("POST", {
          origin: "",
          referer: "http://127.0.0.1:3000/page",
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "LOCAL_ORIGIN_REQUIRED" }));
  });
});
