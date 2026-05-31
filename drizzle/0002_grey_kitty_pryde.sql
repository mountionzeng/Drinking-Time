CREATE TABLE IF NOT EXISTS `emotion_analysis_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int,
	`birthDate` varchar(10) NOT NULL,
	`consentVersion` varchar(64) NOT NULL,
	`consentText` text,
	`dailyReference` json,
	`analysisSeed` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emotion_analysis_profiles_id` PRIMARY KEY(`id`)
);
