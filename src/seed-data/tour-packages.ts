export interface SeedTourPackage {
  title: string;
  slug: string;
  category: string;
  subcategory: string;
  categories: string[];
  region: string;
  durationDays: number;
  durationNights: number;
  basePrice: number;
  coverImage: string;
  featured: boolean;
  trending: boolean;
  shortDescription: string;
  description: string;
  locations: string[];
  includes: string[];
  excludes: string[];
}

export const tourPackages: SeedTourPackage[] = [
  {
    title: "Coastal Heritage Discovery",
    slug: "coastal-heritage-discovery",
    category: "heritage",
    subcategory: "historical",
    categories: ["Heritage", "Historical", "Coastal"],
    region: "Central",
    durationDays: 3,
    durationNights: 2,
    basePrice: 2400,
    coverImage: "https://images.unsplash.com/photo-1560882344-826acd27c2b2",
    featured: true,
    trending: true,
    shortDescription: "Trace Ghana's history from Accra to Cape Coast and Elmina.",
    description:
      "A 3-day journey through Ghana's slave castles, coastal forts and the vibrant culture of the Central Region, including visits to the Kwame Nkrumah Mausoleum, Cape Coast Castle and Elmina Castle.",
    locations: [
      "Kwame Nkrumah Mausoleum",
      "Cape Coast Castle",
      "Elmina Castle",
      "Kakum National Park",
    ],
    includes: ["Accommodation", "Transport", "Local guides", "Entrance fees"],
    excludes: ["International flights", "Travel insurance", "Personal expenses"],
  },
  {
    title: "Ashanti Kingdom & Culture",
    slug: "ashanti-kingdom-culture",
    category: "cultural",
    subcategory: "heritage",
    categories: ["Cultural", "Heritage"],
    region: "Ashanti",
    durationDays: 2,
    durationNights: 1,
    basePrice: 1600,
    coverImage: "https://images.unsplash.com/photo-1580654712603-eb43273aff33",
    featured: true,
    trending: false,
    shortDescription: "Explore the Ashanti capital, royal history and vibrant markets.",
    description:
      "Discover the seat of the Ashanti Kingdom with visits to the Manhyia Palace Museum, Kejetia Market and the sacred Lake Bosomtwe.",
    locations: ["Manhyia Palace Museum", "Kejetia Market", "Lake Bosomtwe"],
    includes: ["Accommodation", "Transport", "Local guides"],
    excludes: ["Personal expenses", "Gratuities", "Travel insurance"],
  },
  {
    title: "Volta Waterfalls & Nature",
    slug: "volta-waterfalls-nature",
    category: "nature",
    subcategory: "adventure",
    categories: ["Nature", "Adventure"],
    region: "Volta",
    durationDays: 2,
    durationNights: 1,
    basePrice: 1400,
    coverImage: "https://images.unsplash.com/photo-1506744038136-46273834b3fb",
    featured: false,
    trending: false,
    shortDescription: "Waterfalls, monkeys and the highest peak in Ghana.",
    description:
      "A nature escape to the Volta Region featuring Wli Waterfalls, the Tafi Atome Monkey Sanctuary and Mount Afadjato.",
    locations: ["Wli Waterfalls", "Tafi Atome Monkey Sanctuary", "Mount Afadjato"],
    includes: ["Accommodation", "Transport", "Park fees", "Local guides"],
    excludes: ["Hiking boots", "Personal expenses", "Travel insurance"],
  },
  {
    title: "Northern Safari Adventure",
    slug: "northern-safari-adventure",
    category: "wildlife",
    subcategory: "safari",
    categories: ["Wildlife", "Safari"],
    region: "Savannah",
    durationDays: 4,
    durationNights: 3,
    basePrice: 3200,
    coverImage: "https://images.unsplash.com/photo-1547471080-7cc2caa01a7e",
    featured: false,
    trending: true,
    shortDescription: "Elephants, the Larabanga mosque and the savannah north.",
    description:
      "A 4-day safari through Mole National Park with elephant sightings, the historic Larabanga Mosque and Paga's sacred crocodile pond.",
    locations: ["Mole National Park", "Larabanga Mosque", "Paga Crocodile Pond"],
    includes: ["Accommodation", "Transport", "Game drives", "Park fees"],
    excludes: ["International flights", "Travel insurance", "Personal expenses"],
  },
];
