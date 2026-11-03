CREATE TABLE `image_generation_tasks` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`storyId` int,
	`chapterId` int,
	`moduleId` varchar(128),
	`scope` varchar(20) NOT NULL,
	`requestId` varchar(128) NOT NULL,
	`sourceHash` varchar(128),
	`provider` varchar(32) NOT NULL,
	`model` varchar(64),
	`providerTaskId` varchar(191),
	`status` varchar(24) NOT NULL,
	`candidates` json NOT NULL,
	`error` text,
	`billingOperationId` varchar(128),
	`settlement` varchar(16),
	`version` int NOT NULL DEFAULT 0,
	`pollCount` int NOT NULL DEFAULT 0,
	`nextPollAt` timestamp(3),
	`leaseOwner` varchar(64),
	`leaseUntil` timestamp(3),
	`requestSentAt` timestamp(3),
	`submittedAt` timestamp(3),
	`completedAt` timestamp(3),
	`createdAt` timestamp(3) NOT NULL,
	`updatedAt` timestamp(3) NOT NULL,
	CONSTRAINT `image_generation_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `image_task_provider_task_uq` UNIQUE(`providerTaskId`),
	CONSTRAINT `image_task_request_uq` UNIQUE(`userId`,`requestId`)
);
--> statement-breakpoint
CREATE INDEX `image_task_poll_idx` ON `image_generation_tasks` (`status`,`nextPollAt`);--> statement-breakpoint
CREATE INDEX `image_task_owner_idx` ON `image_generation_tasks` (`userId`,`storyId`);