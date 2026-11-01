import React from 'react';
export type BookMediaMode = 'image' | 'region' | 'video';
const button = 'rounded-md border px-2 py-1 text-xs disabled:opacity-40';
export function BookMediaModes({mode, disabled, onChange}: {mode: BookMediaMode; disabled: boolean; onChange: (mode: BookMediaMode) => void}) {
  const option = (value: BookMediaMode, label: string, active: boolean) => <button key={value}
    className={`${button} ${active ? 'bg-primary/10 border-primary/40' : ''}`}
    disabled={disabled} aria-pressed={active} onClick={() => onChange(value)}>{label}</button>;
  return <>
    <div className="flex gap-1" role="group" aria-label="图片操作">
      {option('image', '改图片', mode !== 'video')}
      {option('video', '变成小视频', mode === 'video')}
    </div>
    {mode !== 'video' && <div className="flex items-center gap-1 text-xs" role="group" aria-label="修改范围">
      <span className="mr-1 text-muted-foreground">修改范围</span>
      {option('image', '整张修改', mode === 'image')}
      {option('region', '只改局部', mode === 'region')}
    </div>}
  </>;
}
