CREATE TABLE `task_run_attempts` (
	`task_run_id` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`worker_id` text NOT NULL,
	`execution_status` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`finished_at_ms` integer,
	`error_code` text,
	PRIMARY KEY(`task_run_id`, `attempt_no`),
	FOREIGN KEY (`task_run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "task_run_attempts_number" CHECK("task_run_attempts"."attempt_no" BETWEEN 1 AND 3),
	CONSTRAINT "task_run_attempts_status" CHECK("task_run_attempts"."execution_status" IN ('RUNNING', 'DONE', 'FAILED', 'BLOCKED_EXTERNAL', 'SKIPPED', 'ABANDONED')),
	CONSTRAINT "task_run_attempts_finished" CHECK(("task_run_attempts"."execution_status" = 'RUNNING' AND "task_run_attempts"."finished_at_ms" IS NULL) OR ("task_run_attempts"."execution_status" <> 'RUNNING' AND "task_run_attempts"."finished_at_ms" IS NOT NULL))
) STRICT;
--> statement-breakpoint
CREATE TABLE `task_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_run_id` text,
	`worker_id` text,
	`event_type` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	`details_json` text NOT NULL,
	FOREIGN KEY (`task_run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "task_run_events_details" CHECK(json_valid("task_run_events"."details_json")),
	CONSTRAINT "task_run_events_type" CHECK("task_run_events"."event_type" IN ('TASK_QUEUED', 'TASK_CLAIMED', 'TASK_RECLAIMED', 'TASK_COMPLETED', 'TASK_FAILED', 'TASK_BLOCKED_EXTERNAL', 'TASK_CANCEL_REQUESTED', 'TASK_CANCELLED', 'TASK_SKIPPED', 'TASK_TIMED_OUT', 'TASK_ABANDONED', 'WORKER_LOCK_ACQUIRED', 'WORKER_LOCK_RELEASED', 'WORKER_LOCK_LOST'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `task_run_events_task_time` ON `task_run_events` (`task_run_id`,`occurred_at_ms`);--> statement-breakpoint
CREATE TABLE `task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`input_hash_sha256` text NOT NULL,
	`run_type` text NOT NULL,
	`input_json` text NOT NULL,
	`time_zone` text NOT NULL,
	`scheduled_local_at` text NOT NULL,
	`scheduled_at_ms` integer NOT NULL,
	`timeout_ms` integer NOT NULL,
	`execution_status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at_ms` integer NOT NULL,
	`lease_owner` text,
	`lease_until_ms` integer,
	`fencing_generation` integer DEFAULT 0 NOT NULL,
	`cancellation_requested_at_ms` integer,
	`result_code` text,
	`error_code` text,
	`created_at_ms` integer NOT NULL,
	`started_at_ms` integer,
	`finished_at_ms` integer,
	CONSTRAINT "task_runs_input_hash" CHECK(length("task_runs"."input_hash_sha256") = 64 AND "task_runs"."input_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "task_runs_input_json" CHECK(json_valid("task_runs"."input_json")),
	CONSTRAINT "task_runs_timezone" CHECK(length("task_runs"."time_zone") > 0),
	CONSTRAINT "task_runs_timeout" CHECK("task_runs"."timeout_ms" BETWEEN 1 AND 86400000),
	CONSTRAINT "task_runs_status" CHECK("task_runs"."execution_status" IN ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'BLOCKED_EXTERNAL', 'SKIPPED')),
	CONSTRAINT "task_runs_attempt_count" CHECK("task_runs"."attempt_count" BETWEEN 0 AND 3),
	CONSTRAINT "task_runs_fencing_generation" CHECK("task_runs"."fencing_generation" >= 0),
	CONSTRAINT "task_runs_lease" CHECK(("task_runs"."execution_status" = 'RUNNING' AND "task_runs"."lease_owner" IS NOT NULL AND "task_runs"."lease_until_ms" IS NOT NULL) OR ("task_runs"."execution_status" <> 'RUNNING' AND "task_runs"."lease_owner" IS NULL AND "task_runs"."lease_until_ms" IS NULL)),
	CONSTRAINT "task_runs_finished" CHECK(("task_runs"."execution_status" IN ('PENDING', 'RUNNING') AND "task_runs"."finished_at_ms" IS NULL) OR ("task_runs"."execution_status" IN ('DONE', 'FAILED', 'BLOCKED_EXTERNAL', 'SKIPPED') AND "task_runs"."finished_at_ms" IS NOT NULL))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `task_runs_idempotency_key` ON `task_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `task_runs_due` ON `task_runs` (`execution_status`,`next_attempt_at_ms`,`created_at_ms`);--> statement-breakpoint
CREATE TABLE `worker_state` (
	`singleton_id` integer PRIMARY KEY NOT NULL,
	`owner_id` text,
	`process_id` integer,
	`acquired_at_ms` integer,
	`heartbeat_at_ms` integer,
	`lease_until_ms` integer,
	CONSTRAINT "worker_state_singleton" CHECK("worker_state"."singleton_id" = 1),
	CONSTRAINT "worker_state_lock" CHECK(("worker_state"."owner_id" IS NULL AND "worker_state"."process_id" IS NULL AND "worker_state"."acquired_at_ms" IS NULL AND "worker_state"."heartbeat_at_ms" IS NULL AND "worker_state"."lease_until_ms" IS NULL) OR ("worker_state"."owner_id" IS NOT NULL AND "worker_state"."process_id" > 0 AND "worker_state"."acquired_at_ms" IS NOT NULL AND "worker_state"."heartbeat_at_ms" IS NOT NULL AND "worker_state"."lease_until_ms" IS NOT NULL))
) STRICT;
--> statement-breakpoint
CREATE TRIGGER task_run_events_no_update
BEFORE UPDATE ON task_run_events BEGIN
  SELECT RAISE(ABORT, 'task_run_events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER task_run_events_no_delete
BEFORE DELETE ON task_run_events BEGIN
  SELECT RAISE(ABORT, 'task_run_events are append-only');
END;
