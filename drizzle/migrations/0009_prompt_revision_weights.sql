ALTER TABLE `prompt_revisions`
  ADD COLUMN `weight` float NOT NULL DEFAULT 0.3 AFTER `content`;

UPDATE `prompt_revisions` AS `pr`
INNER JOIN `prompt_nodes` AS `pn` ON `pn`.`id` = `pr`.`nodeId`
SET `pr`.`weight` = CASE `pn`.`dimension`
  WHEN 'title' THEN 0.18
  WHEN 'theme' THEN 0.26
  WHEN 'story_arc' THEN 0.26
  WHEN 'visual_style' THEN 0.36
  WHEN 'color_palette' THEN 0.28
  WHEN 'composition' THEN 0.24
  WHEN 'lighting' THEN 0.24
  WHEN 'subject' THEN 0.42
  WHEN 'action' THEN 0.38
  WHEN 'dialogue' THEN 0.34
  WHEN 'location' THEN 0.32
  WHEN 'time_light' THEN 0.24
  WHEN 'mood' THEN 0.30
  WHEN 'style_reference' THEN 0.26
  WHEN 'beat' THEN 0.28
  WHEN 'intent' THEN 0.50
  WHEN 'rationale' THEN 0.46
  WHEN 'image_prompt' THEN 0.50
  WHEN 'negative_prompt' THEN 0.22
  WHEN 'camera_motion' THEN 0.36
  WHEN 'video_prompt' THEN 0.50
  WHEN 'sound' THEN 0.32
  WHEN 'narrativeClaim' THEN 0.54
  WHEN 'roleConcern' THEN 0.50
  WHEN 'visualTranslation' THEN 0.48
  WHEN 'causalExplanation' THEN 0.46
  WHEN 'narrativeEvidence' THEN 0.44
  WHEN 'externalValue' THEN 0.42
  WHEN 'storyContext' THEN 0.36
  WHEN 'avoidMisread' THEN 0.30
  WHEN 'recommendationStatus' THEN 0.26
  WHEN 'intentSummary' THEN 0.22
  ELSE 0.30
END;
