CREATE TABLE `courses` (
	`code` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`title` text NOT NULL,
	`units` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `incompatibilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_code` text NOT NULL,
	`blocked_by_code` text NOT NULL,
	FOREIGN KEY (`course_code`) REFERENCES `courses`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plan_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_code` text NOT NULL,
	`term_index` integer NOT NULL,
	FOREIGN KEY (`course_code`) REFERENCES `courses`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `requisite_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_code` text NOT NULL,
	`parent_id` integer,
	`kind` text NOT NULL,
	`ref_course_code` text,
	`unit_subject` text,
	`unit_count` integer,
	FOREIGN KEY (`course_code`) REFERENCES `courses`(`code`) ON UPDATE no action ON DELETE no action
);
