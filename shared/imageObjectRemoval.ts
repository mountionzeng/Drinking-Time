/** Image-content edits, never deletion of warehouse assets or timeline clips. */
export function isImageObjectRemoval(text: string): boolean {
  return text.split(/[，,。；;\n]/).some(clause => {
    if (/[?？]|为什么|为啥|如何|怎么|是否|能否|吗|\b(?:why|how|should|could)\b/i.test(clause)) return false;
    if (!/飞机|树木|树冠|云朵|云层|建筑|人物|\b(?:airplanes?|planes?|trees?|clouds?|buildings?|people)\b/i.test(clause)) return false;
    if (/镜头|片段|素材|文件|仓库|图层|\b(?:clip|asset|file|layer)\b/i.test(clause)) return false;
    if (/(?:不(?:要|用|需|想)?|无需|不必|别).{0,12}(?:去掉|删|移除|抹掉|擦掉|只留|只保留)|\b(?:don't|do not|never)\b.*\b(?:remove|erase|delete|keep)\b/i.test(clause)) return false;
    if (/(?:已经|刚才|之前).{0,12}(?:去掉|删|移除|抹掉|擦掉)|\b(?:removed|deleted|erased)\b/i.test(clause)) return false;
    return /去掉|删掉|删除|移除|抹掉|擦掉|只(?:保)?留.{0,4}[一1](?:个|架|棵|朵|栋)?|\b(?:remove|erase|delete)\b|\b(?:keep|leave)\s+(?:only\s+)?one\b/i.test(clause);
  });
}

/** Do not choose an instance from a category-wide segmentation. Ask in chat. */
export function hasRemovalTargetDescription(text: string): boolean {
  return /(?:左[边侧上下]|右[边侧上下]|上[边方半]|下[边方半]|中间|前面|后面|较大|较小|大的|小的|大飞机|小飞机|大树|小树|最大|最小|红色|白色|蓝色)|\b(?:left|right|top|bottom|middle|foreground|background|smaller|larger|small|large|red|white|blue)\b/i.test(text);
}
