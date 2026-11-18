import { parseFixedDecimal } from "@/domain/primitives";
import { z } from "zod";

const decimalSchema = z.string().regex(/^\d+(?:\.\d{1,8})?$/);
const integerStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((value) => BigInt(value) <= (BigInt(1) << BigInt(63)) - BigInt(1));

const feeScheduleSchema = z.strictObject({
  minimumMinor: integerStringSchema,
  fixedMinor: integerStringSchema,
  perShareMinor: integerStringSchema,
});

export const paperCostModelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().trim().min(1).max(64),
  marketCode: z.enum(["JP", "US"]),
  currencyCode: z.enum(["JPY", "USD"]),
  validFromMs: z.number().int().nonnegative().safe(),
  validUntilMs: z.number().int().nonnegative().safe(),
  tickSize: decimalSchema,
  entrySlippageBps: z.number().int().nonnegative().safe(),
  maxParticipationBps: z.number().int().min(1).max(10_000).safe().optional(),
  stopSlippageBps: z.number().int().nonnegative().safe(),
  gapReserveBps: z.number().int().nonnegative().safe(),
  fxShockBps: z.number().int().nonnegative().safe(),
  fxConversionFeeBps: z.number().int().nonnegative().safe(),
  entryFee: feeScheduleSchema,
  exitFee: feeScheduleSchema,
});

export type PaperCostModel = z.infer<typeof paperCostModelSchema>;

export function priceAtoms(value: string) {
  const decimal = parseFixedDecimal(value);
  return decimal.mantissa * BigInt(10) ** BigInt(8 - decimal.scale);
}

export function feeMinor(schedule: PaperCostModel["entryFee"], shares: bigint) {
  if (shares === BigInt(0)) return BigInt(0);
  const variable =
    BigInt(schedule.fixedMinor) + BigInt(schedule.perShareMinor) * shares;
  const minimum = BigInt(schedule.minimumMinor);
  return minimum > variable ? minimum : variable;
}
