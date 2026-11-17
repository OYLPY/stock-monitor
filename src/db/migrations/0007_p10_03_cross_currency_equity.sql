CREATE TABLE `equity_valuation_market_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`valuation_id` text NOT NULL,
	`role` text NOT NULL,
	`instrument_id` text,
	`source_record_id` text NOT NULL,
	`content_hash_sha256` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`valuation_id`) REFERENCES `equity_valuations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "equity_valuation_market_evidence_role" CHECK(("equity_valuation_market_evidence"."role" = 'POSITION_QUOTE' AND "equity_valuation_market_evidence"."instrument_id" IS NOT NULL) OR ("equity_valuation_market_evidence"."role" = 'FX_RATE' AND "equity_valuation_market_evidence"."instrument_id" IS NULL)),
	CONSTRAINT "equity_valuation_market_evidence_hash" CHECK(length("equity_valuation_market_evidence"."content_hash_sha256") = 64 AND "equity_valuation_market_evidence"."content_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "equity_valuation_market_evidence_content" CHECK(json_valid("equity_valuation_market_evidence"."content"))
);
--> statement-breakpoint
CREATE INDEX `equity_valuation_market_evidence_valuation` ON `equity_valuation_market_evidence` (`valuation_id`,`role`,`instrument_id`);
--> statement-breakpoint
CREATE TRIGGER equity_valuation_market_evidence_no_update
BEFORE UPDATE ON equity_valuation_market_evidence BEGIN
	SELECT RAISE(ABORT, 'equity_valuation_market_evidence are append-only');
END;--> statement-breakpoint
CREATE TRIGGER equity_valuation_market_evidence_no_delete
BEFORE DELETE ON equity_valuation_market_evidence BEGIN
	SELECT RAISE(ABORT, 'equity_valuation_market_evidence are append-only');
END;
