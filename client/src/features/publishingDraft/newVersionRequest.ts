/** The book toolbar opens the generation controller mounted alongside chat. */
export const NEW_VERSION_EVENT = "dt:open-new-version";
export type NewVersionRequest = {
  storyId: number;
  accountId?: number | null;
  presentation?: "film" | "text";
  instruction?: string;
  videoTextMethod?: "rewrite"|"local-transcript";
};
export function requestNewVersion(detail: NewVersionRequest) {
  window.dispatchEvent(
    new CustomEvent<NewVersionRequest>(NEW_VERSION_EVENT, { detail })
  );
}
