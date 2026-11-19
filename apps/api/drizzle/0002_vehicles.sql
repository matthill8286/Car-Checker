CREATE TABLE "field_sources" (
	"vehicle_id" uuid NOT NULL,
	"field" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone,
	CONSTRAINT "field_sources_vehicle_id_field_pk" PRIMARY KEY("vehicle_id","field")
);
--> statement-breakpoint
CREATE TABLE "mileage_readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"value" integer NOT NULL,
	"unit" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mot_defects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mot_test_id" bigint NOT NULL,
	"type" text NOT NULL,
	"dangerous" boolean NOT NULL,
	"text" text NOT NULL,
	"category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mot_tests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"test_number" text,
	"completed_at" timestamp with time zone NOT NULL,
	"result" text NOT NULL,
	"odometer" integer,
	"odometer_unit" text,
	"odometer_result" text NOT NULL,
	"expiry" text,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_vehicles" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"notes" text,
	"asking_price_pence" integer,
	"listing_url" text,
	"saved_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_status" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"tax_status" text,
	"tax_due" text,
	"mot_status" text,
	"mot_expiry" text,
	"marked_for_export" boolean,
	"outstanding_recall" text
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier_kind" text NOT NULL,
	"identifier_value" text NOT NULL,
	"identifier" jsonb NOT NULL,
	"registration" text,
	"vin" text,
	"country" text,
	"make" text,
	"model" text,
	"variant" text,
	"colour" text,
	"fuel_type" text,
	"engine_cc" integer,
	"first_registered" text,
	"verdict" text,
	"concerns" integer DEFAULT 0 NOT NULL,
	"latest_check_id" uuid NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "field_sources" ADD CONSTRAINT "field_sources_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mileage_readings" ADD CONSTRAINT "mileage_readings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mot_defects" ADD CONSTRAINT "mot_defects_mot_test_id_mot_tests_id_fk" FOREIGN KEY ("mot_test_id") REFERENCES "public"."mot_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mot_tests" ADD CONSTRAINT "mot_tests_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_vehicles" ADD CONSTRAINT "saved_vehicles_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_status" ADD CONSTRAINT "vehicle_status_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_latest_check_id_checks_id_fk" FOREIGN KEY ("latest_check_id") REFERENCES "public"."checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mileage_readings_vehicle_idx" ON "mileage_readings" USING btree ("vehicle_id","date");--> statement-breakpoint
CREATE INDEX "mot_defects_test_idx" ON "mot_defects" USING btree ("mot_test_id");--> statement-breakpoint
CREATE INDEX "mot_tests_vehicle_idx" ON "mot_tests" USING btree ("vehicle_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_identifier_idx" ON "vehicles" USING btree ("identifier_kind","identifier_value");--> statement-breakpoint
CREATE INDEX "vehicles_vin_idx" ON "vehicles" USING btree ("vin");--> statement-breakpoint
CREATE INDEX "vehicles_registration_idx" ON "vehicles" USING btree ("registration");