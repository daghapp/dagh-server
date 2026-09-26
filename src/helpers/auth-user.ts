/**
 * The single definition of "who is signed in", as returned by every endpoint
 * that hands a client a usable session.
 *
 * This exists because `POST /auth/login` and `POST /auth/refresh-token` drifted
 * apart. Login grew an `ethnicity` field; refresh kept returning only an access
 * token. Both are reached on the same user journey — login on a cold start,
 * refresh whenever the access token expires mid-session — so a client that
 * rehydrates its cached user from the refresh response silently lost every
 * profile field the login response had given it, and the app could only conclude
 * the value had never been set. The user got asked to choose their ethnicity
 * again on every session resume.
 *
 * Two rules follow, and they are the reason this is a module rather than an
 * inline object in each controller:
 *
 *   1. Both endpoints build their user payload from `toAuthUser`, so a field
 *      added here reaches both at once and cannot be forgotten on one path.
 *   2. `ethnicity` stays in the response body and NOT in the access token.
 *      Tokens are decoded client-side, sit in AsyncStorage/localStorage, and get
 *      swept into crash-reporter breadcrumbs; they should carry identity (who
 *      you are), not a special-category profile attribute. A token copy would
 *      also go stale, since the user can change their ethnicity without the
 *      token changing.
 */

import type { Ethnicity } from "../../generated/prisma/enums.js";

/** The fields a client needs to render a signed-in session. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  accountType: string | null;
  /**
   * `null` when never chosen — which is a real, valid state (the column is
   * nullable and nothing in the auth flow requires it). Clients must treat
   * `null` as "not answered yet", never as "invalid".
   */
  ethnicity: Ethnicity | null;
}

/**
 * Structural input, so this works with a full `User` row, a `select`-ed
 * subset, or a hand-built fixture in tests.
 */
export interface AuthUserSource {
  id: string;
  email: string;
  fullName: string | null;
  accountType: string | null;
  ethnicity: Ethnicity | null;
}

export function toAuthUser(user: AuthUserSource): AuthUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    accountType: user.accountType,
    ethnicity: user.ethnicity,
  };
}
