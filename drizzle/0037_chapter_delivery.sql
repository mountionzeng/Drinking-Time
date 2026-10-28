CREATE TABLE `chapter_deliveries` (
	`deliveryId` varchar(36) NOT NULL,
	`packageId` varchar(80) NOT NULL,
	`senderUserId` int NOT NULL,
	`recipientUserId` int,
	`claimTokenHash` varchar(64),
	`claimExpiresAt` timestamp,
	`kind` enum('send','return') NOT NULL,
	`status` enum('pending','kept','appended','adopted','declined','expired') NOT NULL DEFAULT 'pending',
	`requestId` varchar(64) NOT NULL,
	`requestHash` varchar(64) NOT NULL,
	`readyAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `chapter_deliveries_deliveryId` PRIMARY KEY(`deliveryId`),
	CONSTRAINT `chapter_deliveries_sender_request` UNIQUE(`senderUserId`,`requestId`)
);
--> statement-breakpoint
CREATE TABLE `chapter_delivery_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`packageId` varchar(80) NOT NULL,
	`assetId` varchar(80) NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`mime` varchar(40) NOT NULL,
	`bytes` int NOT NULL,
	`storageKey` varchar(255),
	`uploadTokenHash` varchar(64),
	`uploadExpiresAt` timestamp,
	`uploadedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chapter_delivery_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `chapter_delivery_assets_package_asset` UNIQUE(`packageId`,`assetId`)
);
--> statement-breakpoint
CREATE TABLE `chapter_packages` (
	`packageId` varchar(80) NOT NULL,
	`rootPackageId` varchar(80) NOT NULL,
	`parentPackageId` varchar(80),
	`senderUserId` int NOT NULL,
	`packageHash` varchar(64) NOT NULL,
	`packageJson` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `chapter_packages_packageId` PRIMARY KEY(`packageId`)
);
--> statement-breakpoint
CREATE INDEX `chapter_deliveries_recipient_status` ON `chapter_deliveries` (`recipientUserId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `chapter_deliveries_sender_status` ON `chapter_deliveries` (`senderUserId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `chapter_deliveries_package` ON `chapter_deliveries` (`packageId`,`kind`);--> statement-breakpoint
CREATE INDEX `chapter_delivery_assets_upload_token` ON `chapter_delivery_assets` (`uploadTokenHash`);--> statement-breakpoint
CREATE INDEX `chapter_delivery_assets_hash` ON `chapter_delivery_assets` (`sha256`);--> statement-breakpoint
CREATE INDEX `chapter_packages_root_sender` ON `chapter_packages` (`rootPackageId`,`senderUserId`);--> statement-breakpoint
CREATE INDEX `chapter_packages_sender_created` ON `chapter_packages` (`senderUserId`,`createdAt`);