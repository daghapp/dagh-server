# Profile Share Image Fix Documentation

## Issue
When sharing a user profile via `https://dagh-server-fo64.onrender.com/share/profile/{userId}`, the user's profile image was not displaying. Instead, a placeholder SVG or broken image was shown.

## Root Cause
The `API_URL` environment variable was incorrectly set to `http://localhost:5000` in the `.env` file, but the application is deployed on Render at `https://dagh-server-fo64.onrender.com`.

The `API_URL` is used by the share controller (`src/modules/share/share.controller.ts`) to:
1. Build image proxy URLs for profile pictures
2. Construct `og:image` and `twitter:image` meta tags
3. Generate share preview links

When `API_URL` pointed to localhost, the image proxy couldn't properly fetch and serve profile images from Cloudinary or other allowed hosts.

## Fix Applied

### 1. Environment Variable Update
**File:** `.env`

**Before:**
```
API_URL="http://localhost:5000"
```

**After:**
```
API_URL=https://dagh-server-fo64.onrender.com
```

### 2. How It Works
The share controller's `fetchMeta` function (line 42-66 in `share.controller.ts`):
1. Retrieves the user from the database using `prisma.user.findUnique`
2. Selects `profileImageUrl` from the user record
3. Returns it in the `meta.image` field
4. The `renderHtml` function embeds it as:
   - `<meta property="og:image" content="...">`
   - `<meta name="twitter:image" content="...">`
   - `<img src="...">` in the HTML preview

With the corrected `API_URL`, the image proxy can now:
- Fetch images from allowed hosts (Cloudinary `res.cloudinary.com`, Wikimedia `upload.wikimedia.org`, etc.)
- Cache images for performance
- Serve optimized resized versions
- Fall back gracefully if fetch fails

### 3. Verified Working
After the fix, sharing a profile now correctly displays:
- User's profile image in the preview card
- Proper `og:image` and `twitter:image` meta tags
- The image URL in the share metadata

**Example Share Link:**
```
https://dagh-server-fo64.onrender.com/share/profile/58d61c0a-e53a-4f4b-92c6-ede96ab604a2
```

### 2. No Code Changes Required
This was purely an **environment configuration fix**. No TypeScript or runtime code modifications were needed—the share controller logic already correctly uses `user.profileImageUrl`; it just needed the correct `API_URL` to build proper proxy URLs.

### 3. Related Settings
Ensure these are also correctly set in your `.env`:
```
RENDER_EXTERNAL_URL=https://dagh-server-fo64.onrender.com
API_URL=https://dagh-server-fo64.onrender.com
```

### 4. Cache Clearing
After deploying the `.env` fix, you may want to:
- Clear the image proxy cache (files in `/tmp/dagh-image-proxy/` or as configured)
- This ensures fresh profile images are served instead of stale cached versions

---

## Summary of All Recent Changes

| Feature | File(s) Changed | Type of Change |
|---------|----------------|----------------|
| **Tour site images (up to 4)** | `prisma/schema.prisma`, `src/validator/pending-site-validator.ts`, `src/modules/pending-sites/pending-site-service.ts` | Schema + validator + service logic |
| **Profile share images** | `.env` (environment config) | Environment variable fix only |
| **Tour site catalogue (4 images)** | `src/seed-data/tour-catalogue.ts`, `src/seed-data/ghana-tour-site-images.ts` | Type definitions + mapping logic |

Both fixes are now deployed and working!