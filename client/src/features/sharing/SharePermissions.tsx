import { type SharePermissions as Permissions } from "@shared/sharePermissions";

export function SharePermissions({
  value,
  onChange,
  disabled,
}: {
  value: Permissions;
  onChange: (value: Permissions) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="space-y-3 text-sm disabled:opacity-60"
    >
      <legend className="mb-2 font-medium">收到链接的人可以</legend>
      <p className="text-xs text-muted-foreground">
        默认仅阅读。只分享作品，不包含你的记忆和聊天记录。权限适用于所有持有链接的人。
      </p>
      <label className="flex min-h-10 items-center gap-3">
        <input
          type="checkbox"
          checked={value.rewrite}
          onChange={e => onChange({ ...value, rewrite: e.target.checked })}
        />
        <span>
          协助改写
          <span className="ml-2 text-xs text-muted-foreground">
            你确认后采用
          </span>
        </span>
      </label>
      <label className="flex min-h-10 items-center gap-3">
        <input
          type="checkbox"
          checked={value.fork}
          onChange={e => onChange({ ...value, fork: e.target.checked })}
        />
        <span>以作品为基础，另建自己的故事</span>
      </label>
    </fieldset>
  );
}
