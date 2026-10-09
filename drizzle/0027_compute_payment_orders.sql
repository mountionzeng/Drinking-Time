CREATE TABLE `compute_payment_orders` (
	`orderId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`requestId` varchar(36) NOT NULL,
	`channel` enum('wechat','alipay') NOT NULL,
	`merchantId` varchar(64) NOT NULL,
	`amountFen` int NOT NULL,
	`creditMinor` bigint NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'CNY',
	`status` enum('pending','paid') NOT NULL DEFAULT 'pending',
	`providerTransactionId` varchar(128),
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `compute_payment_orders_orderId` PRIMARY KEY(`orderId`),
	CONSTRAINT `compute_payment_orders_request_unique` UNIQUE(`userId`,`requestId`),
	CONSTRAINT `compute_payment_orders_transaction_unique` UNIQUE(`channel`,`providerTransactionId`)
);
--> statement-breakpoint
ALTER TABLE `credit_ledger_entries` MODIFY COLUMN `entryType` enum('gift','adjustment','consumption','refund','release','purchase') NOT NULL;--> statement-breakpoint
ALTER TABLE `compute_payment_orders` ADD CONSTRAINT `compute_payment_orders_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `compute_payment_orders_user_index` ON `compute_payment_orders` (`userId`,`createdAt`);