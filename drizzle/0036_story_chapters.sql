CREATE TABLE `chapter_exports` (
	`packageId` varchar(80) NOT NULL,
	`chapterId` int NOT NULL,
	`storyId` int NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chapter_exports_packageId` PRIMARY KEY(`packageId`)
);
--> statement-breakpoint
CREATE TABLE `chapter_imports` (
	`userId` int NOT NULL,
	`requestId` varchar(64) NOT NULL,
	`requestHash` varchar(64) NOT NULL,
	`storyId` int NOT NULL,
	`chapterId` int,
	`outcome` varchar(16) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chapter_imports_user_request` UNIQUE(`userId`,`requestId`)
);
--> statement-breakpoint
CREATE TABLE `chapter_return_candidates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chapterId` int NOT NULL,
	`storyId` int NOT NULL,
	`userId` int NOT NULL,
	`packageId` varchar(80) NOT NULL,
	`senderName` varchar(40) NOT NULL,
	`title` varchar(200) NOT NULL,
	`blocks` json NOT NULL,
	`layout` json,
	`status` enum('pending','adopted','dismissed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chapter_return_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `chapter_return_candidates_package` UNIQUE(`userId`,`packageId`)
);
--> statement-breakpoint
CREATE TABLE `story_chapter_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chapterId` int NOT NULL,
	`userId` int NOT NULL,
	`version` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`blocks` json NOT NULL,
	`layout` json,
	`reason` varchar(32) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `story_chapter_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_chapter_versions_chapter_version` UNIQUE(`chapterId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `story_chapters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storyId` int NOT NULL,
	`userId` int NOT NULL,
	`position` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`blocks` json NOT NULL,
	`layout` json,
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `story_chapters_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_chapters_id_owner_unique` UNIQUE(`id`,`userId`)
);
--> statement-breakpoint
CREATE INDEX `chapter_exports_owner` ON `chapter_exports` (`userId`,`chapterId`);--> statement-breakpoint
CREATE INDEX `chapter_return_candidates_chapter` ON `chapter_return_candidates` (`chapterId`,`status`);--> statement-breakpoint
CREATE INDEX `story_chapters_story_position` ON `story_chapters` (`storyId`,`position`);