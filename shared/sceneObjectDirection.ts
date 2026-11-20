/** Drawing instructions apply to depicted objects, never to camera movement. */
export const SCENE_OBJECT_DIRECTION =
  "Keep each object's own facing. For a directed action, orient its leading part toward its named target unless the action specifies otherwise. Paint requested additions in the local palette, material rendering and brush strokes; match edges, light, overlap and contact shadows at their placement.";

/** Apply to existing and newly depicted objects, including UI inside a physical screen. */
export const STILL_EDGE_INTEGRATION =
  "Match local texture scale, edge sharpness and bounced light across joins. Remove cutout halos and pasted seams while retaining intentional contours and fine detail.";
