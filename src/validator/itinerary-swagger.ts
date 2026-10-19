// Central place to keep OpenAPI/Swagger schema objects for itinerary routes.
// Uses plain JS objects so Swagger tooling in this project can render them.

export const itinerarySchemas = {
  ErrorResponse: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      message: { type: "string" },
      data: { nullable: true },
      errors: { type: "array", items: { type: "object" }, nullable: true },
    },
  },

  TourSite: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      region: { type: "string" },
      latitude: { type: "number" },
      longitude: { type: "number" },
      description: { type: "string" },
      imageUrl: { type: "string", nullable: true },
      category: {
        type: "string",
        enum: ["NATURE", "CULTURAL", "HISTORICAL", "BEACH", "WILDLIFE", "RELIGIOUS", "SCENIC"],
      },
      transitProfile: {
        type: "string",
        enum: ["URBAN_CENTER", "PERI_URBAN", "RURAL"],
        description: "Accessibility tier driving the mobility engine (§2).",
      },
    },
  },

  CreateTourRequest: {
    type: "object",
    required: ["tourSiteIds", "tourType", "durationDays"],
    properties: {
      tourSiteIds: {
        type: "array",
        items: { type: "string", format: "uuid" },
        minItems: 1,
        maxItems: 50,
      },
      tourType: { type: "string", enum: ["GROUP", "SINGLE"] },
      durationDays: { type: "integer", minimum: 1, maximum: 30 },
      startRegion: {
        type: "string",
        description: "Hub the loop is anchored to. Defaults to Central (Cape Coast).",
        default: "Central",
        example: "Central",
      },
      allowAccraOvernight: {
        type: "boolean",
        default: false,
        description:
          "Opt in to more than two Greater Accra nights. Otherwise Accra is confined to the arrival/departure gateway.",
      },
      relocationInterest: { type: "boolean", default: false },
    },
  },

  AccommodationOption: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      latitude: { type: "number" },
      longitude: { type: "number" },
      distanceKm: { type: "number" },
      propertyType: {
        type: "string",
        nullable: true,
        enum: ["HOTEL", "GUESTHOUSE", "AIRBNB", "APARTMENTS", "MOTEL"],
      },
      source: {
        type: "string",
        enum: ["verified", "external"],
        description: '"external" rows are geographic fallback discoveries.',
      },
      tag: {
        type: "string",
        example: "Suggested Alternative Accommodation",
        description: "Present only on fallback injections.",
      },
    },
  },

  PublicTransportOption: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["public_transport"] },
      id: { type: "string" },
      mode: { type: "string", enum: ["INTERCITY_BUS", "TROTRO", "DOMESTIC_AIR"] },
      operator: { type: "string", example: "STC" },
      originCity: { type: "string", example: "Accra" },
      originStation: { type: "string", nullable: true, example: "Kwame Nkrumah Circle (Accra)" },
      originLat: { type: "number", nullable: true },
      originLng: { type: "number", nullable: true },
      destinationCity: { type: "string", nullable: true },
      destinationRegion: { type: "string", nullable: true },
      notes: { type: "string", nullable: true },
      distanceKm: { type: "number", nullable: true },
      source: { type: "string", enum: ["primary", "fallback"] },
      tag: { type: "string", example: "Suggested Alternative Transport" },
    },
  },

  CarRentalOption: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      latitude: { type: "number" },
      longitude: { type: "number" },
      distanceKm: { type: "number" },
      transportType: { type: "string", nullable: true },
      locationAddress: { type: "string" },
      avgRating: { type: "number" },
      imageUrl: { type: "string", nullable: true },
      vehicleMake: { type: "string" },
      vehicleModel: { type: "string" },
      dailyRate: { type: "number" },
      driverRequired: { type: "boolean" },
      source: { type: "string", enum: ["verified"] },
      tag: { type: "string", example: "Suggested Alternative Transport" },
    },
  },

  SiteMobility: {
    type: "object",
    properties: {
      siteId: { type: "string", format: "uuid" },
      transitProfile: { type: "string", enum: ["URBAN_CENTER", "PERI_URBAN", "RURAL"] },
      rideHailing: {
        type: "array",
        items: { type: "string" },
        example: ["Uber", "Yango"],
        description: "Only populated for URBAN_CENTER corridors.",
      },
      localTransit: { type: "array", items: { type: "string" } },
      intercityBus: {
        type: "array",
        items: { $ref: "#/components/schemas/PublicTransportOption" },
        description: "STC / VIP coach options from the nearest boarding point.",
      },
      trotro: {
        type: "array",
        items: { $ref: "#/components/schemas/PublicTransportOption" },
      },
      air: { type: "array", items: { $ref: "#/components/schemas/PublicTransportOption" } },
      carRentals: { type: "array", items: { $ref: "#/components/schemas/CarRentalOption" } },
      hints: { type: "array", items: { type: "string" } },
    },
  },

  ItinerarySite: {
    type: "object",
    properties: {
      visitOrder: { type: "integer" },
      site: { $ref: "#/components/schemas/TourSite" },
      availableAccomodation: {
        allOf: [{ $ref: "#/components/schemas/LocalProvider" }],
        nullable: true,
        description: "Relocation-interest lookup (only when relocationInterest is enabled).",
      },
      accommodationOptions: {
        type: "array",
        items: { $ref: "#/components/schemas/AccommodationOption" },
        description:
          "Tiered accommodation options within 5 km of the site; external fallbacks carry the Suggested Alternative Accommodation tag.",
      },
      publicTransportOptions: {
        type: "array",
        items: { $ref: "#/components/schemas/PublicTransportOption" },
        description:
          "Tiered public-transport options (STC/VIP coaches, domestic air, trotro corridors) around the site; national fallbacks carry the Suggested Alternative Transport tag.",
      },
      mobility: {
        allOf: [{ $ref: "#/components/schemas/SiteMobility" }],
        nullable: true,
        description: "Full mobility profile for this location (null on transport opt-out).",
      },
    },
  },

  LocalProvider: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      latitude: { type: "number" },
      longitude: { type: "number" },
      distanceKm: { type: "number" },
    },
  },

  ItineraryDay: {
    type: "object",
    properties: {
      dayNumber: { type: "integer" },
      dayType: { type: "string", enum: ["PREPARATION", "TOURING", "DEPARTURE"] },
      title: {
        type: "string",
        nullable: true,
        example: "Day 3: Canopy Walk & Coastal Heritage (Central Region)",
      },
      region: { type: "string", nullable: true, example: "Central" },
      sites: { type: "array", items: { $ref: "#/components/schemas/ItinerarySite" } },
      localAccommodation: {
        allOf: [{ $ref: "#/components/schemas/LocalProvider" }],
        nullable: true,
      },
      localTransport: {
        allOf: [{ $ref: "#/components/schemas/LocalProvider" }],
        nullable: true,
      },
    },
  },

  Itinerary: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      tourRequestId: { type: "string", format: "uuid" },
      isFeasible: { type: "boolean" },
      feasibilityError: { type: "string", nullable: true },
      totalDays: { type: "integer" },
      routeRegions: {
        type: "array",
        items: { type: "string" },
        example: ["Central", "Ashanti", "Volta", "Greater Accra"],
      },
      accraNights: { type: "integer", example: 1 },
      warnings: { type: "array", items: { type: "string" } },
      dateCreated: { type: "string", format: "date-time" },
      days: { type: "array", items: { $ref: "#/components/schemas/ItineraryDay" } },
    },
  },

  CreateTourResponse: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      message: { type: "string" },
      data: {
        type: "object",
        properties: {
          tourRequestId: { type: "string", format: "uuid" },
          itinerary: { $ref: "#/components/schemas/Itinerary" },
        },
        nullable: true,
      },
      error: { type: "string", nullable: true },
    },
  },
};
