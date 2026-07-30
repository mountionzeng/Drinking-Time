CREATE TABLE IF NOT EXISTS `access_sessions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `visitId` varchar(64) NOT NULL,
  `siteHost` varchar(255) NOT NULL,
  `startedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `durationSeconds` int NOT NULL DEFAULT 0,
  CONSTRAINT `access_sessions_id` PRIMARY KEY(`id`),
  CONSTRAINT `access_sessions_visit_unique`
    UNIQUE(`userId`, `visitId`, `siteHost`),
  KEY `access_sessions_user_host_index` (`userId`, `siteHost`),
  KEY `access_sessions_last_seen_index` (`lastSeenAt`),
  CONSTRAINT `access_sessions_userId_users_id_fk`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE NO ACTION
);
