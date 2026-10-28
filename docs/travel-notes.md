# DAGH Backend — Structured Travel Notes

## Overview

The app now returns **structured travel notes** with descriptions and practical tips for each transport mode. These notes help users make informed decisions when viewing travel options in the UI.

The feature is defined in `src/helpers/transit-profile.ts` and integrated throughout the itinerary, accommodation, and provider services.

---

## New Interface: `TravelNote`

```typescript
export interface TravelNote {
  title: string;
  category: "local_transit" | "ride_hailing" | "intercity_bus" | "car_rental" | "domestic_air";
  description: string;
  tips: string[];
}
```

- **title**: Human-readable title for the note
- **category**: Transport category that classifies the note
- **description**: Description of the transport option
- **tips**: Array of practical tips for using the transport mode

---

## Transport Definitions (`TRAVEL_NOTE_DEFINITIONS`)

The following 15+ transport modes have dedicated travel notes:

| Title | Category | Description |
|-------|----------|-------------|
| **Trotro** | `local_transit` | Popular urban shared minibuses serving high-frequency routes across the city. |
| **Trotro from main station** | `local_transit` | Station-based minibus shuttle connecting central transit hubs to peri-urban tourist and cultural sites. |
| **Trotro from main station (boarding route + drop-off junctions)** | `local_transit` | Ghana's iconic and ubiquitous shared minibus transport. Departs from designated lorry stations along set corridors. |
| **Private Hire** | `local_transit` | Direct private taxi or chartered vehicle hired from local stations or hotel ranks without intermediate stops. |
| **Uber** | `ride_hailing` | On-demand app-based ride-hailing with upfront pricing and GPS vehicle tracking across urban corridors. |
| **Yango** | `ride_hailing` | Widely available ride-hailing service in Greater Accra and Kumasi with competitive economy fares. |
| **STC (State Transport Company)** | `intercity_bus` | Ghana's state-owned intercity coach service with scheduled departures, air conditioning, and luggage compartments. |
| **VIP Bus** | `intercity_bus` | Frequent executive intercity bus service operating major inter-regional arteries (e.g., Accra–Kumasi, Kumasi–Tamale). |
| **Car Rental** | `car_rental` | Private vehicle hire providing full autonomy for your itinerary across the region. |
| **Local Car Rental with Driver** | `car_rental` | Dedicated local driver service stationed in the region, offering direct door-to-door convenience. |
| **Car Rental with Driver** | `car_rental` | Private chauffeured vehicle for flexible and comfortable travel between sites, ideal for custom day trips and rural routes. |
| **Domestic Air** | `domestic_air` | Scheduled commercial flights connecting Accra (Kotoka), Kumasi, Tamale, Takoradi, and Sunyani in 45–60 minutes. |

---

## Key Functions

### `getStructuredTravelNotes(profile: TransitProfileValue): TravelNote[]`

Returns structured travel notes for a given transit profile. It maps transport hints to their corresponding definitions, falling back to a generic note when no definition exists.

### `dedupeNotes(notes: TravelNote[]): TravelNote[]`

Removes duplicate notes by title, keeping only the first occurrence of each unique title. Used when combining notes from multiple sites.

---

## Integration Points

### Itinerary Service (`src/modules/itinerary/itinerary.service.ts`)

- `getStructuredTravelNotes()` is called for each site's transit profile
- Notes are deduplicated and included in the itinerary response under `structuredTravelNotes`
- Accommodation recommendations now include: `imageUrl`, `images`, `description`, `address`, `basePricePerNight`, `avgRating`, `reviewCount`, `googleMapsUrl`

### External Places Service (`src/services/places-external.service.ts`)

- **`fetchPlaceDetails(placeId: string)`**: Fetches detailed Google Place information including photos, editorial description, rating, address, and Google Maps URL
- **`findPlaceByNameAndLocation(name, latitude, longitude)`**: Searches for a place by name and coordinates to enrich internal providers
- Nearby lodging results now include: `imageUrl`, `images`, `description`, `address`, `avgRating`, `reviewCount`, `googleMapsUrl`

### Provider Routes (`src/routes/provider.routes.ts`)

- **New endpoint: `GET /providers/{id}`** — Returns complete provider details including images, description, address, ratings, and Google Maps link
- Supports both internal provider UUIDs and external Google Places IDs (prefixed with `ext:`)

### Itinerary Validator (`src/validator/itinerary-validator.ts`)

- `TravelNote` type is exported for use in validation schemas
- `structuredTravelNotes` added to `SiteMobility`, `ItineraryDayResponse`, and `ItineraryResponse` interfaces
- Accommodation options now include rich media and rating fields

---

## User-Facing Benefits

1. **Transport decision-making**: Users see descriptive notes with tips for each transport mode (Trotro, Uber, Yango, STC, VIP Bus, Domestic Air, car rentals)

2. **Accommodation details**: Each accommodation listing shows images, descriptions, address, pricing, ratings, and Google Maps link

3. **Provider details**: New `GET /providers/{id}` endpoint returns full provider information for both internal providers and external Google Places IDs

4. **Consistent experience**: Notes and rich data are propagated consistently across itineraries, accommodation searches, and provider listings

---

## API Changes Summary

### New Endpoint

```
GET /providers/{id}
```
- **Auth**: bearerAuth
- **Summary**: Get provider details by ID or external Google Places ID
- **Responses**: 200 (success), 400 (missing ID), 404 (not found), 500 (server error)

### Modified Interfaces

- `TravelNote` — new interface in `transit-profile.ts`
- `SiteMobility` — added `structuredTravelNotes?: TravelNote[]`
- `ItineraryDayResponse` — added `structuredTravelNotes?: TravelNote[]`
- `ItineraryResponse` — added `structuredTravelNotes?: TravelNote[]`
- `AccommodationRecommendation` — added image, description, address, pricing, rating fields
- `VerifiedAccommodation` — added image, description, address, pricing, rating fields
- `ExternalLodgingResult` — added photo, rating, reviewCount, googleMapsUrl fields

### Data Enrichment

Accommodation and provider data now includes:
- `imageUrl` / `images` — primary and additional photos
- `description` — descriptive text (bio or editorial overview)
- `address` — physical address
- `basePricePerNight` — nightly rate
- `avgRating` — average rating score
- `reviewCount` — number of reviews
- `googleMapsUrl` — Google Maps search link