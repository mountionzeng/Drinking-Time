CREATE TABLE `web_login_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lookupHash` varchar(64) NOT NULL,
	`verifierHash` varchar(64) NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`secretVersion` int NOT NULL DEFAULT 1,
	`status` enum('pending','scanned','confirmed','denied','merge_required','consumed') NOT NULL DEFAULT 'pending',
	`mode` enum('login','bind') NOT NULL DEFAULT 'login',
	`bindUserId` int,
	`userId` int,
	`clientHint` varchar(40) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`confirmedAt` timestamp,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `web_login_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `web_login_requests_lookup_unique` UNIQUE(`lookupHash`),
	CONSTRAINT `web_login_requests_code_unique` UNIQUE(`codeHash`)
);
--> statement-breakpoint
ALTER TABLE `web_login_requests` ADD CONSTRAINT `web_login_requests_bindUserId_users_id_fk` FOREIGN KEY (`bindUserId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `web_login_requests` ADD CONSTRAINT `web_login_requests_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `web_login_requests_expires_index` ON `web_login_requests` (`expiresAt`);