DROP INDEX `equity_valuations_input`;--> statement-breakpoint
CREATE UNIQUE INDEX `equity_valuations_input` ON `equity_valuations` (`account_id`,`as_of_ms`,`input_hash_sha256`,`rule_version`);