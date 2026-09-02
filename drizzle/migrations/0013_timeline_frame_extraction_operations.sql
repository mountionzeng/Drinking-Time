CREATE TABLE `timeline_frame_extraction_operations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `requestId` varchar(160) NOT NULL,
  `inputHash` varchar(64) NOT NULL,
  `timelineFrame` int NOT NULL,
  `operationLayer` int NOT NULL,
  `claimToken` varchar(64) NOT NULL,
  `leaseUntil` timestamp NOT NULL,
  `attempt` int NOT NULL DEFAULT 1,
  `status` enum('claimed','asset_ready','succeeded','failed') NOT NULL,
  `winnerIdentity` varchar(255),
  `descriptor` json,
  `imageId` int,
  `clipId` varchar(255),
  `timelineVersion` int,
  `errorCode` varchar(128),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `timeline_frame_extraction_operations_id` PRIMARY KEY(`id`),
  CONSTRAINT `timeline_frame_extraction_owner_request_unique` UNIQUE(`storyId`,`userId`,`requestId`),
  CONSTRAINT `timeline_frame_extraction_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories`(`id`) ON DELETE CASCADE,
  CONSTRAINT `timeline_frame_extraction_user_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `timeline_frame_extraction_image_fk` FOREIGN KEY (`imageId`) REFERENCES `generated_images`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `timeline_frame_extraction_image_index` ON `timeline_frame_extraction_operations` (`imageId`);
