CREATE TABLE `feedback_posts` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`category` enum('bug','suggestion','praise') NOT NULL,
	`title` varchar(120) NOT NULL,
	`content` text NOT NULL,
	`tags` json NOT NULL,
	`page` varchar(32) NOT NULL,
	`status` enum('open','reviewing','adopting','adopted','closed') NOT NULL DEFAULT 'open',
	`reply` text,
	`reviewedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feedback_posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `feedback_posts` ADD CONSTRAINT `feedback_posts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `feedback_category_created_idx` ON `feedback_posts` (`category`,`createdAt`);