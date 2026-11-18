CREATE TABLE `market_price_bars` (
	`id` text PRIMARY KEY NOT NULL,
	`market_code` text NOT NULL,
	`symbol` text NOT NULL,
	`trading_date` text NOT NULL,
	`open_mantissa` integer NOT NULL,
	`high_mantissa` integer NOT NULL,
	`low_mantissa` integer NOT NULL,
	`close_mantissa` integer NOT NULL,
	`price_scale` integer NOT NULL,
	`volume_shares` integer NOT NULL,
	`source_record_id` text NOT NULL,
	`collected_at_ms` integer NOT NULL,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "market_price_bars_market" CHECK("market_price_bars"."market_code" IN ('JP', 'US')),
	CONSTRAINT "market_price_bars_symbol" CHECK(length("market_price_bars"."symbol") BETWEEN 1 AND 32),
	CONSTRAINT "market_price_bars_date" CHECK(length("market_price_bars"."trading_date") = 10 AND date("market_price_bars"."trading_date") = "market_price_bars"."trading_date"),
	CONSTRAINT "market_price_bars_prices" CHECK("market_price_bars"."open_mantissa" > 0 AND "market_price_bars"."high_mantissa" > 0 AND "market_price_bars"."low_mantissa" > 0 AND "market_price_bars"."close_mantissa" > 0 AND "market_price_bars"."price_scale" BETWEEN 0 AND 8),
	CONSTRAINT "market_price_bars_ohlc" CHECK("market_price_bars"."high_mantissa" >= "market_price_bars"."open_mantissa" AND "market_price_bars"."high_mantissa" >= "market_price_bars"."close_mantissa" AND "market_price_bars"."high_mantissa" >= "market_price_bars"."low_mantissa" AND "market_price_bars"."low_mantissa" <= "market_price_bars"."open_mantissa" AND "market_price_bars"."low_mantissa" <= "market_price_bars"."close_mantissa"),
	CONSTRAINT "market_price_bars_volume" CHECK("market_price_bars"."volume_shares" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `market_price_bars_source_date` ON `market_price_bars` (`source_record_id`,`trading_date`);--> statement-breakpoint
CREATE INDEX `market_price_bars_market_symbol_date` ON `market_price_bars` (`market_code`,`symbol`,`trading_date`,`collected_at_ms`);
