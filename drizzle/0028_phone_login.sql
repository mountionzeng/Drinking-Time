CREATE TABLE `phone_login_challenges` (
	`phone` varchar(16) NOT NULL,
	`challengeId` varchar(36) NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`attemptCount` int NOT NULL DEFAULT 0,
	`sentAt` timestamp,
	`consumedAt` timestamp,
	CONSTRAINT `phone_login_challenges_phone` PRIMARY KEY(`phone`)
);
--> statement-breakpoint
ALTER TABLE `account_identities` MODIFY COLUMN `provider` enum('email','wechat','google','phone') NOT NULL DEFAULT 'email';