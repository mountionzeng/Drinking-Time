CREATE TABLE IF NOT EXISTS `stories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int,
	`title` varchar(255) NOT NULL,
	`logline` text,
	`theme` text,
	`arc` text,
	`summary` text,
	`body` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `generated_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int,
	`storyId` int,
	`userId` int,
	`shotNo` varchar(32),
	`imageKey` varchar(512),
	`imageUrl` text NOT NULL,
	`prompt` text,
	`generationType` enum('generate','initial','inpaint') NOT NULL DEFAULT 'generate',
	`parentImageId` int,
	`isCurrent` boolean NOT NULL DEFAULT true,
	`maskKey` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `generated_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `image_signals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`storyId` int NOT NULL,
	`imageId` int,
	`action` enum('swipe_left','swipe_right','edit_start','edit_complete') NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `image_signals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `edit_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`sessionId` varchar(128) NOT NULL,
	`state` json NOT NULL,
	`previousSnapshotId` int,
	`diff` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `edit_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `semantic_annotations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshotId` int NOT NULL,
	`previousSnapshotId` int,
	`factualChanges` text NOT NULL,
	`inferredPreferences` text NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`status` enum('pending','active','archived') NOT NULL DEFAULT 'active',
	CONSTRAINT `semantic_annotations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_otps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`code` varchar(16) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_otps_id` PRIMARY KEY(`id`)
);
