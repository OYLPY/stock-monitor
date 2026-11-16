CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`publisher` text NOT NULL,
	`source_type` text NOT NULL,
	`authority_role` text NOT NULL,
	`reference_url` text,
	`license_url` text,
	`license_status` text NOT NULL,
	`credential_requirement` text NOT NULL,
	`registered_at_ms` integer NOT NULL,
	CONSTRAINT "sources_source_type" CHECK("sources"."source_type" IN ('REGULATORY', 'EXCHANGE', 'ISSUER', 'NEWS', 'DATA_VENDOR', 'OTHER')),
	CONSTRAINT "sources_authority_role" CHECK("sources"."authority_role" IN ('REGULATORY_PRIMARY', 'EXCHANGE_PRIMARY', 'ISSUER_PRIMARY', 'AUTHORIZED_VENDOR', 'SECONDARY', 'FIXTURE', 'UNKNOWN')),
	CONSTRAINT "sources_license_status" CHECK("sources"."license_status" IN ('VERIFIED', 'NOT_VERIFIED', 'UNKNOWN')),
	CONSTRAINT "sources_credential_requirement" CHECK("sources"."credential_requirement" IN ('REQUIRED', 'NOT_REQUIRED', 'UNKNOWN'))
 ) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_source_key` ON `sources` (`source_key`);
--> statement-breakpoint
CREATE TABLE `source_records` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`record_key` text NOT NULL,
	`record_type` text NOT NULL,
	`record_version` integer NOT NULL,
	`supersedes_record_id` text,
	`published_at_ms` integer,
	`occurred_at_ms` integer,
	`available_at_ms` integer,
	`collected_at_ms` integer NOT NULL,
	`raw_time_text` text,
	`source_time_zone` text,
	`canonical_url` text,
	`content_hash_sha256` text NOT NULL,
	`data_class` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "source_records_version" CHECK("source_records"."record_version" > 0),
	CONSTRAINT "source_records_version_link" CHECK(("source_records"."record_version" = 1 AND "source_records"."supersedes_record_id" IS NULL) OR ("source_records"."record_version" > 1 AND "source_records"."supersedes_record_id" IS NOT NULL)),
	CONSTRAINT "source_records_record_type" CHECK("source_records"."record_type" IN ('MARKET_QUOTE', 'DISCLOSURE', 'NEWS', 'OTHER')),
	CONSTRAINT "source_records_content_hash" CHECK(length("source_records"."content_hash_sha256") = 64 AND "source_records"."content_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "source_records_data_class" CHECK("source_records"."data_class" IN ('REAL', 'DELAYED', 'HISTORICAL', 'FIXTURE', 'NOT_VERIFIED'))
 ) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `source_records_identity_version` ON `source_records` (`source_id`,`record_key`,`record_version`);
--> statement-breakpoint
CREATE INDEX `source_records_source_collected_at` ON `source_records` (`source_id`,`collected_at_ms`);
--> statement-breakpoint
CREATE TABLE `market_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at_ms` integer NOT NULL
 ) STRICT;
--> statement-breakpoint
CREATE TABLE `market_event_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`category` text NOT NULL,
	`summary` text NOT NULL,
	`market_code` text,
	`instrument_key` text,
	`occurred_at_ms` integer,
	`published_at_ms` integer,
	`first_seen_at_ms` integer NOT NULL,
	`importance_reason` text NOT NULL,
	`data_class` text NOT NULL,
	`verification_level` text NOT NULL,
	`verification_reason` text,
	`verification_rule_version` text,
	`primary_source_record_id` text,
	`fingerprint_algorithm_version` text NOT NULL,
	`fingerprint_sha256` text NOT NULL,
	`recorded_at_ms` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `market_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`primary_source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "market_event_revisions_version" CHECK("market_event_revisions"."revision_no" > 0),
	CONSTRAINT "market_event_revisions_market" CHECK("market_event_revisions"."market_code" IS NULL OR "market_event_revisions"."market_code" IN ('JP', 'US')),
	CONSTRAINT "market_event_revisions_data_class" CHECK("market_event_revisions"."data_class" IN ('REAL', 'DELAYED', 'HISTORICAL', 'FIXTURE', 'NOT_VERIFIED')),
	CONSTRAINT "market_event_revisions_verification_level" CHECK("market_event_revisions"."verification_level" IN ('VERIFIED', 'PARTIAL', 'NOT_VERIFIED', 'DEMO_ONLY')),
	CONSTRAINT "market_event_revisions_verified_source" CHECK("market_event_revisions"."verification_level" <> 'VERIFIED' OR ("market_event_revisions"."primary_source_record_id" IS NOT NULL AND "market_event_revisions"."verification_rule_version" IS NOT NULL AND "market_event_revisions"."data_class" <> 'FIXTURE' AND "market_event_revisions"."data_class" <> 'NOT_VERIFIED')),
	CONSTRAINT "market_event_revisions_fixture_level" CHECK("market_event_revisions"."data_class" <> 'FIXTURE' OR "market_event_revisions"."verification_level" = 'DEMO_ONLY'),
	CONSTRAINT "market_event_revisions_fingerprint" CHECK(length("market_event_revisions"."fingerprint_sha256") = 64 AND "market_event_revisions"."fingerprint_sha256" NOT GLOB '*[^0-9a-f]*')
 ) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `market_event_revisions_event_version` ON `market_event_revisions` (`event_id`,`revision_no`);
--> statement-breakpoint
CREATE TABLE `market_event_evidence` (
	`revision_id` text NOT NULL,
	`source_record_id` text NOT NULL,
	`relation` text NOT NULL,
	`linked_at_ms` integer NOT NULL,
	PRIMARY KEY(`revision_id`, `source_record_id`),
	FOREIGN KEY (`revision_id`) REFERENCES `market_event_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "market_event_evidence_relation" CHECK("market_event_evidence"."relation" IN ('SUPPORTS', 'CONTRADICTS', 'CONTEXT'))
 ) STRICT;
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence_no` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`payload_hash_sha256` text NOT NULL,
	`previous_hash_sha256` text,
	`event_hash_sha256` text NOT NULL,
	`recorded_at_ms` integer NOT NULL,
	CONSTRAINT "audit_events_sequence_positive" CHECK("audit_events"."sequence_no" > 0),
	CONSTRAINT "audit_events_payload_hash" CHECK(length("audit_events"."payload_hash_sha256") = 64 AND "audit_events"."payload_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "audit_events_hash" CHECK(length("audit_events"."event_hash_sha256") = 64 AND "audit_events"."event_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "audit_events_previous_hash" CHECK("audit_events"."previous_hash_sha256" IS NULL OR (length("audit_events"."previous_hash_sha256") = 64 AND "audit_events"."previous_hash_sha256" NOT GLOB '*[^0-9a-f]*'))
 ) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_sequence` ON `audit_events` (`sequence_no`);
--> statement-breakpoint
ALTER TABLE `ledger_events` ADD `source_record_id` text REFERENCES source_records(id) ON DELETE RESTRICT;

CREATE TRIGGER sources_no_update
BEFORE UPDATE ON sources BEGIN
  SELECT RAISE(ABORT, 'sources are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER sources_no_delete
BEFORE DELETE ON sources BEGIN
  SELECT RAISE(ABORT, 'sources are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER source_records_no_update
BEFORE UPDATE ON source_records BEGIN
  SELECT RAISE(ABORT, 'source_records are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER source_records_no_delete
BEFORE DELETE ON source_records BEGIN
  SELECT RAISE(ABORT, 'source_records are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER market_events_no_update
BEFORE UPDATE ON market_events BEGIN
  SELECT RAISE(ABORT, 'market_events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER market_events_no_delete
BEFORE DELETE ON market_events BEGIN
  SELECT RAISE(ABORT, 'market_events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER market_event_revisions_no_update
BEFORE UPDATE ON market_event_revisions BEGIN
  SELECT RAISE(ABORT, 'market_event_revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER market_event_revisions_no_delete
BEFORE DELETE ON market_event_revisions BEGIN
  SELECT RAISE(ABORT, 'market_event_revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER market_event_evidence_no_update
BEFORE UPDATE ON market_event_evidence BEGIN
  SELECT RAISE(ABORT, 'market_event_evidence are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER market_event_evidence_no_delete
BEFORE DELETE ON market_event_evidence BEGIN
  SELECT RAISE(ABORT, 'market_event_evidence are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;
