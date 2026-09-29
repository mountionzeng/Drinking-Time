CREATE TABLE `shiguang_story_access_bindings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sourceFamilyId` varchar(128) NOT NULL,
	`sourceStoryId` varchar(128) NOT NULL,
	`grantId` varchar(96) NOT NULL,
	`sourceRevisionId` varchar(128) NOT NULL,
	`sourceVersion` int NOT NULL,
	`title` varchar(120) NOT NULL,
	`status` enum('active','revoked') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shiguang_story_access_bindings_id` PRIMARY KEY(`id`),
	CONSTRAINT `shiguang_story_access_user_story_unique` UNIQUE(`userId`,`sourceFamilyId`,`sourceStoryId`),
	CONSTRAINT `shiguang_story_access_grant_unique` UNIQUE(`grantId`)
);
--> statement-breakpoint
ALTER TABLE `shiguang_story_access_bindings` ADD CONSTRAINT `shiguang_story_access_bindings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `shiguang_story_access_user_status_index` ON `shiguang_story_access_bindings` (`userId`,`status`,`id`);