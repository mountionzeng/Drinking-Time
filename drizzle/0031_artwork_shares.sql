CREATE TABLE `artwork_shares` (
  `tokenHash` varchar(64) NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `fingerprint` varchar(64) NOT NULL,
  `snapshot` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revokedAt` timestamp NULL,
  CONSTRAINT `artwork_shares_tokenHash` PRIMARY KEY (`tokenHash`)
);
--> statement-breakpoint
CREATE INDEX `artwork_shares_owner` ON `artwork_shares` (`userId`,`storyId`);
