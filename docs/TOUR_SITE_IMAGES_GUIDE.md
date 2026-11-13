# Tour Site Image Submission Guide

## Overview
This document describes how to submit tour sites with up to 4 images in the Diaspora Sync application.

## Changes Summary

### Backend Changes
| Component | Change |
|-----------|--------|
| **Prisma Schema** | Added `imageUrl2`, `imageUrl3`, `imageUrl4` fields to `PendingSite` model |
| **Validator** (`src/validator/pending-site-validator.ts`) | `imageUrl` now accepts: single string **or** array of up to 4 URL strings |
| **Service** (`src/modules/pending-sites/pending-site-service.ts`) | Normalizes image URLs: first image → `imageUrl`, remaining → `imageUrl2`/`imageUrl3`/`imageUrl4` |

### Frontend Impact
- **Backward compatible**: Existing single-image submissions continue to work
- **New capability**: Submit up to 4 images in a single submission
- **Image storage**: URLs stored in `pending_sites` table; displayed on tour site detail page

---

## API Endpoints

### Submit New Tour Site
**Endpoint:** `POST /pending-sites`  
**Auth:** Bearer token required  
**Content-Type:** `application/json`

#### Request Body format

**Option 1: Single Image (backward compatible)**
```json
{
  "name": "Wli Waterfalls",
  "region": "Volta",
  "latitude": 7.0667,
  "longitude": 0.6333,
  "description": "The highest waterfall in West Africa...",
  "category": "Nature",
  "imageUrl": "https://upload.wikimedia.org/.../Wli_Waterfalls.jpg",
  "imageCredit": "Wikimedia Commons"
}
```

**Option 2: Multiple Images (new)**
```json
{
  "name": "Wli Waterfalls",
  "region": "Volta",
  "latitude": 7.0667,
  "longitude": 0.6333,
  "description": "The highest waterfall in West Africa...",
  "category": "Nature",
  "imageUrl": [
    "https://ex1.jpg",
    "https://ex2.jpg", 
    "https://ex3.jpg",
    "https://ex4.jpg"
  ],
  "imageCredit": "Wikimedia Commons"
}
```

#### Validation Rules
| Rule | Description |
|------|-------------|
| **Max images** | Array must not exceed 4 elements |
| **URL format** | Each element must be a valid URL |
| **Single format** | `imageUrl` as string still works (backward compatible) |
| **Optional** | `imageUrl` and `imageCredit` are optional fields |

#### Response
- Returns `201` with pending site details
- Site enters `pending` status for admin review
- Admins approve/reject via `/pending-sites/admin/{siteId}/approve` or `/reject`

---

## Image Storage Format

After submission, images are stored in the `pending_sites` table:

| Field | Holds |
|-------|-------|
| `imageUrl` | First image URL (or single image) |
| `imageUrl2` | Second image URL (if provided) |
| `imageUrl3` | Third image URL (if provided) |
| `imageUrl4` | Fourth image URL (if provided) |
| `imageCredit` | Attribution for first image |

**Example:** Submitting 3 images stores:
- `imageUrl`: first URL
- `imageUrl2`: second URL  
- `imageUrl3`: third URL
- `imageUrl4`: `null`

---

## Frontend Implementation Guidelines

### 1. Image Selection
Users can select/upload up to 4 images before submitting the tour site.

### 2. URL Preparation
- **If using Cloudinary**: Upload via `POST /upload` first, get the `url` response
- **If using Wikimedia**: Use direct image URLs from Wikimedia Commons
- **Format**: Must be valid HTTP/HTTPS URLs

### 3. Submit Payload
Construct the request body with either:
- Single `imageUrl` string, OR
- `imageUrl` array with 1-4 URLs

```javascript
// Example: Building the payload
const formData = {
  name: siteName,
  region: regionValue,
  latitude: lat,
  longitude: lng,
  description: descriptionText,
  category: categoryValue,
  
  // Images: either single or array
  imageUrl: selectedImages.length === 1 
    ? singleImageUrl 
    : selectedImages,  // array of 1-4 URLs
  
  imageCredit: creditText
};
```

### 4. Handling Response
- Site submitted with `pending` status
- Show success message: "Site submitted for admin review"
- Optionally list user's submissions via `GET /pending-sites/mine`

### 5. Display on Tour Site Detail Page
When the site is approved and moves to the production catalogue:
- Frontend reads `imageUrl`, `imageUrl2`, `imageUrl3`, `imageUrl4`
- Displays up to 4 images in gallery
- Falls back gracefully if fewer than 4 images provided

```javascript
// Example: Displaying images on detail page
const images = [site.imageUrl, site.imageUrl2, site.imageUrl3, site.imageUrl4]
  .filter(url => url !== null && url !== undefined);

return images.map((url, index) => (
  <img key={index} src={url} alt={`Tour site image ${index + 1}`} />
));
```

---

## Backward Compatibility

**Existing single-image submissions work unchanged:**
- Old format: `"imageUrl": "https://example.com/photo.jpg"`
- Frontend no changes needed for single-image workflows
- All existing pending sites continue to display correctly

**Migration path for existing data:**
- Old sites with single `imageUrl` → displayed as before
- New sites with array `imageUrl` → display up to 4 images
- No database migration needed; new fields default to `null`

---

## Testing

### Test Cases
1. **Submit with single image URL** → should work (backward compatible)
2. **Submit with array of 2-4 URLs** → should work (new feature)
3. **Submit with array of 5+ URLs** → should fail validation
4. **Submit without imageUrl** → should work (optional field)
5. **Admin approves site** → site appears in tour catalogue with images

### Validation Errors
- `"Maximum 4 images allowed"` → when array exceeds 4 elements
- `"Each imageUrl must be a valid URL"` → when any URL is invalid
- `"Site name must be at least 3 characters"` → standard validation

---

## Quick Integration Checklist

- [ ] Update form to allow selecting 1-4 images
- [ ] Collect image URLs (from upload or direct)
- [ ] Construct request body with single or array `imageUrl`
- [ ] Handle validation errors gracefully
- [ ] Show success/failure messages
- [ ] Display images on tour site detail page using `imageUrl`/`imageUrl2`/`imageUrl3`/`imageUrl4`
- [ ] Test all submission scenarios (1, 2, 3, 4 images)
- [ ] Verify backward compatibility with existing single-image submissions

---

## Need Help?

If you encounter any issues implementing these changes, please consult:
- Backend team for API details
- Existing test cases in `/tests/` directory
- Prisma schema changes in `prisma/schema.prisma`