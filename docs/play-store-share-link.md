# Play Store Listing Link (Android Share Fallback)

The Android fallback URL used when sharing profiles/events/posts is the app's **direct Play Store listing**:

```
https://play.google.com/store/apps/details?id=com.simplymark.diasporansync
```

## How it works

1. A user shares a profile/event/post → server returns a share URL (`/share/{type}/{id}`).
2. Recipient opens the URL. The page renders Open Graph metadata for rich previews.
3. On a non-bot client, JavaScript attempts to open the app via the deep-link scheme (`diasporansync://share/{type}/{id}`).
4. If the app is not installed (deep link fails within ~1.5s), the page redirects to the Play Store URL.
5. On Android, the Play Store app (or browser) opens the search results for "Diasporan sync".
6. The recipient taps the app listing and installs it. After install, reopening the share link opens the app via the deep link.

For iOS, `APP_STORE_URL` is used instead; if unset, no fallback redirect happens.

## Configuration

Set in environment (see `src/modules/share/share.controller.ts`):

| Env var | Purpose | Default |
|---|---|---|
| `PLAY_STORE_URL` | Android fallback URL | `https://play.google.com/store/apps/details?id=com.simplymark.diasporansync` |
| `APP_STORE_URL` | iOS fallback URL | (empty) |
| `APP_DEEP_LINK_SCHEME` | App scheme for deep links | `diasporansync` |

## Improving the link (recommended)

The search link requires the recipient to find and tap the correct app. Once the app is published, replace `PLAY_STORE_URL` with a **direct listing URL**:

```
https://play.google.com/store/apps/details?id=<applicationId>
```

Use the Android `applicationId` from the mobile app's `android/app/build.gradle`. For native sharing, the `market://` scheme also works:

```
market://details?id=<applicationId>
```

## How Android users share with friends

- Tap **Share** on a profile/event/post in the app → copies the share URL.
- Send via WhatsApp/SMS/any messenger.
- Friend taps link → app opens if installed, otherwise Play Store search/listing opens for install.
- After install, tapping the link again opens the shared content directly in the app.
