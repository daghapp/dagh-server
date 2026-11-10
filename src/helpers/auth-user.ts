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
 *   3. Community access is required, not optional. It is the third rule for the
 *      same reason the module exists: a client that signs in and finds no access
 *      information has to either guess (by asking a second endpoint, and getting
 *      a second answer) or render a locked feed for someone who is subscribed. An
 *      omitted field fails silently; a required argument fails to compile.
 */

import type { Ethnicity } from "../../generated/prisma/enums.js";
import type { ChannelAccessSnapshot } from "../services/channel-access.service.js";

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
  /**
   * The YouTube subscription decision as of this session.
   *
   * The same object the community endpoints return, so a client never holds two
   * copies of this state that can disagree. On login it is a forced check —
   * yesterday's evidence is not evidence about today — so a user who cancelled
   * last night sees a locked feed on this response. On refresh it is a
   * lease-respecting read, because refresh runs every few minutes and must stay
   * cheap.
   */
  communityAccess: ChannelAccessSnapshot;
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

/**
 * The session payload.
 *
 * `communityAccess` is a required parameter rather than an optional one. Making
 * it optional would mean a caller can produce a session response with no access
 * information at all, which is the original bug in a different costume: the
 * client would have to ask a second endpoint and could be told something
 * different.
 */
export function toAuthUser(user: AuthUserSource, communityAccess: ChannelAccessSnapshot): AuthUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    accountType: user.accountType,
    ethnicity: user.ethnicity ?? null,
    communityAccess,
  };
}
