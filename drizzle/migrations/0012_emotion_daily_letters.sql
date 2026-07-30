CREATE TABLE IF NOT EXISTS `emotion_daily_letters` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `letterDate` varchar(10) NOT NULL,
  `userMessage` text,
  `userMessageSaidAt` timestamp NULL,
  `userMessageEditedAt` timestamp NULL,
  `dailyReference` json NOT NULL,
  `analysisSeed` json NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `emotion_daily_letters_id` PRIMARY KEY(`id`),
  CONSTRAINT `emotion_daily_letters_user_date_unique`
    UNIQUE(`userId`, `letterDate`),
  KEY `emotion_daily_letters_user_date_index` (`userId`, `letterDate`),
  CONSTRAINT `emotion_daily_letters_userId_users_id_fk`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE NO ACTION
);
