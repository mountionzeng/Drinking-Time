CREATE TABLE `memory_cards` (
  `id` varchar(36) NOT NULL,
  `userId` int NOT NULL,
  `title` varchar(120) NOT NULL,
  `content` text NOT NULL,
  `kind` enum('event','thought','conversation') NOT NULL,
  `origin` enum('note','user','assistant') NOT NULL,
  `sourceStoryId` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `archived` boolean NOT NULL DEFAULT false,
  CONSTRAINT `memory_cards_id` PRIMARY KEY (`id`),
  INDEX `memory_cards_user_created_idx` (`userId`, `createdAt`, `id`)
);
