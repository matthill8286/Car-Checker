CREATE TABLE "manual_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"registration" text,
	"vin" text,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "manual_reports_registration_idx" ON "manual_reports" USING btree ("registration");--> statement-breakpoint
CREATE INDEX "manual_reports_vin_idx" ON "manual_reports" USING btree ("vin");