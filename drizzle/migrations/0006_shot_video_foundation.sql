ALTER TABLE `generated_images` ADD `shotIdentity` varchar(128);
--> statement-breakpoint
CREATE TABLE `video_takes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `stableShotId` varchar(128) NOT NULL,
  `sourceImageId` int,
  `status` enum('submitted','processing','available','failed','timeout','unfollowable') NOT NULL DEFAULT 'submitted',
  `taskId` varchar(255),
  `provider` varchar(64) NOT NULL DEFAULT '302',
  `model` varchar(128) NOT NULL,
  `prompt` text NOT NULL,
  `subtitle` text,
  `durationSec` float,
  `aspectRatio` varchar(32) NOT NULL DEFAULT '16:9',
  `videoKey` varchar(512),
  `videoUrl` text,
  `errorMessage` text,
  `parameterSnapshot` json,
  `idempotencyKey` varchar(255),
  `extractionCapability` enum('available','unavailable') NOT NULL DEFAULT 'unavailable',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `video_takes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `video_take_ranges` (
  `id` int AUTO_INCREMENT NOT NULL,
  `takeId` int NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `stableShotId` varchar(128) NOT NULL,
  `startSec` float NOT NULL,
  `endSec` float NOT NULL,
  `label` varchar(255),
  `source` enum('manual','extracted') NOT NULL DEFAULT 'manual',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `video_take_ranges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `video_timeline_selections` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `stableShotId` varchar(128) NOT NULL,
  `takeId` int NOT NULL,
  `rangeId` int,
  `selectionType` enum('full_take','range') NOT NULL DEFAULT 'full_take',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `video_timeline_selections_id` PRIMARY KEY(`id`)
);
