import { describe, expect, it } from "vitest";
import {
  convertMoney,
  instrumentCompositeKey,
  marketDateAt,
  marketDateTimeAt,
  moneyFromDecimal,
  parseFixedDecimal,
  parseFxRate,
} from "@/domain/primitives";

describe("domain primitives", () => {
  it("maps UTC instants through New York daylight-saving changes", () => {
    expect(
      marketDateTimeAt(Date.parse("2026-03-08T06:30:00.000Z"), "US"),
    ).toEqual({
      instantMs: Date.parse("2026-03-08T06:30:00.000Z"),
      market: "US",
      timeZone: "America/New_York",
      localDate: "2026-03-08",
      localTime: "01:30:00.000",
    });
    expect(
      marketDateTimeAt(Date.parse("2026-03-08T07:30:00.000Z"), "US").localTime,
    ).toBe("03:30:00.000");
  });

  it("preserves distinct instants during the repeated New York fall-back hour", () => {
    const first = marketDateTimeAt(
      Date.parse("2026-11-01T05:30:00.000Z"),
      "US",
    );
    const second = marketDateTimeAt(
      Date.parse("2026-11-01T06:30:00.000Z"),
      "US",
    );

    expect(first.localTime).toBe("01:30:00.000");
    expect(second.localTime).toBe(first.localTime);
    expect(first.instantMs).not.toBe(second.instantMs);
  });

  it("maps UTC instants to market local dates without claiming a session", () => {
    const instant = Date.parse("2026-01-01T01:00:00.000Z");

    expect(marketDateAt(instant, "US")).toBe("2025-12-31");
    expect(marketDateAt(instant, "JP")).toBe("2026-01-01");
  });

  it("rounds decimal amounts to JPY and USD minor units explicitly", () => {
    expect(moneyFromDecimal("123.1", "JPY", "CEIL")).toEqual({
      amountMinor: BigInt(124),
      currency: "JPY",
    });
    expect(moneyFromDecimal("123.1", "JPY", "FLOOR").amountMinor).toBe(
      BigInt(123),
    );
    expect(moneyFromDecimal("-123.1", "JPY", "CEIL").amountMinor).toBe(
      BigInt(-123),
    );
    expect(moneyFromDecimal("-123.1", "JPY", "FLOOR").amountMinor).toBe(
      BigInt(-124),
    );
    expect(
      moneyFromDecimal("12.345", "USD", "HALF_AWAY_FROM_ZERO").amountMinor,
    ).toBe(BigInt(1235));
    expect(
      moneyFromDecimal("-12.345", "USD", "HALF_AWAY_FROM_ZERO").amountMinor,
    ).toBe(BigInt(-1235));
  });

  it("preserves integral yen exactly across rounding modes", () => {
    for (let amount = -100; amount <= 100; amount += 1) {
      for (const rounding of [
        "CEIL",
        "FLOOR",
        "HALF_AWAY_FROM_ZERO",
      ] as const) {
        expect(
          moneyFromDecimal(String(amount), "JPY", rounding).amountMinor,
        ).toBe(BigInt(amount));
      }
    }
  });

  it("converts money using explicit base and quote currency units", () => {
    const usdJpy = parseFxRate("USD", "JPY", "150.25");
    const usd = moneyFromDecimal("1.00", "USD", "HALF_AWAY_FROM_ZERO");

    expect(convertMoney(usd, usdJpy, "CEIL")).toEqual({
      amountMinor: BigInt(151),
      currency: "JPY",
    });
    expect(convertMoney(usd, usdJpy, "FLOOR").amountMinor).toBe(BigInt(150));

    const jpyUsd = parseFxRate("JPY", "USD", "0.0067");
    const oneYen = moneyFromDecimal("1", "JPY", "HALF_AWAY_FROM_ZERO");
    expect(
      convertMoney(oneYen, jpyUsd, "HALF_AWAY_FROM_ZERO").amountMinor,
    ).toBe(BigInt(1));
  });

  it("keeps instrument identifiers distinct by market and exchange", () => {
    const nyse = instrumentCompositeKey({
      market: "US",
      exchangeCode: "xnys",
      symbol: " aapl ",
    });
    const nasdaq = instrumentCompositeKey({
      market: "US",
      exchangeCode: "XNAS",
      symbol: "AAPL",
    });

    expect(nyse).toBe(
      instrumentCompositeKey({
        market: "US",
        exchangeCode: "XNYS",
        symbol: "AAPL",
      }),
    );
    expect(nyse).not.toBe(nasdaq);
    expect(
      instrumentCompositeKey({
        market: "JP",
        exchangeCode: "XTKS",
        symbol: "7203",
      }),
    ).not.toBe(
      instrumentCompositeKey({
        market: "US",
        exchangeCode: "XTKS",
        symbol: "7203",
      }),
    );
  });

  it("rejects unsupported precision, invalid rates, and unsafe instants", () => {
    expect(() => parseFixedDecimal("1e3")).toThrow("invalid_decimal");
    expect(() => parseFixedDecimal("1.000000001")).toThrow(
      "invalid_decimal_scale",
    );
    expect(() => parseFxRate("USD", "JPY", "0")).toThrow("invalid_fx_rate");
    expect(() => parseFxRate("USD", "USD", "1")).toThrow(
      "fx_currencies_must_differ",
    );
    const usd = moneyFromDecimal("1", "USD", "HALF_AWAY_FROM_ZERO");
    const validRate = parseFxRate("USD", "JPY", "150");
    expect(() =>
      convertMoney(usd, { ...validRate, mantissa: BigInt(0) }, "CEIL"),
    ).toThrow("invalid_fx_rate");
    expect(() =>
      convertMoney(usd, { ...validRate, scale: -1 }, "CEIL"),
    ).toThrow("invalid_decimal_scale");
    expect(() =>
      convertMoney(usd, { ...validRate, quoteCurrency: "USD" }, "CEIL"),
    ).toThrow("fx_currencies_must_differ");
    expect(() =>
      convertMoney(
        moneyFromDecimal("1", "JPY", "HALF_AWAY_FROM_ZERO"),
        parseFxRate("USD", "JPY", "150"),
        "CEIL",
      ),
    ).toThrow("fx_base_currency_mismatch");
    expect(() => marketDateAt(Number.NaN, "US")).toThrow("invalid_instant");
    expect(() =>
      instrumentCompositeKey({
        market: "US",
        exchangeCode: " ",
        symbol: "AAPL",
      }),
    ).toThrow("invalid_instrument_identifier");
  });
});
