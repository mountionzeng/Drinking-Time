CREATE TABLE IF NOT EXISTS `creator_visual_preferences` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `seasonalProfile` enum(
    'northern_four_seasons',
    'southern_four_seasons',
    'tropical_or_non_four_season',
    'unknown'
  ) NOT NULL DEFAULT 'unknown',
  `timeZone` varchar(64),
  `source` enum('manual','browser_confirmed','cleared') NOT NULL DEFAULT 'cleared',
  `revision` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `creator_visual_preferences_id` PRIMARY KEY (`id`),
  CONSTRAINT `creator_visual_preferences_user_unique` UNIQUE (`userId`),
  CONSTRAINT `creator_visual_preferences_user_fk`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE NO ACTION
);
