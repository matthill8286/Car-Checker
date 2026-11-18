CREATE TABLE "checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"status" text NOT NULL,
	"identifier_kind" text NOT NULL,
	"identifier_value" text NOT NULL,
	"identifier" jsonb NOT NULL,
	"alternatives" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"record" jsonb,
	"title" text,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_responses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"identifier_kind" text NOT NULL,
	"identifier_value" text NOT NULL,
	"outcome" text NOT NULL,
	"raw" jsonb,
	"contribution" jsonb,
	"discovered" jsonb NOT NULL,
	"mock" boolean NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"check_id" uuid
);
--> statement-breakpoint
ALTER TABLE "source_responses" ADD CONSTRAINT "source_responses_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checks_created_at_idx" ON "checks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "checks_identifier_idx" ON "checks" USING btree ("identifier_kind","identifier_value","created_at");--> statement-breakpoint
CREATE INDEX "source_responses_lookup_idx" ON "source_responses" USING btree ("source","identifier_kind","identifier_value","mock","fetched_at");