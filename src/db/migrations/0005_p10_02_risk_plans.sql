CREATE TABLE `paper_plan_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`instrument_id` text NOT NULL,
	`requested_quantity_shares` integer NOT NULL,
	`candidate_snapshot_json` text NOT NULL,
	`input_snapshot_json` text NOT NULL,
	`plan_hash_sha256` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `paper_plans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "paper_plan_versions_number" CHECK("paper_plan_versions"."version_no" > 0),
	CONSTRAINT "paper_plan_versions_quantity" CHECK("paper_plan_versions"."requested_quantity_shares" > 0),
	CONSTRAINT "paper_plan_versions_candidate_json" CHECK(json_valid("paper_plan_versions"."candidate_snapshot_json")),
	CONSTRAINT "paper_plan_versions_input_json" CHECK(json_valid("paper_plan_versions"."input_snapshot_json")),
	CONSTRAINT "paper_plan_versions_hash" CHECK(length("paper_plan_versions"."plan_hash_sha256") = 64 AND "paper_plan_versions"."plan_hash_sha256" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_plan_versions_plan_number` ON `paper_plan_versions` (`plan_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `paper_plan_versions_instrument_time` ON `paper_plan_versions` (`instrument_id`,`created_at_ms`);--> statement-breakpoint
CREATE TABLE `paper_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_version_id` text NOT NULL,
	`plan_hash_sha256` text NOT NULL,
	`risk_decision_id` text NOT NULL,
	`approved_at_ms` integer NOT NULL,
	FOREIGN KEY (`plan_version_id`) REFERENCES `paper_plan_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`risk_decision_id`) REFERENCES `risk_decisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plan_approvals_hash" CHECK(length("plan_approvals"."plan_hash_sha256") = 64 AND "plan_approvals"."plan_hash_sha256" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_approvals_plan_version_id_unique` ON `plan_approvals` (`plan_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_approvals_risk_decision_id_unique` ON `plan_approvals` (`risk_decision_id`);--> statement-breakpoint
CREATE TABLE `plan_input_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_version_id` text NOT NULL,
	`source_record_id` text NOT NULL,
	`role` text NOT NULL,
	`content_hash_sha256` text NOT NULL,
	FOREIGN KEY (`plan_version_id`) REFERENCES `paper_plan_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plan_input_evidence_role" CHECK("plan_input_evidence"."role" IN ('CANDIDATE', 'CLASSIFICATION', 'QUOTE', 'RISK_MODEL', 'FX')),
	CONSTRAINT "plan_input_evidence_hash" CHECK(length("plan_input_evidence"."content_hash_sha256") = 64 AND "plan_input_evidence"."content_hash_sha256" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_input_evidence_reference` ON `plan_input_evidence` (`plan_version_id`,`role`,`source_record_id`);--> statement-breakpoint
CREATE TABLE `risk_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_version_id` text NOT NULL,
	`plan_hash_sha256` text NOT NULL,
	`status` text NOT NULL,
	`reason_codes_json` text NOT NULL,
	`requested_quantity_shares` integer NOT NULL,
	`max_allowed_quantity_shares` integer,
	`equity_minor` integer,
	`risk_budget_minor` integer,
	`planned_loss_jpy_minor` integer,
	`available_cash_json` text NOT NULL,
	`calculation_json` text NOT NULL,
	`input_hash_sha256` text NOT NULL,
	`rule_version` text NOT NULL,
	`decided_at_ms` integer NOT NULL,
	FOREIGN KEY (`plan_version_id`) REFERENCES `paper_plan_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "risk_decisions_status" CHECK("risk_decisions"."status" IN ('PASS', 'REJECT', 'UNRESOLVED')),
	CONSTRAINT "risk_decisions_plan_hash" CHECK(length("risk_decisions"."plan_hash_sha256") = 64 AND "risk_decisions"."plan_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "risk_decisions_input_hash" CHECK(length("risk_decisions"."input_hash_sha256") = 64 AND "risk_decisions"."input_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "risk_decisions_reasons_json" CHECK(json_valid("risk_decisions"."reason_codes_json") AND json_type("risk_decisions"."reason_codes_json") = 'array'),
	CONSTRAINT "risk_decisions_cash_json" CHECK(json_valid("risk_decisions"."available_cash_json") AND json_type("risk_decisions"."available_cash_json") = 'object'),
	CONSTRAINT "risk_decisions_calculation_json" CHECK(json_valid("risk_decisions"."calculation_json") AND json_type("risk_decisions"."calculation_json") = 'object'),
	CONSTRAINT "risk_decisions_requested_quantity" CHECK("risk_decisions"."requested_quantity_shares" > 0),
	CONSTRAINT "risk_decisions_max_quantity" CHECK("risk_decisions"."max_allowed_quantity_shares" IS NULL OR "risk_decisions"."max_allowed_quantity_shares" >= 0),
	CONSTRAINT "risk_decisions_money" CHECK(("risk_decisions"."risk_budget_minor" IS NULL OR "risk_decisions"."risk_budget_minor" >= 0) AND ("risk_decisions"."planned_loss_jpy_minor" IS NULL OR "risk_decisions"."planned_loss_jpy_minor" >= 0)),
	CONSTRAINT "risk_decisions_rule_version" CHECK(length("risk_decisions"."rule_version") BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE INDEX `risk_decisions_version_time` ON `risk_decisions` (`plan_version_id`,`decided_at_ms`);
--> statement-breakpoint
CREATE TRIGGER paper_plans_no_update
BEFORE UPDATE ON paper_plans BEGIN
	SELECT RAISE(ABORT, 'paper_plans are immutable');
END;--> statement-breakpoint
CREATE TRIGGER paper_plans_no_delete
BEFORE DELETE ON paper_plans BEGIN
	SELECT RAISE(ABORT, 'paper_plans are immutable');
END;--> statement-breakpoint
CREATE TRIGGER paper_plan_versions_no_update
BEFORE UPDATE ON paper_plan_versions BEGIN
	SELECT RAISE(ABORT, 'paper_plan_versions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER paper_plan_versions_no_delete
BEFORE DELETE ON paper_plan_versions BEGIN
	SELECT RAISE(ABORT, 'paper_plan_versions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER plan_input_evidence_no_update
BEFORE UPDATE ON plan_input_evidence BEGIN
	SELECT RAISE(ABORT, 'plan_input_evidence are append-only');
END;--> statement-breakpoint
CREATE TRIGGER plan_input_evidence_no_delete
BEFORE DELETE ON plan_input_evidence BEGIN
	SELECT RAISE(ABORT, 'plan_input_evidence are append-only');
END;--> statement-breakpoint
CREATE TRIGGER risk_decisions_no_update
BEFORE UPDATE ON risk_decisions BEGIN
	SELECT RAISE(ABORT, 'risk_decisions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER risk_decisions_no_delete
BEFORE DELETE ON risk_decisions BEGIN
	SELECT RAISE(ABORT, 'risk_decisions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER plan_approvals_no_update
BEFORE UPDATE ON plan_approvals BEGIN
	SELECT RAISE(ABORT, 'plan_approvals are append-only');
END;--> statement-breakpoint
CREATE TRIGGER plan_approvals_no_delete
BEFORE DELETE ON plan_approvals BEGIN
	SELECT RAISE(ABORT, 'plan_approvals are append-only');
END;--> statement-breakpoint
CREATE TRIGGER plan_approvals_require_matching_pass
BEFORE INSERT ON plan_approvals
WHEN NOT EXISTS (
	SELECT 1
	FROM risk_decisions
	JOIN paper_plan_versions ON paper_plan_versions.id = risk_decisions.plan_version_id
	WHERE risk_decisions.id = NEW.risk_decision_id
		AND risk_decisions.plan_version_id = NEW.plan_version_id
		AND risk_decisions.plan_hash_sha256 = NEW.plan_hash_sha256
		AND risk_decisions.status = 'PASS'
		AND paper_plan_versions.plan_hash_sha256 = NEW.plan_hash_sha256
)
BEGIN
	SELECT RAISE(ABORT, 'plan_approval_requires_matching_pass');
END;
