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

  ItinerarySite: {
    type: "object",
    properties: {
      visitOrder: { type: "integer" },
      site: { $ref: "#/components/schemas/TourSite" },
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
