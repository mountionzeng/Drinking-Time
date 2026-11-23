CREATE TABLE `platform_registration_challenges` (
	`id` varchar(36) NOT NULL,
	`browserHash` varchar(64) NOT NULL,
	`openIdHash` varchar(64) NOT NULL,
	`name` varchar(255),
	`loginMethod` varchar(64),
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`otpChannel` enum('email','phone'),
	`otpSubjectHash` varchar(64),
	`otpCodeHash` varchar(64),
	`otpExpiresAt` timestamp,
	`otpAttempts` int NOT NULL DEFAULT 0,
	CONSTRAINT `platform_registration_challenges_id` PRIMARY KEY(`id`)
);
