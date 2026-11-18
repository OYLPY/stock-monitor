CREATE TABLE `research_reports` (
	`task_run_id` text PRIMARY KEY NOT NULL,
	`report_type` text NOT NULL,
	`verification_level` text NOT NULL,
	`report_json` text NOT NULL,
	`archived_at_ms` integer NOT NULL,
	FOREIGN KEY (`task_run_id`) REFERENCES `task_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "research_reports_type" CHECK("research_reports"."report_type" IN ('MORNING', 'ANOMALY', 'DAILY_AUDIT', 'WEEKLY_AUDIT')),
	CONSTRAINT "research_reports_verification" CHECK("research_reports"."verification_level" IN ('VERIFIED', 'PARTIAL', 'NOT_VERIFIED', 'DEMO_ONLY')),
	CONSTRAINT "research_reports_json" CHECK(json_valid("research_reports"."report_json"))
);
--> statement-breakpoint
CREATE INDEX `research_reports_archived_at` ON `research_reports` (`archived_at_ms`);