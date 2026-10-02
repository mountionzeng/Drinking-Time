CREATE TABLE `story_context_share_imports` (
	`tokenHash` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`storyId` int NOT NULL,
	CONSTRAINT `story_context_share_import_receipt` UNIQUE(`tokenHash`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `story_context_shares` (
	`tokenHash` varchar(64) NOT NULL,
	`storyId` int NOT NULL,
	`userId` int NOT NULL,
	`snapshot` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	CONSTRAINT `story_context_shares_tokenHash` PRIMARY KEY(`tokenHash`)
);
--> statement-breakpoint
CREATE INDEX `story_context_shares_owner` ON `story_context_shares` (`storyId`,`userId`);