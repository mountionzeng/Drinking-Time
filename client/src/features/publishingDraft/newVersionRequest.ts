/** The book toolbar and chat composer open the same generation controller. */
export const NEW_VERSION_EVENT = "dt:open-new-version";
export type NewVersionRequest = {
  storyId: number;
  accountId?: number | null;
  presentation?: "film" | "text";
  instruction?: string;
};
export function requestNewVersion(detail: NewVersionRequest) {
  window.dispatchEvent(
    new CustomEvent<NewVersionRequest>(NEW_VERSION_EVENT, { detail })
  );
}
