import { afterEach, describe, expect, it, vi } from "vitest";

import { marketDateAt } from "@/domain/primitives";
import { eodhdUsDailyProvider, EodhdError } from "./eodhd";

afterEach(() => vi.unstubAllGlobals());

function csv(date = marketDateAt(Date.now(), "US")) {
  // Synthetic parser fixture only; it is never presented as market data.
  return `Date,Open,High,Low,Close,Adjusted_close,Volume\n${date},10.00,12.00,9.00,11.50,11.50,1000`;
}

describe("EODHD US daily provider", () => {
  it("requests only one US daily symbol and parses raw OHLCV precisely", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(csv(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await eodhdUsDailyProvider.fetchDailyBars({
      symbol: "AAPL",
      from: marketDateAt(Date.now(), "US"),
      to: marketDateAt(Date.now(), "US"),
      token: "private-test-token",
    });
    const url = fetchMock.mock.calls[0][0] as URL;

    expect(url.pathname).toBe("/api/eod/AAPL.US");
    expect(url.searchParams.get("period")).toBe("d");
    expect(url.searchParams.get("fmt")).toBe("csv");
    expect(url.searchParams.get("api_token")).toBe("private-test-token");
    expect(result.bars).toMatchObject([
      { tradingDate: marketDateAt(Date.now(), "US"), priceScale: 2 },
    ]);
    expect(result.bars[0].closeMantissa).toBe(BigInt(1150));
    expect(result.bars[0].volumeShares).toBe(BigInt(1000));
  });

  it("rejects an OHLC-inconsistent provider response without exposing credentials", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          `Date,Open,High,Low,Close,Volume\n${marketDateAt(Date.now(), "US")},10,9,8,8.5,100`,
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const rejected = await eodhdUsDailyProvider
      .fetchDailyBars({
        symbol: "AAPL",
        from: marketDateAt(Date.now(), "US"),
        to: marketDateAt(Date.now(), "US"),
        token: "private-test-token",
      })
      .catch((error: unknown) => error);
    expect(rejected).toMatchObject({ code: "INVALID_RESPONSE" });
    expect(rejected).toHaveProperty("message", "INVALID_RESPONSE");
    expect(String(rejected)).not.toContain("private-test-token");
  });

  it("maps an unauthenticated response to a sanitized credential error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("secret", { status: 401 })),
    );

    await expect(
      eodhdUsDailyProvider.fetchDailyBars({
        symbol: "AAPL",
        from: "2026-01-01",
        to: "2026-01-02",
        token: "private-test-token",
      }),
    ).rejects.toBeInstanceOf(EodhdError);
    await expect(
      eodhdUsDailyProvider.fetchDailyBars({
        symbol: "AAPL",
        from: "2026-01-01",
        to: "2026-01-02",
        token: "private-test-token",
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_REJECTED" });
  });

  it("keeps a valid but unentitled API key distinct from an invalid symbol", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("secret", { status: 403 })),
    );

    await expect(
      eodhdUsDailyProvider.fetchDailyBars({
        symbol: "AAPL",
        from: "2026-01-01",
        to: "2026-01-02",
        token: "private-test-token",
      }),
    ).rejects.toMatchObject({ code: "ACCESS_NOT_ENTITLED" });
  });
});
