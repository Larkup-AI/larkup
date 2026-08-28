CREATE TABLE "extension_access_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"extension_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text,
	"max_installs" integer,
	"install_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_access_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "extension_access_keys" ADD CONSTRAINT "extension_access_keys_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "public"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_access_keys_extension_id_idx" ON "extension_access_keys" USING btree ("extension_id");