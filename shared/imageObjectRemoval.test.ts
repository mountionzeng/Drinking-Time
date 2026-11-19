import { expect, it } from 'vitest';
import { isImageObjectRemoval } from './imageObjectRemoval';

it.each(['我的意思是只留一个飞机就好了', '不是这个范围，你只需要去掉一个飞机和他的尾巴就好了',
  '把小的飞机给去掉', '删除右边的建筑，其他不变', 'remove the smaller plane and its tail', 'keep only one plane'])('recognizes image object removal: %s', text => {
  expect(isImageObjectRemoval(text)).toBe(true);
});
it.each(['选择一个飞机的范围', '飞机范围缩小一点', '不要去掉飞机', '别把小飞机删掉', '已经删除了小飞机',
  '为什么飞机被删掉了', '能否只留一个飞机', '删除飞机镜头', '从仓库移除飞机素材', '飞机大一点', '云少一点', '保留飞机不动',
  '不删飞机', '不用只留一个飞机', 'do not remove the plane', 'why remove the plane?'])('does not confuse selection, refusal, questions or asset deletion with removal: %s', text => {
  expect(isImageObjectRemoval(text)).toBe(false);
});
