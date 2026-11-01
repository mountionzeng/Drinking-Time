CREATE TABLE `material_capture_tokens` (
	`hash` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp(3) NOT NULL,
	`expiresAt` timestamp(3) NOT NULL,
	`revokedAt` timestamp(3),
	CONSTRAINT `material_capture_tokens_hash` PRIMARY KEY(`hash`)
);
--> statement-breakpoint
CREATE TABLE `material_captures` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`inputHash` varchar(64) NOT NULL,
	`status` varchar(20) NOT NULL,
	`manifest` json NOT NULL,
	`progress` json NOT NULL,
	`storyId` int,
	`createdAt` timestamp(3) NOT NULL,
	`updatedAt` timestamp(3) NOT NULL,
	CONSTRAINT `material_captures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `capture_token_owner_idx` ON `material_capture_tokens` (`userId`);--> statement-breakpoint
CREATE INDEX `capture_owner_created_idx` ON `material_captures` (`userId`,`createdAt`);