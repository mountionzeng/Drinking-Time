CREATE TABLE `emotion_daily_letter_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`letterDate` varchar(10) NOT NULL,
	`actionId` varchar(191) NOT NULL,
	`state` enum('in_flight','committed','failed','rejected_stale') NOT NULL DEFAULT 'in_flight',
	`inputCutoffAt` timestamp NOT NULL,
	`privacyEpoch` int NOT NULL,
	`committedVersionId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emotion_daily_letter_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `emotion_daily_letter_attempts_action_unique` UNIQUE(`userId`,`letterDate`,`actionId`)
);
--> statement-breakpoint
CREATE TABLE `emotion_daily_letter_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`letterDate` varchar(10) NOT NULL,
	`versionNumber` int NOT NULL,
	`envelope` json NOT NULL,
	`payload` json,
	`privacyEpoch` int NOT NULL,
	`actionId` varchar(191) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emotion_daily_letter_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `emotion_daily_letter_versions_version_unique` UNIQUE(`userId`,`letterDate`,`versionNumber`),
	CONSTRAINT `emotion_daily_letter_versions_action_unique` UNIQUE(`userId`,`letterDate`,`actionId`),
	CONSTRAINT `emotion_daily_letter_versions_id_user_unique` UNIQUE(`id`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `personal_memory_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sourceId` int NOT NULL,
	`sourceType` varchar(32) NOT NULL,
	`sourceKey` varchar(191) NOT NULL,
	`sourceRevision` varchar(64) NOT NULL,
	`actionKind` varchar(32) NOT NULL,
	`actionId` varchar(191) NOT NULL,
	`occurredOn` varchar(10) NOT NULL,
	`occurredAt` timestamp NOT NULL,
	`excerpt` text,
	`contentHash` varchar(128),
	`display` json,
	`contentScrubbed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personal_memory_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_memory_events_identity_unique` UNIQUE(`userId`,`sourceType`,`sourceKey`,`sourceRevision`,`actionKind`,`actionId`),
	CONSTRAINT `personal_memory_events_id_user_unique` UNIQUE(`id`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `personal_memory_evidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`insightId` int NOT NULL,
	`eventId` int NOT NULL,
	`sourceRevision` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personal_memory_evidence_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_memory_evidence_edge_unique` UNIQUE(`insightId`,`eventId`)
);
--> statement-breakpoint
CREATE TABLE `personal_memory_insights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`lineageKey` varchar(191) NOT NULL,
	`revision` int NOT NULL,
	`state` enum('active','superseded','archived','unsupported','forgotten') NOT NULL DEFAULT 'active',
	`origin` enum('user_stated','user_corrected','inferred') NOT NULL,
	`category` enum('fact','preference','relationship','goal','concern','reflection') NOT NULL,
	`text` text,
	`scope` json,
	`confidence` float NOT NULL DEFAULT 0,
	`allowProactiveMention` boolean NOT NULL DEFAULT false,
	`supersededByInsightId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `personal_memory_insights_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_memory_insights_lineage_unique` UNIQUE(`userId`,`lineageKey`,`revision`),
	CONSTRAINT `personal_memory_insights_id_user_unique` UNIQUE(`id`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `personal_memory_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`eventId` int NOT NULL,
	`operationId` varchar(128) NOT NULL,
	`extractorVersion` varchar(64) NOT NULL,
	`state` enum('pending','claimed','succeeded','failed','permanently_failed','cancelled') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`leaseToken` varchar(64),
	`leaseExpiresAt` timestamp,
	`availableAt` timestamp NOT NULL,
	`lastErrorKind` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `personal_memory_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_memory_jobs_operation_unique` UNIQUE(`operationId`),
	CONSTRAINT `personal_memory_jobs_event_unique` UNIQUE(`eventId`,`extractorVersion`)
);
--> statement-breakpoint
CREATE TABLE `personal_memory_privacy_epochs` (
	`userId` int NOT NULL,
	`epoch` int NOT NULL DEFAULT 1,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `personal_memory_privacy_epochs_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `personal_memory_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sourceType` varchar(32) NOT NULL,
	`sourceKey` varchar(191) NOT NULL,
	`storyId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personal_memory_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_memory_sources_user_unique` UNIQUE(`userId`,`sourceType`,`sourceKey`),
	CONSTRAINT `personal_memory_sources_id_user_unique` UNIQUE(`id`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `personal_memory_suppressions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`lineageKey` varchar(191) NOT NULL,
	`suppressedEventIds` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personal_memory_suppressions_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_memory_suppressions_lineage_unique` UNIQUE(`userId`,`lineageKey`)
);
--> statement-breakpoint
ALTER TABLE `emotion_daily_letters` ADD `currentVersionId` int;--> statement-breakpoint
ALTER TABLE `emotion_daily_letter_attempts` ADD CONSTRAINT `emotion_daily_letter_attempts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emotion_daily_letter_attempts` ADD CONSTRAINT `emotion_daily_letter_attempts_version_fk` FOREIGN KEY (`committedVersionId`,`userId`) REFERENCES `emotion_daily_letter_versions`(`id`,`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emotion_daily_letter_versions` ADD CONSTRAINT `emotion_daily_letter_versions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_events` ADD CONSTRAINT `personal_memory_events_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_events` ADD CONSTRAINT `personal_memory_events_source_fk` FOREIGN KEY (`sourceId`,`userId`) REFERENCES `personal_memory_sources`(`id`,`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_evidence` ADD CONSTRAINT `personal_memory_evidence_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_evidence` ADD CONSTRAINT `personal_memory_evidence_insight_fk` FOREIGN KEY (`insightId`,`userId`) REFERENCES `personal_memory_insights`(`id`,`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_evidence` ADD CONSTRAINT `personal_memory_evidence_event_fk` FOREIGN KEY (`eventId`,`userId`) REFERENCES `personal_memory_events`(`id`,`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_insights` ADD CONSTRAINT `personal_memory_insights_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_jobs` ADD CONSTRAINT `personal_memory_jobs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_jobs` ADD CONSTRAINT `personal_memory_jobs_event_fk` FOREIGN KEY (`eventId`,`userId`) REFERENCES `personal_memory_events`(`id`,`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_privacy_epochs` ADD CONSTRAINT `personal_memory_privacy_epochs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_sources` ADD CONSTRAINT `personal_memory_sources_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `personal_memory_suppressions` ADD CONSTRAINT `personal_memory_suppressions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `personal_memory_events_timeline_index` ON `personal_memory_events` (`userId`,`occurredAt`,`id`);--> statement-breakpoint
CREATE INDEX `personal_memory_insights_user_state_index` ON `personal_memory_insights` (`userId`,`state`);--> statement-breakpoint
CREATE INDEX `personal_memory_jobs_claim_index` ON `personal_memory_jobs` (`state`,`availableAt`);