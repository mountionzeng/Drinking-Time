export function accountLabel(
  user: { email?: string | null; loginMethod?: string | null } | null
) {
  if (!user) return "未登录";
  if (user.loginMethod === "wechat")
    return user.email ? `微信账号 · ${user.email}` : "微信账号";
  return (
    user.email ||
    (user.loginMethod === "guest"
      ? "访客身份 · 未绑定邮箱"
      : "已登录 · 未绑定邮箱")
  );
}
