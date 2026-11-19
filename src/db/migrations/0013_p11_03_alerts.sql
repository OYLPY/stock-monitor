CREATE TABLE `market_watch_source_watermarks` (
	`source_key` text PRIMARY KEY NOT NULL,
	`last_success_at_ms` integer NOT NULL,
	CONSTRAINT "market_watch_source_watermarks_source" CHECK("market_watch_source_watermarks"."source_key" IN ('boj.rss', 'federalreserve.rss')),
	CONSTRAINT "market_watch_source_watermarks_time" CHECK("market_watch_source_watermarks"."last_success_at_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE `notification_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_run_id` text NOT NULL,
	`event_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`outcome` text NOT NULL,
	`reason_code` text NOT NULL,
	`rule_version` text NOT NULL,
	`importance_rule_id` text,
	`confidence_level` text,
	`supporting_source_count` integer,
	`priority_rank` integer,
	`priority_details_json` text NOT NULL,
	`decided_at_ms` integer NOT NULL,
	FOREIGN KEY (`task_run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`event_id`) REFERENCES `market_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revision_id`) REFERENCES `market_event_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "notification_decisions_outcome" CHECK("notification_decisions"."outcome" IN ('BASELINED', 'SUPPRESSED', 'ALREADY_NOTIFIED', 'SELECTED', 'DEFERRED_LIMIT')),
	CONSTRAINT "notification_decisions_confidence" CHECK("notification_decisions"."confidence_level" IS NULL OR "notification_decisions"."confidence_level" IN ('LOW', 'MEDIUM', 'HIGH')),
	CONSTRAINT "notification_decisions_source_count" CHECK("notification_decisions"."supporting_source_count" IS NULL OR "notification_decisions"."supporting_source_count" >= 0),
	CONSTRAINT "notification_decisions_priority_rank" CHECK("notification_decisions"."priority_rank" IS NULL OR "notification_decisions"."priority_rank" > 0),
	CONSTRAINT "notification_decisions_priority_details" CHECK(json_valid("notification_decisions"."priority_details_json")),
	CONSTRAINT "notification_decisions_time" CHECK("notification_decisions"."decided_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_decisions_task_revision` ON `notification_decisions` (`task_run_id`,`revision_id`);--> statement-breakpoint
CREATE INDEX `notification_decisions_time` ON `notification_decisions` (`decided_at_ms`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`event_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`task_run_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`decision_id`) REFERENCES `notification_decisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`event_id`) REFERENCES `market_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revision_id`) REFERENCES `market_event_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`task_run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "notifications_created_at_ms" CHECK("notifications"."created_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_decision_id_unique` ON `notifications` (`decision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_event_revision` ON `notifications` (`event_id`,`revision_id`);--> statement-breakpoint
CREATE INDEX `notifications_created_at` ON `notifications` (`created_at_ms`);
--> statement-breakpoint
CREATE TRIGGER notification_decisions_no_update
BEFORE UPDATE ON notification_decisions BEGIN
  SELECT RAISE(ABORT, 'notification_decisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER notification_decisions_no_delete
BEFORE DELETE ON notification_decisions BEGIN
  SELECT RAISE(ABORT, 'notification_decisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER notifications_no_update
BEFORE UPDATE ON notifications BEGIN
  SELECT RAISE(ABORT, 'notifications are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER notifications_no_delete
BEFORE DELETE ON notifications BEGIN
  SELECT RAISE(ABORT, 'notifications are append-only');
END;
