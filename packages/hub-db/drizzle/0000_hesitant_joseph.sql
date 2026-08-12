CREATE TABLE "publishers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_email" text,
	"verification" text DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extension_workspace_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"extension_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extensions" (
	"id" text PRIMARY KEY NOT NULL,
	"publisher_id" text NOT NULL,
	"kind" text DEFAULT 'tool' NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"package_name" text NOT NULL,
	"distribution" text DEFAULT 'public' NOT NULL,
	"repository_url" text,
	"license" text,
	"deprecated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extension_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"extension_id" text NOT NULL,
	"version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"integrity" text NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_versions_extension_version_unique" UNIQUE("extension_id","version")
);
--> statement-breakpoint
CREATE TABLE "workspace_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"extension_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_installations_extension_workspace_unique" UNIQUE("extension_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"extension_id" text,
	"workspace_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extension_workspace_grants" ADD CONSTRAINT "extension_workspace_grants_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_versions" ADD CONSTRAINT "extension_versions_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_installations" ADD CONSTRAINT "workspace_installations_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_versions_extension_id_idx" ON "extension_versions" USING btree ("extension_id");--> statement-breakpoint
CREATE INDEX "workspace_installations_extension_id_idx" ON "workspace_installations" USING btree ("extension_id");--> statement-breakpoint
CREATE INDEX "audit_events_extension_id_idx" ON "audit_events" USING btree ("extension_id");