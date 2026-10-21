CREATE TABLE `account_memory_spaces` (
	`userId` int NOT NULL,
	`revision` int unsigned NOT NULL DEFAULT 0,
	`state` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `account_memory_spaces_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `account_memory_spaces` ADD CONSTRAINT `account_memory_spaces_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;