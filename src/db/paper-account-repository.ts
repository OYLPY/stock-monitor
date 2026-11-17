import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { AppDatabase } from "./index";
import { withTransaction } from "./index";
import {
  cashLedgerEntries,
  initialCapitalConfigs,
  ledgerEvents,
  paperAccounts,
} from "./schema";

export function listPaperAccountLedger(database: AppDatabase) {
  const account = database.orm
    .select({
      id: paperAccounts.id,
      baseCurrency: paperAccounts.baseCurrency,
      initializedAtMs: paperAccounts.initializedAtMs,
    })
    .from(paperAccounts)
    .where(eq(paperAccounts.accountKey, "local-default"))
    .get();

  if (!account) return null;

  const entries = database.orm
    .select({
      eventId: ledgerEvents.id,
      sequenceNo: ledgerEvents.sequenceNo,
      eventType: ledgerEvents.eventType,
      effectiveAtMs: ledgerEvents.effectiveAtMs,
      recordedAtMs: ledgerEvents.recordedAtMs,
      cashEntryId: cashLedgerEntries.id,
      bucket: cashLedgerEntries.bucket,
      currencyCode: cashLedgerEntries.currencyCode,
      currencyScale: cashLedgerEntries.currencyScale,
      amountMinor: cashLedgerEntries.amountMinor,
    })
    .from(ledgerEvents)
    .leftJoin(
      cashLedgerEntries,
      eq(cashLedgerEntries.ledgerEventId, ledgerEvents.id),
    )
    .where(eq(ledgerEvents.accountId, account.id))
    .orderBy(
      asc(ledgerEvents.sequenceNo),
      asc(ledgerEvents.effectiveAtMs),
      asc(cashLedgerEntries.id),
    )
    .all();

  return { account, entries };
}

export function initializeDefaultPaperAccount(database: AppDatabase) {
  return withTransaction(database, () => {
    const existing = database.orm
      .select({ id: paperAccounts.id })
      .from(paperAccounts)
      .where(eq(paperAccounts.accountKey, "local-default"))
      .get();
    if (existing) throw new Error("paper_account_already_initialized");

    const capital = database.orm
      .select()
      .from(initialCapitalConfigs)
      .where(eq(initialCapitalConfigs.version, 1))
      .get();
    if (!capital) throw new Error("initial_capital_config_missing:1");

    const initializedAtMs = BigInt(Date.now());
    const account = {
      id: randomUUID(),
      accountKey: "local-default",
      baseCurrency: capital.currencyCode,
      initialCapitalVersion: capital.version,
      initializedAtMs,
    };
    const eventId = randomUUID();

    database.orm.insert(paperAccounts).values(account).run();
    database.orm
      .insert(ledgerEvents)
      .values({
        id: eventId,
        accountId: account.id,
        sequenceNo: BigInt(1),
        eventType: "ACCOUNT_OPENED",
        idempotencyKey: `account-opening:v${capital.version}`,
        effectiveAtMs: initializedAtMs,
        recordedAtMs: initializedAtMs,
        ruleVersion: "account-opening-v1",
      })
      .run();
    database.orm
      .insert(cashLedgerEntries)
      .values({
        id: randomUUID(),
        ledgerEventId: eventId,
        bucket: "SETTLED",
        currencyCode: capital.currencyCode,
        currencyScale: capital.currencyScale,
        amountMinor: capital.amountMinor,
      })
      .run();

    return account;
  });
}
