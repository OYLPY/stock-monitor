CREATE TABLE `precision_records` (
	`id` text PRIMARY KEY NOT NULL,
	`jpy_minor` integer NOT NULL,
	`usd_minor` integer NOT NULL,
	`usd_jpy_mantissa` integer NOT NULL,
	`usd_jpy_scale` integer NOT NULL,
	`price_mantissa` integer NOT NULL,
	`price_scale` integer NOT NULL,
	`share_quantity` integer NOT NULL,
	CONSTRAINT "precision_records_usd_jpy_scale" CHECK("precision_records"."usd_jpy_scale" BETWEEN 0 AND 8),
	CONSTRAINT "precision_records_price_mantissa" CHECK("precision_records"."price_mantissa" > 0),
	CONSTRAINT "precision_records_price_scale" CHECK("precision_records"."price_scale" BETWEEN 0 AND 8),
	CONSTRAINT "precision_records_share_quantity" CHECK("precision_records"."share_quantity" > 0)
) STRICT;
