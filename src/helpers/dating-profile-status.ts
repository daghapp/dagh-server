export type DatingProfileStatus = "INCOMPLETE" | "COMPLETE";

export interface DatingProfileCompletenessInput {
  photos?: string[] | null;
  about?: string | null;
  headline?: string | null;
  interests?: string[] | null;
}

/**
 * A dating profile counts as COMPLETE when it has at least one photo and some
 * descriptive content (bio, headline, or interests). Used to let returning
 * users bypass the initial profile creation/skip screen.
 */
export function isDatingProfileComplete(
  profile: DatingProfileCompletenessInput | null | undefined,
): boolean {
  if (!profile) return false;
  return (
    (profile.photos?.length ?? 0) > 0 &&
    (Boolean(profile.about) || Boolean(profile.headline) || (profile.interests?.length ?? 0) > 0)
  );
}

export function resolveDatingProfileStatus(
  profile: DatingProfileCompletenessInput | null | undefined,
): DatingProfileStatus {
  return isDatingProfileComplete(profile) ? "COMPLETE" : "INCOMPLETE";
}
