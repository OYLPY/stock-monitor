PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TRIGGER plan_approvals_require_matching_pass;--> statement-breakpoint
CREATE TABLE `__new_risk_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_version_id` text NOT NULL,
	`decision_no` integer NOT NULL,
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
	CONSTRAINT "risk_decisions_number" CHECK("__new_risk_decisions"."decision_no" > 0),
	CONSTRAINT "risk_decisions_status" CHECK("__new_risk_decisions"."status" IN ('PASS', 'REJECT', 'UNRESOLVED')),
	CONSTRAINT "risk_decisions_plan_hash" CHECK(length("__new_risk_decisions"."plan_hash_sha256") = 64 AND "__new_risk_decisions"."plan_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "risk_decisions_input_hash" CHECK(length("__new_risk_decisions"."input_hash_sha256") = 64 AND "__new_risk_decisions"."input_hash_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "risk_decisions_reasons_json" CHECK(json_valid("__new_risk_decisions"."reason_codes_json") AND json_type("__new_risk_decisions"."reason_codes_json") = 'array'),
	CONSTRAINT "risk_decisions_cash_json" CHECK(json_valid("__new_risk_decisions"."available_cash_json") AND json_type("__new_risk_decisions"."available_cash_json") = 'object'),
	CONSTRAINT "risk_decisions_calculation_json" CHECK(json_valid("__new_risk_decisions"."calculation_json") AND json_type("__new_risk_decisions"."calculation_json") = 'object'),
	CONSTRAINT "risk_decisions_requested_quantity" CHECK("__new_risk_decisions"."requested_quantity_shares" > 0),
	CONSTRAINT "risk_decisions_max_quantity" CHECK("__new_risk_decisions"."max_allowed_quantity_shares" IS NULL OR "__new_risk_decisions"."max_allowed_quantity_shares" >= 0),
	CONSTRAINT "risk_decisions_money" CHECK(("__new_risk_decisions"."risk_budget_minor" IS NULL OR "__new_risk_decisions"."risk_budget_minor" >= 0) AND ("__new_risk_decisions"."planned_loss_jpy_minor" IS NULL OR "__new_risk_decisions"."planned_loss_jpy_minor" >= 0)),
	CONSTRAINT "risk_decisions_rule_version" CHECK(length("__new_risk_decisions"."rule_version") BETWEEN 1 AND 64)
);
--> statement-breakpoint
INSERT INTO `__new_risk_decisions`("id", "plan_version_id", "decision_no", "plan_hash_sha256", "status", "reason_codes_json", "requested_quantity_shares", "max_allowed_quantity_shares", "equity_minor", "risk_budget_minor", "planned_loss_jpy_minor", "available_cash_json", "calculation_json", "input_hash_sha256", "rule_version", "decided_at_ms") SELECT "id", "plan_version_id", row_number() OVER (PARTITION BY "plan_version_id" ORDER BY "decided_at_ms", rowid), "plan_hash_sha256", "status", "reason_codes_json", "requested_quantity_shares", "max_allowed_quantity_shares", "equity_minor", "risk_budget_minor", "planned_loss_jpy_minor", "available_cash_json", "calculation_json", "input_hash_sha256", "rule_version", "decided_at_ms" FROM `risk_decisions`;--> statement-breakpoint
DROP TABLE `risk_decisions`;--> statement-breakpoint
ALTER TABLE `__new_risk_decisions` RENAME TO `risk_decisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `risk_decisions_version_number` ON `risk_decisions` (`plan_version_id`,`decision_no`);--> statement-breakpoint
CREATE INDEX `risk_decisions_version_time` ON `risk_decisions` (`plan_version_id`,`decided_at_ms`);--> statement-breakpoint
CREATE TRIGGER risk_decisions_no_update
BEFORE UPDATE ON risk_decisions BEGIN
	SELECT RAISE(ABORT, 'risk_decisions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER risk_decisions_no_delete
BEFORE DELETE ON risk_decisions BEGIN
	SELECT RAISE(ABORT, 'risk_decisions are append-only');
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
		AND risk_decisions.decision_no = (
			SELECT MAX(decision_no)
			FROM risk_decisions
			WHERE plan_version_id = NEW.plan_version_id
		)
)
BEGIN
	SELECT RAISE(ABORT, 'plan_approval_requires_matching_pass');
END;
