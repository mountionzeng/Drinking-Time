CREATE TABLE `account_credentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`kind` enum('password') NOT NULL DEFAULT 'password',
	`secret` varchar(512) NOT NULL,
	`algorithmVersion` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `account_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_credentials_user_kind_unique` UNIQUE(`userId`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `account_identities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('email','wechat') NOT NULL DEFAULT 'email',
	`subject` varchar(320) NOT NULL,
	`verifiedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `account_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_identities_provider_subject_unique` UNIQUE(`provider`,`subject`)
);
--> statement-breakpoint
CREATE TABLE `account_rate_limits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope` varchar(64) NOT NULL,
	`subject` varchar(320) NOT NULL,
	`windowStartedAt` timestamp NOT NULL DEFAULT (now()),
	`windowSeconds` int NOT NULL,
	`attemptCount` int NOT NULL DEFAULT 0,
	`blockedUntil` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `account_rate_limits_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_rate_limits_scope_subject_unique` UNIQUE(`scope`,`subject`)
);
--> statement-breakpoint
CREATE TABLE `account_verification_challenges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`purpose` enum('login','verify','recover') NOT NULL,
	`normalizedEmail` varchar(320) NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`secretVersion` int NOT NULL DEFAULT 1,
	`attemptCount` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 5,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`invalidatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `account_verification_challenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billing_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`operationId` varchar(128) NOT NULL,
	`operationType` varchar(64) NOT NULL,
	`requestHash` varchar(128) NOT NULL,
	`status` enum('created','reserved','submitted','submission_unknown','settled','released','exception') NOT NULL DEFAULT 'created',
	`maxCostMinor` bigint NOT NULL,
	`actualCostMinor` bigint,
	`storyId` int,
	`quoteExpiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billing_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_operations_operation_unique` UNIQUE(`operationId`)
);
--> statement-breakpoint
CREATE TABLE `credit_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`balanceMinor` bigint NOT NULL DEFAULT 0,
	`reservedMinor` bigint NOT NULL DEFAULT 0,
	`lifetimeSpentMinor` bigint NOT NULL DEFAULT 0,
	`currency` varchar(8) NOT NULL DEFAULT 'CNY',
	`accessEnabledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `credit_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `credit_accounts_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `credit_holds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`operationId` varchar(128) NOT NULL,
	`amountMinor` bigint NOT NULL,
	`status` enum('active','settled','released','exception') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `credit_holds_id` PRIMARY KEY(`id`),
	CONSTRAINT `credit_holds_operation_unique` UNIQUE(`operationId`)
);
--> statement-breakpoint
CREATE TABLE `credit_ledger_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`entryType` enum('gift','adjustment','consumption','refund','release') NOT NULL,
	`amountMinor` bigint NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'CNY',
	`idempotencyKey` varchar(191),
	`operationId` varchar(128),
	`giftCardId` int,
	`actorUserId` int,
	`reason` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credit_ledger_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `credit_ledger_entries_idempotency_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `data_migration_receipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceKey` varchar(128) NOT NULL,
	`batchKey` varchar(128) NOT NULL,
	`sourceHash` varchar(64) NOT NULL,
	`recordCount` int NOT NULL DEFAULT 0,
	`details` json,
	`appliedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_migration_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `data_migration_receipts_source_batch_unique` UNIQUE(`sourceKey`,`batchKey`)
);
--> statement-breakpoint
CREATE TABLE `gift_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`label` varchar(255),
	`amountMinor` bigint NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'CNY',
	`purpose` enum('access_grant','topup') NOT NULL DEFAULT 'access_grant',
	`redeemedByUserId` int,
	`redeemedAt` timestamp,
	`revokedAt` timestamp,
	`expiresAt` timestamp,
	`legacyInviteCodeId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gift_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `gift_cards_code_hash_unique` UNIQUE(`codeHash`),
	CONSTRAINT `gift_cards_legacy_invite_unique` UNIQUE(`legacyInviteCodeId`)
);
--> statement-breakpoint
CREATE TABLE `provider_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`billingOperationId` int NOT NULL,
	`attemptIndex` int NOT NULL DEFAULT 1,
	`provider` varchar(64) NOT NULL,
	`model` varchar(128),
	`providerTaskId` varchar(191),
	`receiptId` varchar(191),
	`status` enum('prepared','submitted','task_known','succeeded','charged_failure','not_charged_failure','submission_unknown') NOT NULL DEFAULT 'prepared',
	`usage` json,
	`costMinor` bigint,
	`submittedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `provider_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_attempts_operation_attempt_unique` UNIQUE(`billingOperationId`,`attemptIndex`),
	CONSTRAINT `provider_attempts_provider_task_unique` UNIQUE(`provider`,`providerTaskId`)
);
--> statement-breakpoint
CREATE TABLE `recharge_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`requestedAmountMinor` bigint NOT NULL,
	`approvedAmountMinor` bigint,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`pendingSlot` varchar(16),
	`userReason` text,
	`decisionReason` varchar(255),
	`decidedByUserId` int,
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recharge_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `recharge_requests_pending_unique` UNIQUE(`userId`,`pendingSlot`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `sessionVersion` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `account_credentials` ADD CONSTRAINT `account_credentials_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `account_identities` ADD CONSTRAINT `account_identities_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billing_operations` ADD CONSTRAINT `billing_operations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_accounts` ADD CONSTRAINT `credit_accounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_holds` ADD CONSTRAINT `credit_holds_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_ledger_entries` ADD CONSTRAINT `credit_ledger_entries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_ledger_entries` ADD CONSTRAINT `credit_ledger_entries_giftCardId_gift_cards_id_fk` FOREIGN KEY (`giftCardId`) REFERENCES `gift_cards`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_ledger_entries` ADD CONSTRAINT `credit_ledger_entries_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gift_cards` ADD CONSTRAINT `gift_cards_redeemedByUserId_users_id_fk` FOREIGN KEY (`redeemedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gift_cards` ADD CONSTRAINT `gift_cards_legacyInviteCodeId_invite_codes_id_fk` FOREIGN KEY (`legacyInviteCodeId`) REFERENCES `invite_codes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `provider_attempts` ADD CONSTRAINT `provider_attempts_billingOperationId_billing_operations_id_fk` FOREIGN KEY (`billingOperationId`) REFERENCES `billing_operations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recharge_requests` ADD CONSTRAINT `recharge_requests_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recharge_requests` ADD CONSTRAINT `recharge_requests_decidedByUserId_users_id_fk` FOREIGN KEY (`decidedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `account_identities_user_index` ON `account_identities` (`userId`);--> statement-breakpoint
CREATE INDEX `account_verification_challenges_lookup_index` ON `account_verification_challenges` (`normalizedEmail`,`purpose`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `billing_operations_user_order_index` ON `billing_operations` (`userId`,`id`);--> statement-breakpoint
CREATE INDEX `billing_operations_status_index` ON `billing_operations` (`status`);--> statement-breakpoint
CREATE INDEX `credit_holds_user_status_index` ON `credit_holds` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `credit_ledger_entries_user_order_index` ON `credit_ledger_entries` (`userId`,`id`);--> statement-breakpoint
CREATE INDEX `credit_ledger_entries_operation_index` ON `credit_ledger_entries` (`operationId`);--> statement-breakpoint
CREATE INDEX `gift_cards_redeemed_user_index` ON `gift_cards` (`redeemedByUserId`);--> statement-breakpoint
CREATE INDEX `provider_attempts_status_index` ON `provider_attempts` (`status`);--> statement-breakpoint
CREATE INDEX `recharge_requests_user_order_index` ON `recharge_requests` (`userId`,`id`);