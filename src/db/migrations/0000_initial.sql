CREATE TABLE `cash_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_event_id` text NOT NULL,
	`bucket` text NOT NULL,
	`currency_code` text NOT NULL,
	`currency_scale` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	FOREIGN KEY (`ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cash_ledger_entries_bucket" CHECK("cash_ledger_entries"."bucket" IN ('SETTLED', 'UNSETTLED_RECEIVABLE', 'UNSETTLED_PAYABLE')),
	CONSTRAINT "cash_ledger_entries_currency" CHECK(("cash_ledger_entries"."currency_code" = 'JPY' AND "cash_ledger_entries"."currency_scale" = 0) OR ("cash_ledger_entries"."currency_code" = 'USD' AND "cash_ledger_entries"."currency_scale" = 2)),
	CONSTRAINT "cash_ledger_entries_amount" CHECK("cash_ledger_entries"."amount_minor" <> 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `initial_capital_configs` (
	`version` integer PRIMARY KEY NOT NULL,
	`config_key` text NOT NULL,
	`currency_code` text NOT NULL,
	`currency_scale` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	CONSTRAINT "initial_capital_configs_version" CHECK("initial_capital_configs"."version" > 0),
	CONSTRAINT "initial_capital_configs_currency" CHECK("initial_capital_configs"."currency_code" = 'JPY' AND "initial_capital_configs"."currency_scale" = 0),
	CONSTRAINT "initial_capital_configs_amount" CHECK("initial_capital_configs"."amount_minor" > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `initial_capital_configs_config_key_unique` ON `initial_capital_configs` (`config_key`);--> statement-breakpoint
INSERT INTO initial_capital_configs
	(version, config_key, currency_code, currency_scale, amount_minor)
VALUES (1, 'initial-capital-v1', 'JPY', 0, 1000000);--> statement-breakpoint
CREATE TRIGGER initial_capital_configs_no_update
BEFORE UPDATE ON initial_capital_configs BEGIN
	SELECT RAISE(ABORT, 'initial_capital_configs are immutable');
END;--> statement-breakpoint
CREATE TRIGGER initial_capital_configs_no_delete
BEFORE DELETE ON initial_capital_configs BEGIN
	SELECT RAISE(ABORT, 'initial_capital_configs are immutable');
END;--> statement-breakpoint
CREATE TABLE `ledger_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`event_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`effective_at_ms` integer NOT NULL,
	`recorded_at_ms` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `paper_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ledger_events_sequence" CHECK("ledger_events"."sequence_no" > 0),
	CONSTRAINT "ledger_events_type" CHECK("ledger_events"."event_type" IN ('ACCOUNT_OPENED', 'RESERVATION', 'RELEASE', 'FILL', 'FEE', 'FX_CONVERSION', 'SETTLEMENT', 'CORPORATE_ACTION', 'REVERSAL'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_events_account_sequence` ON `ledger_events` (`account_id`,`sequence_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_events_account_idempotency` ON `ledger_events` (`account_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_one_opening_event_per_account` ON `ledger_events` (`account_id`) WHERE "ledger_events"."event_type" = 'ACCOUNT_OPENED';--> statement-breakpoint
CREATE TRIGGER ledger_events_no_update
BEFORE UPDATE ON ledger_events BEGIN
	SELECT RAISE(ABORT, 'ledger_events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER ledger_events_no_delete
BEFORE DELETE ON ledger_events BEGIN
	SELECT RAISE(ABORT, 'ledger_events are append-only');
END;--> statement-breakpoint
CREATE TABLE `paper_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_key` text NOT NULL,
	`base_currency` text NOT NULL,
	`initial_capital_version` integer NOT NULL,
	`initialized_at_ms` integer NOT NULL,
	FOREIGN KEY (`initial_capital_version`) REFERENCES `initial_capital_configs`(`version`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "paper_accounts_key" CHECK("paper_accounts"."account_key" = 'local-default'),
	CONSTRAINT "paper_accounts_currency" CHECK("paper_accounts"."base_currency" = 'JPY')
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_accounts_account_key_unique` ON `paper_accounts` (`account_key`);--> statement-breakpoint
CREATE TRIGGER paper_accounts_no_update
BEFORE UPDATE ON paper_accounts BEGIN
	SELECT RAISE(ABORT, 'paper_accounts are immutable');
END;--> statement-breakpoint
CREATE TRIGGER paper_accounts_no_delete
BEFORE DELETE ON paper_accounts BEGIN
	SELECT RAISE(ABORT, 'paper_accounts are immutable');
END;--> statement-breakpoint
CREATE TRIGGER cash_ledger_entries_no_update
BEFORE UPDATE ON cash_ledger_entries BEGIN
	SELECT RAISE(ABORT, 'cash_ledger_entries are append-only');
END;--> statement-breakpoint
CREATE TRIGGER cash_ledger_entries_no_delete
BEFORE DELETE ON cash_ledger_entries BEGIN
	SELECT RAISE(ABORT, 'cash_ledger_entries are append-only');
END;
