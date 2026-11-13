CREATE TABLE `story_mailbox_handoffs` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`sourceStoryId` int NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`requestHash` varchar(64) NOT NULL,
	`recipientSubject` varchar(73),
	`snapshot` json NOT NULL,
	`shareHash` varchar(64),
	`expiresAt` timestamp NOT NULL,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `story_mailbox_handoffs_id` PRIMARY KEY(`id`),
	CONSTRAINT `mailbox_handoff_code` UNIQUE(`codeHash`)
);
--> statement-breakpoint
CREATE TABLE `story_mailbox_wechat_bindings` (
	`userId` int NOT NULL,
	`subject` varchar(73) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `story_mailbox_wechat_bindings_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE INDEX `mailbox_handoff_owner` ON `story_mailbox_handoffs` (`userId`);--> statement-breakpoint
CREATE INDEX `mailbox_handoff_recipient` ON `story_mailbox_handoffs` (`recipientSubject`);