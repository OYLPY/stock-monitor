CREATE TABLE `paper_fills` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`fill_key` text NOT NULL,
	`ledger_event_id` text NOT NULL,
	`fee_ledger_event_id` text,
	`quantity_shares` integer NOT NULL,
	`price_mantissa` integer NOT NULL,
	`price_scale` integer NOT NULL,
	`currency_code` text NOT NULL,
	`fee_minor` integer NOT NULL,
	`execution_data_class` text NOT NULL,
	`quote_record_id` text NOT NULL,
	`fx_source_record_id` text,
	`fx_rate` text,
	`market_at_ms` integer NOT NULL,
	`executed_at_ms` integer NOT NULL,
	`settlement_date` text NOT NULL,
	`settlement_rule_version` text NOT NULL,
	`cost_model_version` text NOT NULL,
	`matching_rule_version` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `paper_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`fee_ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quote_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`fx_source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "paper_fills_quantity" CHECK("paper_fills"."quantity_shares" > 0),
	CONSTRAINT "paper_fills_price" CHECK("paper_fills"."price_mantissa" > 0 AND "paper_fills"."price_scale" BETWEEN 0 AND 8),
	CONSTRAINT "paper_fills_currency" CHECK("paper_fills"."currency_code" IN ('JPY', 'USD')),
	CONSTRAINT "paper_fills_fee" CHECK("paper_fills"."fee_minor" >= 0),
	CONSTRAINT "paper_fills_fee_ledger" CHECK(("paper_fills"."fee_minor" = 0 AND "paper_fills"."fee_ledger_event_id" IS NULL) OR ("paper_fills"."fee_minor" > 0 AND "paper_fills"."fee_ledger_event_id" IS NOT NULL)),
	CONSTRAINT "paper_fills_data_class" CHECK("paper_fills"."execution_data_class" = 'REAL'),
	CONSTRAINT "paper_fills_time" CHECK("paper_fills"."market_at_ms" >= 0 AND "paper_fills"."executed_at_ms" >= "paper_fills"."market_at_ms" AND length("paper_fills"."settlement_date") = 10),
	CONSTRAINT "paper_fills_fx" CHECK(("paper_fills"."fx_source_record_id" IS NULL AND "paper_fills"."fx_rate" IS NULL) OR ("paper_fills"."fx_source_record_id" IS NOT NULL AND "paper_fills"."fx_rate" IS NOT NULL)),
	CONSTRAINT "paper_fills_rule_versions" CHECK(length("paper_fills"."cost_model_version") BETWEEN 1 AND 64 AND length("paper_fills"."matching_rule_version") BETWEEN 1 AND 64 AND length("paper_fills"."settlement_rule_version") BETWEEN 1 AND 64)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_fills_ledger_event_id_unique` ON `paper_fills` (`ledger_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `paper_fills_fee_ledger_event_id_unique` ON `paper_fills` (`fee_ledger_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `paper_fills_order_key` ON `paper_fills` (`order_id`,`fill_key`);--> statement-breakpoint
CREATE INDEX `paper_fills_quote_record` ON `paper_fills` (`quote_record_id`);--> statement-breakpoint
CREATE TABLE `paper_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`effective_at_ms` integer NOT NULL,
	`recorded_at_ms` integer NOT NULL,
	`reserved_before_minor` integer NOT NULL,
	`reserved_after_minor` integer NOT NULL,
	`filled_quantity_shares` integer NOT NULL,
	`reason_code` text,
	`ledger_event_id` text,
	FOREIGN KEY (`order_id`) REFERENCES `paper_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "paper_order_events_sequence" CHECK("paper_order_events"."sequence_no" > 0),
	CONSTRAINT "paper_order_events_type" CHECK("paper_order_events"."event_type" IN ('SUBMITTED', 'PARTIAL_FILL', 'FILL', 'EXECUTION_REJECTED', 'CANCELED', 'EXPIRED', 'REJECTED')),
	CONSTRAINT "paper_order_events_status" CHECK("paper_order_events"."to_status" IN ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED', 'REJECTED') AND ("paper_order_events"."from_status" IS NULL OR "paper_order_events"."from_status" IN ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED', 'REJECTED'))),
	CONSTRAINT "paper_order_events_time" CHECK("paper_order_events"."effective_at_ms" >= 0 AND "paper_order_events"."recorded_at_ms" >= "paper_order_events"."effective_at_ms"),
	CONSTRAINT "paper_order_events_reserve" CHECK("paper_order_events"."reserved_before_minor" >= 0 AND "paper_order_events"."reserved_after_minor" >= 0 AND "paper_order_events"."filled_quantity_shares" >= 0),
	CONSTRAINT "paper_order_events_ledger" CHECK(("paper_order_events"."event_type" IN ('PARTIAL_FILL', 'FILL') AND "paper_order_events"."ledger_event_id" IS NOT NULL) OR ("paper_order_events"."event_type" NOT IN ('PARTIAL_FILL', 'FILL') AND "paper_order_events"."ledger_event_id" IS NULL))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_order_events_order_sequence` ON `paper_order_events` (`order_id`,`sequence_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `paper_order_events_order_idempotency` ON `paper_order_events` (`order_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `paper_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`plan_version_id` text NOT NULL,
	`plan_approval_id` text NOT NULL,
	`plan_hash_sha256` text NOT NULL,
	`instrument_id` text NOT NULL,
	`requested_quantity_shares` integer NOT NULL,
	`filled_quantity_shares` integer DEFAULT 0 NOT NULL,
	`currency_code` text NOT NULL,
	`reserved_amount_minor` integer DEFAULT 0 NOT NULL,
	`fees_charged_minor` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`reason_code` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `paper_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plan_version_id`) REFERENCES `paper_plan_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plan_approval_id`) REFERENCES `plan_approvals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "paper_orders_plan_hash" CHECK(length("paper_orders"."plan_hash_sha256") = 64 AND "paper_orders"."plan_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "paper_orders_quantity" CHECK("paper_orders"."requested_quantity_shares" > 0 AND "paper_orders"."filled_quantity_shares" >= 0 AND "paper_orders"."filled_quantity_shares" <= "paper_orders"."requested_quantity_shares"),
	CONSTRAINT "paper_orders_currency" CHECK("paper_orders"."currency_code" IN ('JPY', 'USD')),
	CONSTRAINT "paper_orders_reserve" CHECK("paper_orders"."reserved_amount_minor" >= 0 AND "paper_orders"."fees_charged_minor" >= 0),
	CONSTRAINT "paper_orders_status" CHECK("paper_orders"."status" IN ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED', 'REJECTED')),
	CONSTRAINT "paper_orders_idempotency_key" CHECK(length(trim("paper_orders"."idempotency_key")) BETWEEN 1 AND 200)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_orders_plan_version_id_unique` ON `paper_orders` (`plan_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `paper_orders_plan_approval_id_unique` ON `paper_orders` (`plan_approval_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `paper_orders_account_idempotency` ON `paper_orders` (`account_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `paper_orders_account_status` ON `paper_orders` (`account_id`,`status`);
--> statement-breakpoint
CREATE TRIGGER paper_order_events_no_update
BEFORE UPDATE ON paper_order_events BEGIN
	SELECT RAISE(ABORT, 'paper_order_events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER paper_order_events_no_delete
BEFORE DELETE ON paper_order_events BEGIN
	SELECT RAISE(ABORT, 'paper_order_events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER paper_fills_no_update
BEFORE UPDATE ON paper_fills BEGIN
	SELECT RAISE(ABORT, 'paper_fills are append-only');
END;--> statement-breakpoint
CREATE TRIGGER paper_fills_no_delete
BEFORE DELETE ON paper_fills BEGIN
	SELECT RAISE(ABORT, 'paper_fills are append-only');
END;
