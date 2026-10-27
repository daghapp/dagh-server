import { Request, Response } from "express";
import { prisma } from "../../config/index.js";
import { ok, fail } from "../../helpers/response.js";
import {
  fetchPlaceDetails,
  findPlaceByNameAndLocation,
  isExternalPlacesConfigured,
} from "../../services/places-external.service.js";

/**
 * Controller providing full details for a provider or external lodging location.
 * Triggered when a user clicks on an accommodation card or transport option in the UI.
 *
 * Supports:
 *   1. Internal verified providers by provider_id UUID (augmented with Google Places if sparse).
 *   2. External lodging places discovered via Google Places (ext:place_id prefix).
 */
export class ProviderDetailController {
  async getProviderById(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      if (!id) {
        return fail(res, 400, "Provider id is required");
      }

      // External place lookup via Google Places API Place Details
      if (id.startsWith("ext:")) {
        const placeDetails = await fetchPlaceDetails(id);
        if (!placeDetails) {
          return fail(res, 404, "External place not found");
        }

        return ok(
          res,
          {
            id,
            displayName: placeDetails.name,
            verificationStatus: false,
            source: "external",
            imageUrl: placeDetails.imageUrl,
            mediaAssets: placeDetails.images,
            locationAddress: placeDetails.address,
            avgRating: placeDetails.avgRating,
            reviewCount: placeDetails.reviewCount,
            bioDescription: placeDetails.description,
            googleMapsUrl: placeDetails.googleMapsUrl,
            website: placeDetails.website,
            phoneNumber: placeDetails.phoneNumber,
            type: "hotel",
            hotel: null,
            carRental: null,
            tourGuide: null,
          },
          "Place details retrieved successfully from Google Places",
        );
      }

      // Internal verified provider lookup
      const provider = await prisma.provider.findUnique({
        where: { provider_id: id },
        include: {
          hotel: true,
          car_rental: true,
          tour_guide: true,
        },
      });

      if (!provider) {
        return fail(res, 404, "Provider not found");
      }

      let mediaAssets = provider.media_assets;
      let bioDescription = provider.bio_description;
      let googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(provider.display_name)}`;

      // If database assets/descriptions are sparse, enrich with Google Places if configured
      if (
        isExternalPlacesConfigured() &&
        (mediaAssets.length === 0 || !bioDescription || bioDescription.trim() === "")
      ) {
        const placeEnrichment = await findPlaceByNameAndLocation(
          provider.display_name,
          provider.location_lat,
          provider.location_lng,
        );

        if (placeEnrichment) {
          if (mediaAssets.length === 0 && placeEnrichment.images.length > 0) {
            mediaAssets = placeEnrichment.images;
          }
          if ((!bioDescription || bioDescription.trim() === "") && placeEnrichment.description) {
            bioDescription = placeEnrichment.description;
          }
          if (placeEnrichment.googleMapsUrl) {
            googleMapsUrl = placeEnrichment.googleMapsUrl;
          }
        }
      }

      const type = provider.hotel
        ? "hotel"
        : provider.car_rental
          ? "car_rental"
          : provider.tour_guide
            ? "tour_guide"
            : "other";

      const details = {
        id: provider.provider_id,
        displayName: provider.display_name,
        verificationStatus: provider.verification_status,
        source: "verified",
        imageUrl: mediaAssets[0] ?? null,
        mediaAssets,
        locationLat: provider.location_lat,
        locationLng: provider.location_lng,
        locationAddress: provider.location_address,
        avgRating: provider.avg_rating,
        reviewCount: provider.review_count,
        responseTimeSecs: provider.response_time_secs,
        bioDescription,
        googleMapsUrl,
        type,
        hotel: provider.hotel
          ? {
              apartmentType: provider.hotel.apartment_type,
              basePricePerNight: provider.hotel.base_price_per_night,
            }
          : null,
        carRental: provider.car_rental
          ? {
              vehicleMake: provider.car_rental.vehicle_make,
              vehicleModel: provider.car_rental.vehicle_model,
              vehicleYear: provider.car_rental.vehicle_year,
              transmission: provider.car_rental.transmission,
              fuelType: provider.car_rental.fuel_type,
              safetyFeatures: provider.car_rental.safety_features,
              rentalTermsUrl: provider.car_rental.rental_terms_url,
              dailyRate: provider.car_rental.daily_rate,
              driverRequired: provider.car_rental.driver_required,
              transportType: provider.car_rental.transport_type,
            }
          : null,
        tourGuide: provider.tour_guide
          ? {
              languageCapability: provider.tour_guide.language_capability,
              expertiseTags: provider.tour_guide.expertise_tags,
              chargePerDay: provider.tour_guide.charge_per_day,
              certificationDocs: provider.tour_guide.certification_docs,
            }
          : null,
      };

      return ok(res, details, "Provider details retrieved successfully");
    } catch (e) {
      console.error("getProviderById failed", e);
      return fail(res, 500, "Failed to get provider details");
    }
  }
}
