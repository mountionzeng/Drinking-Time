CREATE TABLE `story_conversation_turns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`storyId` int NOT NULL,
	`userId` int NOT NULL,
	`clientTurnId` varchar(128) NOT NULL,
	`requestHash` varchar(128) NOT NULL,
	`userClientMessageId` varchar(128) NOT NULL,
	`assistantClientMessageId` varchar(128) NOT NULL,
	`userContent` text NOT NULL,
	`assistantContent` text,
	`generationStatus` enum('pending','completed','failed','unknown') NOT NULL DEFAULT 'pending',
	`appendStatus` enum('pending','appended') NOT NULL DEFAULT 'pending',
	`generationAttempt` int NOT NULL DEFAULT 1,
	`contextMessageId` int,
	`claimToken` varchar(128),
	`failureMessage` text,
	`claimedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	`appendedAt` timestamp,
	CONSTRAINT `story_conversation_turns_id` PRIMARY KEY(`id`),
	CONSTRAINT `story_conversation_turns_story_turn_unique` UNIQUE(`storyId`,`userId`,`clientTurnId`),
	CONSTRAINT `story_conversation_turns_user_message_unique` UNIQUE(`storyId`,`userId`,`userClientMessageId`),
	CONSTRAINT `story_conversation_turns_assistant_message_unique` UNIQUE(`storyId`,`userId`,`assistantClientMessageId`)
);
--> statement-breakpoint
ALTER TABLE `story_conversation_messages` ADD `turnId` int;--> statement-breakpoint
ALTER TABLE `story_conversation_messages` ADD CONSTRAINT `story_conversation_messages_turn_role_unique` UNIQUE(`turnId`,`role`);--> statement-breakpoint
ALTER TABLE `story_conversation_turns` ADD CONSTRAINT `story_conversation_turns_conversationId_story_conversations_id_fk` FOREIGN KEY (`conversationId`) REFERENCES `story_conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `story_conversation_turns` ADD CONSTRAINT `story_conversation_turns_storyId_stories_id_fk` FOREIGN KEY (`storyId`) REFERENCES `stories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `story_conversation_turns` ADD CONSTRAINT `story_conversation_turns_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `story_conversation_turns_order` ON `story_conversation_turns` (`conversationId`,`id`);--> statement-breakpoint
ALTER TABLE `story_conversation_messages` ADD CONSTRAINT `story_conversation_messages_turnId_story_conversation_turns_id_fk` FOREIGN KEY (`turnId`) REFERENCES `story_conversation_turns`(`id`) ON DELETE set null ON UPDATE no action;
