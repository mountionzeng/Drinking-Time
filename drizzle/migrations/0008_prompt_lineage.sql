CREATE TABLE `story_prompt_states` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `version` int NOT NULL DEFAULT 0,
  `migrationStatus` enum('legacy','migrating','migrated') NOT NULL DEFAULT 'legacy',
  `migratedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `story_prompt_states_id` PRIMARY KEY (`id`),
  CONSTRAINT `story_prompt_states_story_owner_unique` UNIQUE (`storyId`,`userId`),
  CONSTRAINT `story_prompt_states_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `story_prompt_states_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `prompt_nodes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `stableShotId` varchar(128) NOT NULL DEFAULT '',
  `scope` enum('story','shot','modality') NOT NULL,
  `modality` enum('shared','dialogue','image','video') NOT NULL,
  `dimension` varchar(128) NOT NULL,
  `currentRevisionId` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `prompt_nodes_id` PRIMARY KEY (`id`),
  CONSTRAINT `prompt_nodes_semantic_key_unique` UNIQUE (`storyId`,`userId`,`stableShotId`,`scope`,`modality`,`dimension`),
  CONSTRAINT `prompt_nodes_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_nodes_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `prompt_nodes_story_lookup` (`storyId`,`userId`,`stableShotId`)
);

CREATE TABLE `prompt_revisions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `nodeId` int NOT NULL,
  `parentRevisionId` int NULL,
  `content` text NOT NULL,
  `authorType` enum('user','agent','system','migration') NOT NULL,
  `authorUserId` int NULL,
  `reason` text NULL,
  `source` varchar(128) NULL,
  `status` enum('candidate','confirmed','rejected') NOT NULL DEFAULT 'candidate',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `decidedAt` timestamp NULL,
  CONSTRAINT `prompt_revisions_id` PRIMARY KEY (`id`),
  CONSTRAINT `prompt_revisions_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_revisions_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_revisions_node_fk` FOREIGN KEY (`nodeId`) REFERENCES `prompt_nodes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_revisions_parent_fk` FOREIGN KEY (`parentRevisionId`) REFERENCES `prompt_revisions` (`id`) ON DELETE SET NULL,
  INDEX `prompt_revisions_node_history` (`nodeId`,`id`),
  INDEX `prompt_revisions_story_candidates` (`storyId`,`userId`,`status`)
);

ALTER TABLE `prompt_nodes`
  ADD CONSTRAINT `prompt_nodes_current_revision_fk`
  FOREIGN KEY (`currentRevisionId`) REFERENCES `prompt_revisions` (`id`) ON DELETE SET NULL;

CREATE TABLE `prompt_node_bindings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `nodeId` int NOT NULL,
  `stableShotId` varchar(128) NOT NULL DEFAULT '',
  `modality` enum('shared','dialogue','image','video') NOT NULL,
  `sortOrder` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `prompt_node_bindings_id` PRIMARY KEY (`id`),
  CONSTRAINT `prompt_node_bindings_key_unique` UNIQUE (`storyId`,`userId`,`nodeId`,`stableShotId`,`modality`),
  CONSTRAINT `prompt_node_bindings_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_node_bindings_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_node_bindings_node_fk` FOREIGN KEY (`nodeId`) REFERENCES `prompt_nodes` (`id`) ON DELETE CASCADE,
  INDEX `prompt_node_bindings_shot_order` (`storyId`,`userId`,`stableShotId`,`modality`,`sortOrder`)
);

CREATE TABLE `prompt_compilations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `stableShotId` varchar(128) NOT NULL,
  `modality` enum('dialogue','image','video') NOT NULL,
  `finalText` text NOT NULL,
  `inputFingerprint` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `prompt_compilations_id` PRIMARY KEY (`id`),
  CONSTRAINT `prompt_compilations_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_compilations_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `prompt_compilations_shot_modality` (`storyId`,`userId`,`stableShotId`,`modality`,`id`)
);

CREATE TABLE `prompt_compilation_inputs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `compilationId` int NOT NULL,
  `revisionId` int NOT NULL,
  `position` int NOT NULL,
  CONSTRAINT `prompt_compilation_inputs_id` PRIMARY KEY (`id`),
  CONSTRAINT `prompt_compilation_inputs_order_unique` UNIQUE (`compilationId`,`position`),
  CONSTRAINT `prompt_compilation_inputs_compilation_fk` FOREIGN KEY (`compilationId`) REFERENCES `prompt_compilations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_compilation_inputs_revision_fk` FOREIGN KEY (`revisionId`) REFERENCES `prompt_revisions` (`id`) ON DELETE RESTRICT
);

CREATE TABLE `prompt_compilation_heads` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `stableShotId` varchar(128) NOT NULL,
  `modality` enum('dialogue','image','video') NOT NULL,
  `currentCompilationId` int NOT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `prompt_compilation_heads_id` PRIMARY KEY (`id`),
  CONSTRAINT `prompt_compilation_heads_current_unique` UNIQUE (`storyId`,`userId`,`stableShotId`,`modality`),
  CONSTRAINT `prompt_compilation_heads_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_compilation_heads_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_compilation_heads_compilation_fk` FOREIGN KEY (`currentCompilationId`) REFERENCES `prompt_compilations` (`id`) ON DELETE RESTRICT
);

CREATE TABLE `story_conversations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `story_conversations_id` PRIMARY KEY (`id`),
  CONSTRAINT `story_conversations_story_owner_unique` UNIQUE (`storyId`,`userId`),
  CONSTRAINT `story_conversations_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `story_conversations_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `story_conversation_messages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `conversationId` int NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `role` enum('user','assistant','system') NOT NULL,
  `content` text NOT NULL,
  `source` varchar(128) NULL,
  `clientMessageId` varchar(128) NULL,
  `candidateRevisionId` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `story_conversation_messages_id` PRIMARY KEY (`id`),
  CONSTRAINT `story_conversation_messages_client_unique` UNIQUE (`conversationId`,`clientMessageId`),
  CONSTRAINT `story_conversation_messages_conversation_fk` FOREIGN KEY (`conversationId`) REFERENCES `story_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `story_conversation_messages_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `story_conversation_messages_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `story_conversation_messages_revision_fk` FOREIGN KEY (`candidateRevisionId`) REFERENCES `prompt_revisions` (`id`) ON DELETE SET NULL,
  INDEX `story_conversation_messages_order` (`conversationId`,`id`)
);

CREATE TABLE `story_message_references` (
  `id` int AUTO_INCREMENT NOT NULL,
  `messageId` int NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `objectType` varchar(64) NOT NULL,
  `objectId` varchar(255) NOT NULL,
  `objectVersion` varchar(128) NULL,
  `selection` json NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `story_message_references_id` PRIMARY KEY (`id`),
  CONSTRAINT `story_message_references_message_fk` FOREIGN KEY (`messageId`) REFERENCES `story_conversation_messages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `story_message_references_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `story_message_references_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `story_message_references_message` (`messageId`)
);

CREATE TABLE `art_prompt_libraries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `kind` enum('system','user') NOT NULL,
  `ownerUserId` int NULL,
  `name` varchar(255) NOT NULL,
  `description` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `art_prompt_libraries_id` PRIMARY KEY (`id`),
  CONSTRAINT `art_prompt_libraries_owner_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `art_prompt_libraries_owner_name` (`ownerUserId`,`name`)
);

CREATE TABLE `art_prompt_library_versions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `libraryId` int NOT NULL,
  `version` int NOT NULL,
  `status` enum('draft','published') NOT NULL DEFAULT 'draft',
  `contentFingerprint` varchar(128) NOT NULL,
  `source` varchar(255) NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `publishedAt` timestamp NULL,
  CONSTRAINT `art_prompt_library_versions_id` PRIMARY KEY (`id`),
  CONSTRAINT `art_prompt_library_versions_number_unique` UNIQUE (`libraryId`,`version`),
  CONSTRAINT `art_prompt_library_versions_fingerprint_unique` UNIQUE (`libraryId`,`contentFingerprint`),
  CONSTRAINT `art_prompt_library_versions_library_fk` FOREIGN KEY (`libraryId`) REFERENCES `art_prompt_libraries` (`id`) ON DELETE CASCADE
);

CREATE TABLE `art_prompt_library_items` (
  `id` int AUTO_INCREMENT NOT NULL,
  `libraryVersionId` int NOT NULL,
  `dimension` varchar(128) NOT NULL,
  `content` text NOT NULL,
  `negativeContent` text NULL,
  `sourceRevisionId` int NULL,
  `sortOrder` int NOT NULL DEFAULT 0,
  CONSTRAINT `art_prompt_library_items_id` PRIMARY KEY (`id`),
  CONSTRAINT `art_prompt_library_items_version_fk` FOREIGN KEY (`libraryVersionId`) REFERENCES `art_prompt_library_versions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `art_prompt_library_items_revision_fk` FOREIGN KEY (`sourceRevisionId`) REFERENCES `prompt_revisions` (`id`) ON DELETE SET NULL,
  INDEX `art_prompt_library_items_version_order` (`libraryVersionId`,`sortOrder`)
);

CREATE TABLE `story_art_prompt_bindings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `libraryVersionId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `story_art_prompt_bindings_id` PRIMARY KEY (`id`),
  CONSTRAINT `story_art_prompt_bindings_story_unique` UNIQUE (`storyId`,`userId`),
  CONSTRAINT `story_art_prompt_bindings_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `story_art_prompt_bindings_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `story_art_prompt_bindings_version_fk` FOREIGN KEY (`libraryVersionId`) REFERENCES `art_prompt_library_versions` (`id`) ON DELETE RESTRICT
);

CREATE TABLE `prompt_operation_receipts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `storyId` int NOT NULL,
  `userId` int NOT NULL,
  `operationKey` varchar(255) NOT NULL,
  `committedVersion` int NOT NULL,
  `result` json NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `prompt_operation_receipts_id` PRIMARY KEY (`id`),
  CONSTRAINT `prompt_operation_receipts_owner_operation_unique` UNIQUE (`storyId`,`userId`,`operationKey`),
  CONSTRAINT `prompt_operation_receipts_story_fk` FOREIGN KEY (`storyId`) REFERENCES `stories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `prompt_operation_receipts_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

ALTER TABLE `generated_images`
  ADD COLUMN `promptCompilationId` int NULL,
  ADD CONSTRAINT `generated_images_prompt_compilation_fk`
    FOREIGN KEY (`promptCompilationId`) REFERENCES `prompt_compilations` (`id`) ON DELETE SET NULL;

ALTER TABLE `video_takes`
  ADD COLUMN `promptCompilationId` int NULL,
  ADD CONSTRAINT `video_takes_prompt_compilation_fk`
    FOREIGN KEY (`promptCompilationId`) REFERENCES `prompt_compilations` (`id`) ON DELETE SET NULL;
