import { sql } from "drizzle-orm";
import { check, customType, sqliteTable, text } from "drizzle-orm/sqlite-core";

const sqliteInt64 = customType<{ data: bigint; driverData: bigint }>({
  dataType: () => "integer",
});
const sqliteSmallInteger = customType<{
  data: number;
  driverData: bigint | number;
}>({
  dataType: () => "integer",
  toDriver: (value) => {
    if (!Number.isSafeInteger(value))
      throw new RangeError("sqlite_small_integer_out_of_range");
    return BigInt(value);
  },
  fromDriver: (value) => {
    const result = Number(value);
    if (!Number.isSafeInteger(result))
      throw new RangeError("sqlite_small_integer_out_of_range");
    return result;
  },
});

export const precisionRecords = sqliteTable(
  "precision_records",
  {
    id: text("id").primaryKey(),
    jpyMinor: sqliteInt64("jpy_minor").notNull(),
    usdMinor: sqliteInt64("usd_minor").notNull(),
    usdJpyMantissa: sqliteInt64("usd_jpy_mantissa").notNull(),
    usdJpyScale: sqliteSmallInteger("usd_jpy_scale").notNull(),
    priceMantissa: sqliteInt64("price_mantissa").notNull(),
    priceScale: sqliteSmallInteger("price_scale").notNull(),
    shareQuantity: sqliteInt64("share_quantity").notNull(),
  },
  (table) => [
    check(
      "precision_records_usd_jpy_scale",
      sql`${table.usdJpyScale} BETWEEN 0 AND 8`,
    ),
    check("precision_records_price_mantissa", sql`${table.priceMantissa} > 0`),
    check(
      "precision_records_price_scale",
      sql`${table.priceScale} BETWEEN 0 AND 8`,
    ),
    check("precision_records_share_quantity", sql`${table.shareQuantity} > 0`),
  ],
);
