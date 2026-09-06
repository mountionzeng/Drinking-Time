CREATE TABLE `device_pairing_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`secretVersion` int NOT NULL DEFAULT 1,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`invalidatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `device_pairing_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `device_pairing_codes_code_hash_unique` UNIQUE(`codeHash`)
);
--> statement-breakpoint
ALTER TABLE `device_pairing_codes` ADD CONSTRAINT `device_pairing_codes_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `device_pairing_codes_user_index` ON `device_pairing_codes` (`userId`);