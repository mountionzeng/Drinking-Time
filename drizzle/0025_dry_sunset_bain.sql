CREATE TABLE `shiguang_bridge_nonces` (
	`nonceHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shiguang_bridge_nonces_nonceHash` PRIMARY KEY(`nonceHash`)
);
--> statement-breakpoint
CREATE INDEX `shiguang_bridge_nonces_expires_index` ON `shiguang_bridge_nonces` (`expiresAt`);