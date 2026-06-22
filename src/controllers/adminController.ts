const { PrismaClient } = require('../../generated/prisma')

const prisma = new PrismaClient()

// ============================================
// 1. ADD A TOUR GUIDE
// ============================================
export async function addTourGuide(data: {
  display_name: string
  bio_description: string
  location_address: string
  location_lat: number
  location_lng: number
  media_assets: string[]
  charge_per_day: number
  language_capability: string[]
  expertise_tags: string[]
  certification_docs: string[]
}) {
  try {
    // Provider record
    const provider = await prisma.provider.create({
      data: {
        verification_status: false, // Start as false - admin must verify later!
        display_name: data.display_name,
        bio_description: data.bio_description,
        location_address: data.location_address,
        location_lat: data.location_lat,
        location_lng: data.location_lng,
        media_assets: data.media_assets,
        avg_rating: 0,        // Start with no ratings
        review_count: 0,       // Start with no reviews
        response_time_secs: 3600, // Default 1 hour
        
        // Connect to TourGuide specific data
        tour_guide: {
          create: {
            language_capability: data.language_capability,
            expertise_tags: data.expertise_tags,
            charge_per_day: data.charge_per_day,
            certification_docs: data.certification_docs
          }
        }
      }
    })
    
    console.log(`✅ Tour Guide added: ${provider.display_name} (ID: ${provider.provider_id})`)
    return provider
    
  } catch (error) {
    console.error("❌ Failed to add tour guide:", error)
    throw error
  }
}

// ============================================
// 2. ADD A CAR RENTAL
// ============================================
export async function addCarRental(data: {
  display_name: string
  bio_description: string
  location_address: string
  location_lat: number
  location_lng: number
  media_assets: string[]
  vehicle_make: string
  vehicle_model: string
  vehicle_year: number
  transmission: string
  fuel_type: string
  safety_features: string[]
  rental_terms_url: string
  daily_rate: number
  driver_required: boolean
}) {
  try {
    const provider = await prisma.provider.create({
      data: {
        verification_status: false,
        display_name: data.display_name,
        bio_description: data.bio_description,
        location_address: data.location_address,
        location_lat: data.location_lat,
        location_lng: data.location_lng,
        media_assets: data.media_assets,
        avg_rating: 0,
        review_count: 0,
        response_time_secs: 3600,
        
        car_rental: {
          create: {
            vehicle_make: data.vehicle_make,
            vehicle_model: data.vehicle_model,
            vehicle_year: data.vehicle_year,
            transmission: data.transmission,
            fuel_type: data.fuel_type,
            safety_features: data.safety_features,
            rental_terms_url: data.rental_terms_url,
            daily_rate: data.daily_rate,
            driver_required: data.driver_required
          }
        }
      }
    })
    
    console.log(`✅ Car Rental added: ${provider.display_name} (ID: ${provider.provider_id})`)
    return provider
    
  } catch (error) {
    console.error("❌ Failed to add car rental:", error)
    throw error
  }
}

// ============================================
// 3. ADD A HOTEL
// ============================================
export async function addHotel(data: {
  display_name: string
  bio_description: string
  location_address: string
  location_lat: number
  location_lng: number
  media_assets: string[]
  accommodation_type: string
  has_wifi: boolean
  has_backup_power: boolean
  has_security_staff: boolean
  distance_to_airport_km: number
  distance_to_business_km: number
  check_in_instructions: string
  base_price_per_night: number
}) {
  try {
    const provider = await prisma.provider.create({
      data: {
        verification_status: false,
        display_name: data.display_name,
        bio_description: data.bio_description,
        location_address: data.location_address,
        location_lat: data.location_lat,
        location_lng: data.location_lng,
        media_assets: data.media_assets,
        avg_rating: 0,
        review_count: 0,
        response_time_secs: 3600,
        
        hotel: {
          create: {
            accommodation_type: data.accommodation_type,
            has_wifi: data.has_wifi,
            has_backup_power: data.has_backup_power,
            has_security_staff: data.has_security_staff,
            distance_to_airport_km: data.distance_to_airport_km,
            distance_to_business_km: data.distance_to_business_km,
            check_in_instructions: data.check_in_instructions,
            base_price_per_night: data.base_price_per_night
          }
        }
      }
    })
    
    console.log(`✅ Hotel added: ${provider.display_name} (ID: ${provider.provider_id})`)
    return provider
    
  } catch (error) {
    console.error("❌ Failed to add hotel:", error)
    throw error
  }
}

// ============================================
// 4. VERIFY A PROVIDER (Turns verification_status to true)
// ============================================
export async function verifyProvider(provider_id: string) {
  try {
    const provider = await prisma.provider.update({
      where: { provider_id: provider_id },
      data: { verification_status: true }
    })
    
    console.log(`✅ Provider ${provider.display_name} is NOW VERIFIED!`)
    console.log(`   They will now appear in the user app.`)
    return provider
    
  } catch (error) {
    console.error("❌ Failed to verify provider:", error)
    throw error
  }
}

// ============================================
// 5. GET ALL UNVERIFIED PROVIDERS (For admin to review)
// ============================================
export async function getUnverifiedProviders() {
  try {
    const providers = await prisma.provider.findMany({
      where: { verification_status: false },
      include: {
        tour_guide: true,
        car_rental: true,
        hotel: true
      }
    })
    
    console.log(`📋 Found ${providers.length} unverified providers`)
    return providers
    
  } catch (error) {
    console.error("❌ Failed to get unverified providers:", error)
    throw error
  }
}