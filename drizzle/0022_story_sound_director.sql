CREATE TABLE `story_sound_plan_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicId` varchar(64) NOT NULL,
	`storyId` int NOT NULL,
	`userId` int NOT NULL,
	`versionNumber` int NOT NULL,
	`contentDigest` varchar(64) NOT NULL,
	`evidenceSnapshotDigest` varchar(64) NOT NULL,
	`sourceRevisions` json NOT NULL,
	`draft` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `story_sound_plan_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_sound_versions_public_id_unique` UNIQUE(`publicId`),
	CONSTRAINT `story_sound_versions_number_unique` UNIQUE(`storyId`,`userId`,`versionNumber`),
	CONSTRAINT `story_sound_versions_content_unique` UNIQUE(`storyId`,`userId`,`contentDigest`,`evidenceSnapshotDigest`)
);
--> statement-breakpoint
CREATE TABLE `story_sound_row_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicId` varchar(64) NOT NULL,
	`storyId` int,
	`storyIdSnapshot` int NOT NULL,
	`userId` int NOT NULL,
	`rowId` varchar(128) NOT NULL,
	`versionId` varchar(64) NOT NULL,
	`requestDigest` varchar(64) NOT NULL,
	`quoteId` varchar(128) NOT NULL,
	`state` enum('prepared','submitting','ready','failed','submission_unknown','provider_succeeded_media_missing') NOT NULL,
	`amountMinorUnits` bigint NOT NULL,
	`currency` varchar(16) NOT NULL,
	`assetId` int,
	`timelineClipId` varchar(128),
	`tombstonedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `story_sound_row_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_sound_row_ops_public_id_unique` UNIQUE(`publicId`),
	CONSTRAINT `story_sound_row_ops_owner_request_unique` UNIQUE(`userId`,`storyIdSnapshot`,`rowId`,`requestDigest`)
);
--> statement-breakpoint
CREATE TABLE `story_sound_workspaces` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storyId` int NOT NULL,
	`userId` int NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`interviewStatus` enum('interviewing','draft','needs_review') NOT NULL,
	`currentStepId` varchar(128),
	`restoredFromVersionId` varchar(64),
	`draft` json NOT NULL,
	`selectionByRowId` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `story_sound_workspaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_sound_workspaces_owner_unique` UNIQUE(`storyId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `story_voice_activation_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicId` varchar(64) NOT NULL,
	`profileId` int NOT NULL,
	`profilePublicId` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`provider` varchar(64) NOT NULL,
	`priceVersion` varchar(128) NOT NULL,
	`requestDigest` varchar(64) NOT NULL,
	`state` enum('prepared','active','failed','submission_unknown') NOT NULL DEFAULT 'prepared',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `story_voice_activation_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_voice_activation_public_id_unique` UNIQUE(`publicId`),
	CONSTRAINT `story_voice_activation_idempotency_unique` UNIQUE(`userId`,`profilePublicId`,`provider`,`priceVersion`)
);
--> statement-breakpoint
CREATE TABLE `story_voice_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicId` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`profile` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `story_voice_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_voice_profiles_public_id_unique` UNIQUE(`publicId`),
	CONSTRAINT `story_voice_profiles_id_owner_unique` UNIQUE(`id`,`userId`),
	CONSTRAINT `story_voice_profiles_owner_public_unique` UNIQUE(`userId`,`publicId`)
);
--> statement-breakpoint
ALTER TABLE `stories` ADD CONSTRAINT `stories_id_owner_unique` UNIQUE(`id`,`userId`);--> statement-breakpoint
ALTER TABLE `story_sound_plan_versions` ADD CONSTRAINT `story_sound_versions_story_owner_fk` FOREIGN KEY (`storyId`,`userId`) REFERENCES `stories`(`id`,`userId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `story_sound_workspaces` ADD CONSTRAINT `story_sound_workspaces_story_owner_fk` FOREIGN KEY (`storyId`,`userId`) REFERENCES `stories`(`id`,`userId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `story_voice_activation_operations` ADD CONSTRAINT `story_voice_activation_profile_owner_fk` FOREIGN KEY (`profileId`,`userId`) REFERENCES `story_voice_profiles`(`id`,`userId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `story_voice_profiles` ADD CONSTRAINT `story_voice_profiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `story_sound_row_ops_owner_index` ON `story_sound_row_operations` (`storyId`,`userId`);