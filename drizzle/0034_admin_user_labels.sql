CREATE TABLE `admin_user_labels` (
	`userId` int NOT NULL,
	`category` enum('unclassified','own','test','external') NOT NULL,
	`updatedBy` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_user_labels_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `admin_user_labels` ADD CONSTRAINT `admin_user_labels_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_user_labels` ADD CONSTRAINT `admin_user_labels_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;