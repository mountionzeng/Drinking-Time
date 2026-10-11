CREATE TABLE `downstream_regeneration_candidates` (
	`id` varchar(36) NOT NULL,
	`storyId` int NOT NULL,
	`userId` int NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `downstream_regeneration_candidates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `regeneration_story_owner_idx` ON `downstream_regeneration_candidates` (`storyId`,`userId`);