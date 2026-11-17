CREATE TABLE `equity_valuation_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`valuation_id` text NOT NULL,
	`ledger_event_id` text NOT NULL,
	`source_record_id` text,
	FOREIGN KEY (`valuation_id`) REFERENCES `equity_valuations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE restrict
 ) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `equity_valuation_evidence_event` ON `equity_valuation_evidence` (`valuation_id`,`ledger_event_id`);--> statement-breakpoint
CREATE TABLE `equity_valuations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`as_of_ms` integer NOT NULL,
	`ledger_sequence_no` integer NOT NULL,
	`input_hash_sha256` text NOT NULL,
	`status` text NOT NULL,
	`equity_minor` integer,
	`currency_code` text NOT NULL,
	`currency_scale` integer NOT NULL,
	`unresolved_reason` text,
	`rule_version` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `paper_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "equity_valuations_sequence" CHECK("equity_valuations"."ledger_sequence_no" >= 0),
	CONSTRAINT "equity_valuations_input_hash" CHECK(length("equity_valuations"."input_hash_sha256") = 64 AND "equity_valuations"."input_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "equity_valuations_currency" CHECK("equity_valuations"."currency_code" = 'JPY' AND "equity_valuations"."currency_scale" = 0),
	CONSTRAINT "equity_valuations_status" CHECK(("equity_valuations"."status" = 'VERIFIED' AND "equity_valuations"."equity_minor" IS NOT NULL AND "equity_valuations"."unresolved_reason" IS NULL) OR ("equity_valuations"."status" = 'UNRESOLVED' AND "equity_valuations"."equity_minor" IS NULL AND "equity_valuations"."unresolved_reason" IS NOT NULL)),
	CONSTRAINT "equity_valuations_rule_version" CHECK(length("equity_valuations"."rule_version") BETWEEN 1 AND 64)
 ) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `equity_valuations_input` ON `equity_valuations` (`account_id`,`as_of_ms`,`input_hash_sha256`,`rule_version`);--> statement-breakpoint
CREATE INDEX `equity_valuations_account_sequence` ON `equity_valuations` (`account_id`,`ledger_sequence_no`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`market_code` text NOT NULL,
	`asset_class` text NOT NULL,
	`quote_currency_code` text NOT NULL,
	`trading_unit` integer NOT NULL,
	`exchange_time_zone` text NOT NULL,
	`classification_status` text NOT NULL,
	`classification_source_record_id` text,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`classification_source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "instruments_market" CHECK("instruments"."market_code" IN ('JP', 'US')),
	CONSTRAINT "instruments_asset_class" CHECK("instruments"."asset_class" IN ('COMMON_STOCK', 'NON_LEVERAGED_ETF', 'UNKNOWN')),
	CONSTRAINT "instruments_currency" CHECK(("instruments"."market_code" = 'JP' AND "instruments"."quote_currency_code" = 'JPY') OR ("instruments"."market_code" = 'US' AND "instruments"."quote_currency_code" = 'USD')),
	CONSTRAINT "instruments_trading_unit" CHECK("instruments"."trading_unit" > 0),
	CONSTRAINT "instruments_exchange_time_zone" CHECK(("instruments"."market_code" = 'JP' AND "instruments"."exchange_time_zone" = 'Asia/Tokyo') OR ("instruments"."market_code" = 'US' AND "instruments"."exchange_time_zone" = 'America/New_York')),
	CONSTRAINT "instruments_classification_status" CHECK("instruments"."classification_status" IN ('VERIFIED', 'NOT_VERIFIED')),
	CONSTRAINT "instruments_verified_classification" CHECK("instruments"."classification_status" <> 'VERIFIED' OR ("instruments"."asset_class" <> 'UNKNOWN' AND "instruments"."classification_source_record_id" IS NOT NULL))
 ) STRICT;
--> statement-breakpoint
CREATE TABLE `position_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_event_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`quantity_shares` integer NOT NULL,
	FOREIGN KEY (`ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "position_ledger_entries_quantity" CHECK("position_ledger_entries"."quantity_shares" <> 0)
 ) STRICT;
--> statement-breakpoint
CREATE INDEX `position_ledger_entries_instrument` ON `position_ledger_entries` (`instrument_id`);--> statement-breakpoint
ALTER TABLE `ledger_events` ADD `rule_version` text DEFAULT 'account-opening-v1' NOT NULL;--> statement-breakpoint
CREATE TRIGGER instruments_no_update
BEFORE UPDATE ON instruments BEGIN
	SELECT RAISE(ABORT, 'instruments are immutable');
END;--> statement-breakpoint
CREATE TRIGGER instruments_no_delete
BEFORE DELETE ON instruments BEGIN
	SELECT RAISE(ABORT, 'instruments are immutable');
END;--> statement-breakpoint
CREATE TRIGGER position_ledger_entries_no_update
BEFORE UPDATE ON position_ledger_entries BEGIN
	SELECT RAISE(ABORT, 'position_ledger_entries are append-only');
END;--> statement-breakpoint
CREATE TRIGGER position_ledger_entries_no_delete
BEFORE DELETE ON position_ledger_entries BEGIN
	SELECT RAISE(ABORT, 'position_ledger_entries are append-only');
END;--> statement-breakpoint
CREATE TRIGGER equity_valuations_no_update
BEFORE UPDATE ON equity_valuations BEGIN
	SELECT RAISE(ABORT, 'equity_valuations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER equity_valuations_no_delete
BEFORE DELETE ON equity_valuations BEGIN
	SELECT RAISE(ABORT, 'equity_valuations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER equity_valuation_evidence_no_update
BEFORE UPDATE ON equity_valuation_evidence BEGIN
	SELECT RAISE(ABORT, 'equity_valuation_evidence are append-only');
END;--> statement-breakpoint
CREATE TRIGGER equity_valuation_evidence_no_delete
BEFORE DELETE ON equity_valuation_evidence BEGIN
	SELECT RAISE(ABORT, 'equity_valuation_evidence are append-only');
END;
