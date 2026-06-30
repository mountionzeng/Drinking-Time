CREATE TABLE `story_timelines` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `items` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `story_timelines_id` PRIMARY KEY(`id`),
  CONSTRAINT `story_timelines_story_owner_unique` UNIQUE(`storyId`,`userId`)
);

CREATE TABLE `shot_derivation_drafts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `sourceStableShotId` varchar(128) NOT NULL,
  `sourceTakeId` int NOT NULL,
  `sourceTimeSec` float NOT NULL,
  `crop` json NOT NULL,
  `fullFrameImageUrl` text NOT NULL,
  `cropImageUrl` text NOT NULL,
  `referenceRole` enum('person','scene','object','composition'),
  `analysis` json,
  `proposal` json,
  `candidateImageIds` json,
  `provisionalStableShotId` varchar(128) NOT NULL,
  `status` enum('draft','ready','confirmed','reverted') NOT NULL DEFAULT 'draft',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `shot_derivation_drafts_id` PRIMARY KEY(`id`)
);

CREATE TABLE `story_operations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `kind` enum('derive_shot') NOT NULL,
  `status` enum('applied','reverted') NOT NULL DEFAULT 'applied',
  `beforeState` json NOT NULL,
  `afterStoryRevision` int NOT NULL,
  `afterTimelineVersion` int NOT NULL,
  `draftId` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `story_operations_id` PRIMARY KEY(`id`)
);
