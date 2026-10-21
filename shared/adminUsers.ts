export const adminUserCategories = [
  "unclassified",
  "own",
  "test",
  "external",
] as const;
export type AdminUserCategory = (typeof adminUserCategories)[number];
export const adminUserCategoryLabels: Record<AdminUserCategory, string> = {
  unclassified: "待确认",
  own: "自己的账号",
  test: "测试账号",
  external: "外部用户",
};

export type AdminUserRow = {
  userId: number;
  email: string | null;
  name: string | null;
  role: "admin" | "user";
  createdAt: Date;
  lastSignedIn: Date;
  registration: "verified" | "guest" | "legacy";
  providers: string[];
  category: AdminUserCategory;
  lastSeenAt: Date | null;
  visitCount: number;
  durationSeconds: number;
  giftMinor: number;
  lifetimeSpentMinor: number;
  reservedMinor: number;
  availableMinor: number;
};

/** Counts accounts, never presumed people; a linked second identity is not a new user. */
export function summarizeAdminUsers(rows: AdminUserRow[], now: Date) {
  const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const registered = rows.filter(row => row.registration === "verified");
  const inWeek = (date: Date | null) =>
    date !== null &&
    date.getTime() >= weekStart &&
    date.getTime() <= now.getTime();
  const external = registered.filter(row => row.category === "external");
  return {
    registered: registered.length,
    external: external.length,
    own: registered.filter(row => row.category === "own").length,
    test: registered.filter(row => row.category === "test").length,
    unclassified: registered.filter(row => row.category === "unclassified")
      .length,
    new7d: registered.filter(row => inWeek(row.createdAt)).length,
    active7d: registered.filter(row => inWeek(row.lastSeenAt)).length,
    externalActive7d: external.filter(row => inWeek(row.lastSeenAt)).length,
    lifetimeSpentMinor: registered.reduce(
      (sum, row) => sum + row.lifetimeSpentMinor,
      0
    ),
    externalSpentMinor: external.reduce(
      (sum, row) => sum + row.lifetimeSpentMinor,
      0
    ),
    legacy: rows.filter(row => row.registration === "legacy").length,
    guests: rows.filter(row => row.registration === "guest").length,
  };
}
