CREATE TABLE `activity_journey_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `platform` varchar(16) NOT NULL,
  `eventName` varchar(40) NOT NULL,
  `result` varchar(16) NOT NULL DEFAULT 'none',
  `failureCategory` varchar(32),
  `subjectKind` varchar(16),
  `subjectRef` int,
  `dedupeKey` varchar(80) NOT NULL,
  `occurredAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `activity_journey_events_id` PRIMARY KEY(`id`),
  CONSTRAINT `activity_journey_user_dedupe` UNIQUE(`userId`, `dedupeKey`),
  CONSTRAINT `activity_journey_user_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  KEY `activity_journey_occurred_idx` (`occurredAt`),
  KEY `activity_journey_event_time_idx` (`eventName`, `occurredAt`),
  KEY `activity_journey_user_time_idx` (`userId`, `occurredAt`)
);
