CREATE TABLE `activity_journey_v2_events` (
	`userId` int NOT NULL,
	`schemaVersion` int NOT NULL,
	`platform` enum('web','miniprogram','unknown') NOT NULL,
	`eventName` enum('creation.entered','generation.submitted','generation.resolved','result.opened') NOT NULL,
	`result` enum('none','succeeded','failed','cancelled','timeout','unknown') NOT NULL,
	`subjectKind` enum('image','video'),
	`subjectRef` int,
	`visitKey` varchar(64),
	`attemptKey` varchar(64),
	`dedupeKey` varchar(64) NOT NULL,
	`occurredAtMs` bigint NOT NULL,
	CONSTRAINT `activity_journey_v2_events_dedupeKey` PRIMARY KEY(`dedupeKey`)
);
--> statement-breakpoint
ALTER TABLE `activity_journey_v2_events` ADD CONSTRAINT `activity_journey_v2_events_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activity_v2_time_idx` ON `activity_journey_v2_events` (`schemaVersion`,`occurredAtMs`);--> statement-breakpoint
CREATE INDEX `activity_v2_attempt_idx` ON `activity_journey_v2_events` (`userId`,`attemptKey`,`eventName`);--> statement-breakpoint
CREATE INDEX `activity_v2_result_idx` ON `activity_journey_v2_events` (`userId`,`subjectKind`,`subjectRef`,`eventName`);