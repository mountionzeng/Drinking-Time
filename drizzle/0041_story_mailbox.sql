CREATE TABLE `story_mailbox_contacts` (
	`id` varchar(36) NOT NULL,
	`ownerId` int NOT NULL,
	`peerId` int NOT NULL,
	`removedAt` timestamp,
	CONSTRAINT `story_mailbox_contacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `mailbox_contact_owner_peer` UNIQUE(`ownerId`,`peerId`)
);
--> statement-breakpoint
CREATE TABLE `story_mailbox_entries` (
	`id` varchar(36) NOT NULL,
	`threadId` varchar(36) NOT NULL,
	`senderId` int NOT NULL,
	`recipientId` int NOT NULL,
	`kind` enum('sent','updated','received') NOT NULL,
	`authorName` varchar(100) NOT NULL,
	`note` text NOT NULL,
	`sourceStoryId` int NOT NULL,
	`receivedStoryId` int,
	`fingerprint` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`inventory` json NOT NULL,
	`snapshot` json NOT NULL,
	`changes` json NOT NULL,
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	`readAt` timestamp,
	CONSTRAINT `story_mailbox_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `story_mailbox_threads` (
	`id` varchar(36) NOT NULL,
	`senderId` int NOT NULL,
	`recipientId` int NOT NULL,
	`sourceStoryId` int NOT NULL,
	`copyStoryId` int,
	`sourceFingerprint` varchar(64) NOT NULL,
	`copyFingerprint` varchar(64),
	`requestHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `story_mailbox_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `mailbox_entries_thread` ON `story_mailbox_entries` (`threadId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `mailbox_entries_recipient` ON `story_mailbox_entries` (`recipientId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `mailbox_threads_sender` ON `story_mailbox_threads` (`senderId`);--> statement-breakpoint
CREATE INDEX `mailbox_threads_recipient` ON `story_mailbox_threads` (`recipientId`);