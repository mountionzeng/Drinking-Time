CREATE TABLE `story_audio_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storyId` int NOT NULL,
	`userId` int NOT NULL,
	`storageKey` varchar(64) NOT NULL,
	`displayName` varchar(200) NOT NULL,
	`mediaKind` enum('narration','music','ambience','sfx','source','unknown') NOT NULL DEFAULT 'unknown',
	`sourceKind` enum('local-upload','chatcut','tts') NOT NULL,
	`sourceKey` varchar(255),
	`checksum` varchar(64),
	`status` enum('pending','ready','failed') NOT NULL DEFAULT 'pending',
	`failureReason` varchar(255),
	`durationFrames` int,
	`durationSeconds` float,
	`sampleRate` int,
	`channels` int,
	`codecName` varchar(64),
	`formatName` varchar(128),
	`provenance` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `story_audio_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_audio_assets_storage_key_unique` UNIQUE(`storageKey`),
	CONSTRAINT `story_audio_assets_id_user_unique` UNIQUE(`id`,`userId`),
	CONSTRAINT `story_audio_assets_id_owner_unique` UNIQUE(`id`,`userId`,`storyId`)
);
--> statement-breakpoint
CREATE TABLE `story_audio_import_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storyId` int NOT NULL,
	`userId` int NOT NULL,
	`operationId` varchar(128) NOT NULL,
	`requestDigest` varchar(64) NOT NULL,
	`assetId` int,
	`sourceKind` enum('local-upload','chatcut','tts') NOT NULL,
	`status` enum('pending','staged','probed','ready','failed') NOT NULL DEFAULT 'pending',
	`failureCode` varchar(128),
	`stagingKey` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `story_audio_import_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_audio_import_owner_operation_unique` UNIQUE(`storyId`,`userId`,`operationId`)
);
--> statement-breakpoint
ALTER TABLE `story_audio_assets` ADD CONSTRAINT `story_audio_assets_storyId_stories_id_fk` FOREIGN KEY (`storyId`) REFERENCES `stories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `story_audio_assets` ADD CONSTRAINT `story_audio_assets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `story_audio_import_operations` ADD CONSTRAINT `story_audio_import_operations_storyId_stories_id_fk` FOREIGN KEY (`storyId`) REFERENCES `stories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `story_audio_import_operations` ADD CONSTRAINT `story_audio_import_operations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `story_audio_import_operations` ADD CONSTRAINT `story_audio_import_asset_owner_fk` FOREIGN KEY (`assetId`,`userId`,`storyId`) REFERENCES `story_audio_assets`(`id`,`userId`,`storyId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `story_audio_assets_story_index` ON `story_audio_assets` (`storyId`,`userId`);--> statement-breakpoint
CREATE INDEX `story_audio_assets_reuse_index` ON `story_audio_assets` (`storyId`,`userId`,`sourceKind`,`sourceKey`);--> statement-breakpoint
CREATE INDEX `story_audio_import_recovery_index` ON `story_audio_import_operations` (`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `story_audio_import_asset_owner_index` ON `story_audio_import_operations` (`assetId`,`userId`,`storyId`);
