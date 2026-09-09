export type Stop = 'peek' | 'half' | 'full';
export function sheetTop(height: number, stop: Stop) {
  const available = Math.max(200, height - 64);
  return Math.max(96, available - (stop === 'peek' ? 128 : available * (stop === 'half' ? .5 : .88)));
}

// Same composition as MobileWorkspaceFrame: paper, floating chat, table bar.
export function paintMobile(ctx: any, width: number, height: number, stop: Stop,
  body: string, chat: string, title: string, status: string, draft: string,
  offset: number, character: any) {
  const top = sheetTop(height, stop);
  ctx.fillStyle = '#faf7f1'; ctx.fillRect(0, 0, width, height);
  const label = (s: string, x: number, y: number, size = 15, color = '#4b4236') => {
    ctx.fillStyle = color; ctx.font = `${size}px sans-serif`; ctx.fillText(s, x, y);
  };
  label('演示模式 · 未连接真实账号', 16, 86, 11, '#977d4b');
  if (stop === 'peek') { label('碎碎念', 18, 120, 22); label(title.slice(0, 14), 98, 120, 14); }
  const wrapped = (value: string) => {
    ctx.font = '16px sans-serif'; const lines: string[] = []; let line = '';
    for (const c of value) {
      if (c === '\n' || ctx.measureText(line + c).width > width - 48) { lines.push(line); line = ''; }
      if (c !== '\n') line += c;
    }
    lines.push(line); return lines;
  };
  const paragraph = wrapped(body || '从一句话开始，慢慢写下你的故事。');
  paragraph.slice(stop === 'peek' ? offset : 0).forEach((line, i) => {
    const y = 165 + i * 29; if (y < top - 50) label(line, 24, y, 16);
  });
  if (top > 210) { label(status, 20, top - 23, 11, '#918779'); label('编辑正文', width - 155, top - 23, 12); label('保存', width - 70, top - 23, 12); }
  ctx.fillStyle = '#eee5d8'; ctx.fillRect(0, top - 2, width, 2);
  ctx.fillStyle = '#faf7f1'; ctx.fillRect(0, top, width, height - top);
  ctx.fillStyle = '#d9cdbc'; ctx.fillRect(width / 2 - 18, top + 8, 36, 3);
  if (character) ctx.drawImage(character, 18, top + 16, 34, 34);
  label('聊聊', 60, top + 38, 17, '#927342');
  label(stop === 'peek' ? '拉开看全部 ⌃' : '收起 ⌄', width - 102, top + 38, 12);
  const chatLines = wrapped(chat || '说说今天的一件小事吧。');
  const count = Math.max(0, Math.floor((height - 150 - top - 66) / 25));
  if (stop !== 'peek') chatLines.slice(offset, offset + count).forEach((line, i) => label(line, 24, top + 70 + i * 25));
  ctx.fillStyle = '#eee6d9'; ctx.fillRect(16, height - 135, width - 86, 48);
  label(draft ? draft.slice(0, 16) : '说说这件小事…', 26, height - 105, 15, '#827766');
  label('发送', width - 58, height - 105, 15, '#927342');
  ctx.strokeStyle = '#c3b299'; ctx.lineWidth = 1.6; ctx.beginPath();
  ctx.moveTo(14, height - 35); ctx.quadraticCurveTo(width / 2, height - 40, width - 14, height - 33); ctx.stroke();
  label('故事', width / 6 - 14, height - 44, 13);
  label('聊点其他的', width / 2 - 32, height - 44, 13);
  label('我', width * 5 / 6 - 6, height - 44, 13);
  return { top, maxOffset: Math.max(0, stop === 'peek' ? paragraph.length - Math.max(1, Math.floor((top - 210) / 29)) : chatLines.length - Math.max(1, count)) };
}
