CREATE TRIGGER IF NOT EXISTS notification_decisions_no_update
BEFORE UPDATE ON notification_decisions BEGIN
  SELECT RAISE(ABORT, 'notification_decisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS notification_decisions_no_delete
BEFORE DELETE ON notification_decisions BEGIN
  SELECT RAISE(ABORT, 'notification_decisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS notifications_no_update
BEFORE UPDATE ON notifications BEGIN
  SELECT RAISE(ABORT, 'notifications are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS notifications_no_delete
BEFORE DELETE ON notifications BEGIN
  SELECT RAISE(ABORT, 'notifications are append-only');
END;
