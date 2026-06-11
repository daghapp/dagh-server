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
        enum: [
          "NATURE",
          "CULTURAL",
          "HISTORICAL",
          "BEACH",
          "WILDLIFE",
          "RELIGIOUS",
          "SCENIC",
        ],
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
      primaryPlaceOfStay: { type: "string", nullable: true },
      proofOfAccommodationUrl: { type: "string", format: "uri", nullable: true },
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

  ItineraryDay: {
    type: "object",
    properties: {
      dayNumber: { type: "integer" },
      dayType: { type: "string", enum: ["PREPARATION", "TOURING", "DEPARTURE"] },
      sites: { type: "array", items: { $ref: "#/components/schemas/ItinerarySite" } },
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

