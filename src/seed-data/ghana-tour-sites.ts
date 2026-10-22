import type { Prisma } from "../../generated/prisma/client.js";

/**
 * Additional Ghanaian tourist attractions covering all 16 administrative
 * regions. Coordinates are approximate (site/community centroids) and are
 * intentionally kept in the same shape as `rawTourSites` in src/seed.ts.
 *
 * Seeding merges this catalogue by unique name, so existing environments pick
 * up only the sites they are missing. `transit_profile` is derived from the
 * region during seeding — do not set it here.
 */
export const extraTourSites: Prisma.TourSiteCreateInput[] = [
  // ── Greater Accra ──────────────────────────────────────────────────
  {
    name: "Independence Square and Black Star Gate",
    region: "Greater Accra",
    latitude: 5.5478,
    longitude: -0.1922,
    description:
      "Accra's ceremonial square, anchored by the Black Star Gate and flanked by the Independence Arch, marking Ghana's 1957 independence.",
    category: "HISTORICAL",
  },
  {
    name: "National Museum of Ghana",
    region: "Greater Accra",
    latitude: 5.5561,
    longitude: -0.2058,
    description:
      "The country's largest museum, holding archaeological, ethnographic and art collections that trace Ghana's history and cultures.",
    category: "CULTURAL",
  },
  {
    name: "Osu Castle (Christiansborg Castle)",
    region: "Greater Accra",
    latitude: 5.5392,
    longitude: -0.1835,
    description:
      "A 17th-century coastal fort in Osu that served as the seat of government for decades and remains a landmark on Accra's shoreline.",
    category: "HISTORICAL",
  },
  {
    name: "Jamestown Lighthouse",
    region: "Greater Accra",
    latitude: 5.5333,
    longitude: -0.2167,
    description:
      "A bright red-and-white lighthouse overlooking Jamestown's fishing harbour and the historic Ga community.",
    category: "HISTORICAL",
  },
  {
    name: "Makola Market",
    region: "Greater Accra",
    latitude: 5.55,
    longitude: -0.21,
    description:
      "Accra's bustling central market, a dense maze of stalls selling fabric, food, household goods and almost everything else.",
    category: "CULTURAL",
  },
  {
    name: "National Theatre of Ghana",
    region: "Greater Accra",
    latitude: 5.5578,
    longitude: -0.2012,
    description:
      "A striking modern landmark near the city centre hosting theatre, dance, music and cultural performances.",
    category: "CULTURAL",
  },
  {
    name: "Legon Botanical Gardens",
    region: "Greater Accra",
    latitude: 5.65,
    longitude: -0.1833,
    description:
      "A green escape on the University of Ghana campus with canopy walks, boardwalks and lakeside picnic grounds.",
    category: "NATURE",
  },
  {
    name: "Ada Foah",
    region: "Greater Accra",
    latitude: 5.7833,
    longitude: 0.6333,
    description:
      "A coastal town where the Volta River meets the Atlantic, known for estuary boat trips, beaches and birdlife.",
    category: "BEACH",
  },
  {
    name: "Bojo Beach",
    region: "Greater Accra",
    latitude: 5.4667,
    longitude: -0.3167,
    description:
      "A clean, palm-fringed beach west of Accra reached by a short boat crossing over the Densu River.",
    category: "BEACH",
  },
  {
    name: "Kokrobite Beach",
    region: "Greater Accra",
    latitude: 5.5,
    longitude: -0.3667,
    description:
      "A relaxed fishing beach popular with Accra day-trippers for its seafood, live music and surf.",
    category: "BEACH",
  },
  {
    name: "W.E.B. Du Bois Memorial Centre",
    region: "Greater Accra",
    latitude: 5.57,
    longitude: -0.19,
    description:
      "The former home of Pan-African scholar W.E.B. Du Bois, now a memorial centre and research library in Accra.",
    category: "CULTURAL",
  },

  // ── Eastern ────────────────────────────────────────────────────────
  {
    name: "Akaa Falls",
    region: "Eastern",
    latitude: 6.1667,
    longitude: -0.2,
    description:
      "A dramatic waterfall near Amanase, reached by a forest trail and popular for swimming in its plunge pool.",
    category: "NATURE",
  },
  {
    name: "Umbrella Rock",
    region: "Eastern",
    latitude: 6.15,
    longitude: -0.1833,
    description:
      "A natural rock formation near Boti whose overhanging top resembles an open umbrella, with views over the Krobo hills.",
    category: "SCENIC",
  },
  {
    name: "Bunso Arboretum",
    region: "Eastern",
    latitude: 6.2833,
    longitude: -0.4667,
    description:
      "A forest arboretum and canopy walkway on the Accra–Kumasi road, home to towering trees, butterflies and birds.",
    category: "NATURE",
  },
  {
    name: "The Big Tree",
    region: "Eastern",
    latitude: 6.1,
    longitude: -0.9,
    description:
      "A famous giant tree in Ghana's eastern forest belt, a popular roadside stop for its sheer size and age.",
    category: "NATURE",
  },
  {
    name: "Lake Volta and Dodi Island",
    region: "Eastern",
    latitude: 6.3,
    longitude: 0.0833,
    description:
      "Boat trips from Akosombo across Lake Volta to Dodi Island, with views of the dam and the vast inland sea.",
    category: "SCENIC",
  },
  {
    name: "Koforidua Beads Market",
    region: "Eastern",
    latitude: 6.0833,
    longitude: -0.25,
    description:
      "The New Juaben bead market, where thousands of handmade glass and recycled beads are strung and sold.",
    category: "CULTURAL",
  },
  {
    name: "Tetteh Quarshie Cocoa Farm",
    region: "Eastern",
    latitude: 5.9167,
    longitude: -0.2,
    description:
      "The farm at Mampong-Akuapem where Tetteh Quarshie planted Ghana's first cocoa trees in the 1870s.",
    category: "HISTORICAL",
  },

  // ── Central ────────────────────────────────────────────────────────
  {
    name: "Fort St. Jago",
    region: "Central",
    latitude: 5.0847,
    longitude: -1.3497,
    description:
      "A hilltop Portuguese fort above Elmina, built in 1555 and used for centuries to protect the castle below.",
    category: "HISTORICAL",
  },
  {
    name: "Assin Manso Slave River Site",
    region: "Central",
    latitude: 5.85,
    longitude: -1.4833,
    description:
      "The 'Last Bath' site on the Donkor Nsuo river, where enslaved Africans were washed before the march to the coast.",
    category: "HISTORICAL",
  },
  {
    name: "Assin Praso Heritage Site",
    region: "Central",
    latitude: 5.9333,
    longitude: -1.5,
    description:
      "A former slave-trade crossing point on the Pra River with memorial markers and a small heritage centre.",
    category: "HISTORICAL",
  },
  {
    name: "Ajumako Craft Village",
    region: "Central",
    latitude: 5.4667,
    longitude: -0.9167,
    description:
      "A craft cooperative where local artisans produce pottery, weaving and woodwork using traditional techniques.",
    category: "CULTURAL",
  },
  {
    name: "Winneba",
    region: "Central",
    latitude: 5.35,
    longitude: -0.6333,
    description:
      "A lively coastal town known for its masquerade festivals, fishing harbour, beaches and music traditions.",
    category: "CULTURAL",
  },
  {
    name: "Fort Amsterdam",
    region: "Central",
    latitude: 5.2333,
    longitude: -1.05,
    description:
      "A 17th-century Dutch fort at Abandze with Atlantic views and a sobering history in the transatlantic slave trade.",
    category: "HISTORICAL",
  },
  {
    name: "Brenu Akyinim Beach",
    region: "Central",
    latitude: 5.0833,
    longitude: -1.3667,
    description:
      "A quiet palm-lined beach between Cape Coast and Elmina, good for walking, swimming and sunsets.",
    category: "BEACH",
  },
  {
    name: "Hans Cottage Botel",
    region: "Central",
    latitude: 5.15,
    longitude: -1.2833,
    description:
      "A lakeside lodge near Cape Coast with a crocodile pond, birdlife and a restaurant built over the water.",
    category: "WILDLIFE",
  },
  {
    name: "Mankessim Posuban Shrines",
    region: "Central",
    latitude: 5.2667,
    longitude: -1.0167,
    description:
      "Colourful, figurative Fante shrine structures that blend military and religious iconography in Mankessim.",
    category: "CULTURAL",
  },

  // ── Ashanti ────────────────────────────────────────────────────────
  {
    name: "Okomfo Anokye Sword Site",
    region: "Ashanti",
    latitude: 6.7,
    longitude: -1.6167,
    description:
      "The legendary sword said to have been planted by Okomfo Anokye at the founding of the Asante Kingdom.",
    category: "HISTORICAL",
  },
  {
    name: "Bonwire Kente Weaving Village",
    region: "Ashanti",
    latitude: 6.8,
    longitude: -1.4667,
    description:
      "The home of kente cloth, where weavers demonstrate the loom and sell hand-woven cloth in vivid patterns.",
    category: "CULTURAL",
  },
  {
    name: "Ntonso Adinkra Craft Village",
    region: "Ashanti",
    latitude: 6.7833,
    longitude: -1.5333,
    description:
      "A village famous for adinkra cloth, where symbols are carved into calabash stamps and printed by hand.",
    category: "CULTURAL",
  },
  {
    name: "Bobiri Forest Reserve",
    region: "Ashanti",
    latitude: 6.6833,
    longitude: -1.3333,
    description:
      "A protected rainforest and butterfly sanctuary near Kumasi with forest walks and abundant birdlife.",
    category: "NATURE",
  },
  {
    name: "Owabi Wildlife Sanctuary",
    region: "Ashanti",
    latitude: 6.75,
    longitude: -1.7,
    description:
      "A forest and wetland sanctuary around the Owabi reservoir, sheltering monkeys, antelopes and waterbirds.",
    category: "WILDLIFE",
  },
  {
    name: "Bomfobiri Wildlife Sanctuary",
    region: "Ashanti",
    latitude: 6.9167,
    longitude: -1.2833,
    description:
      "A hilly forest reserve with waterfalls, caves and hiking trails, one of Ashanti's quieter nature escapes.",
    category: "WILDLIFE",
  },
  {
    name: "Kumasi Fort and Military Museum",
    region: "Ashanti",
    latitude: 6.7,
    longitude: -1.6167,
    description:
      "A 19th-century fort in central Kumasi housing a military museum with weapons, uniforms and royal history.",
    category: "HISTORICAL",
  },
  {
    name: "Asante Traditional Buildings",
    region: "Ashanti",
    latitude: 6.7,
    longitude: -1.4667,
    description:
      "UNESCO-listed Asante courtyard houses with intricately decorated walls, surviving examples of a royal architectural tradition.",
    category: "HERITAGE",
  },
  {
    name: "Kumasi Zoo",
    region: "Ashanti",
    latitude: 6.7,
    longitude: -1.6167,
    description:
      "A long-running city zoo beside the Kejetia area, home to lions, primates, reptiles and local wildlife.",
    category: "WILDLIFE",
  },

  // ── Bono ───────────────────────────────────────────────────────────
  {
    name: "Bui National Park",
    region: "Bono",
    latitude: 8.2333,
    longitude: -2.25,
    description:
      "A vast savanna-forest park on the Black Volta with hippos, antelopes and boat safaris, shared with the Bono East border.",
    category: "WILDLIFE",
  },
  {
    name: "Bui Dam",
    region: "Bono",
    latitude: 8.2833,
    longitude: -2.2333,
    description:
      "A major hydroelectric dam at the base of the Banda Mountains, creating a reservoir within Bui National Park.",
    category: "SCENIC",
  },
  {
    name: "Nchiraa Waterfalls",
    region: "Bono",
    latitude: 7.75,
    longitude: -2.5167,
    description:
      "A waterfall north of Wenchi reached by a rocky forest hike, with nearby ancestral caves and birding.",
    category: "NATURE",
  },
  {
    name: "Wurobo Ancestral Caves",
    region: "Bono",
    latitude: 7.75,
    longitude: -2.55,
    description:
      "Caves near Nchiraa believed to be the original homes of the local people, set among rocky hills.",
    category: "HISTORICAL",
  },
  {
    name: "Duasidan Monkey Sanctuary",
    region: "Bono",
    latitude: 7.2167,
    longitude: -2.9333,
    description:
      "A community sanctuary southwest of Dormaa Ahenkro where habituated Mona monkeys come to feed among bamboos.",
    category: "WILDLIFE",
  },
  {
    name: "Hani Archaeological Site",
    region: "Bono",
    latitude: 7.6333,
    longitude: -2.5333,
    description:
      "An archaeological site near Wenchi linked to the ancient Begho civilisation, with relics dating back centuries.",
    category: "HISTORICAL",
  },
  {
    name: "Busia Mausoleum",
    region: "Bono",
    latitude: 7.5833,
    longitude: -2.5167,
    description:
      "The Wenchi memorial to Prime Minister Kofi Abrefa Busia, displaying personal artefacts and political history.",
    category: "HISTORICAL",
  },
  {
    name: "Nwoase Ostrich Farm",
    region: "Bono",
    latitude: 7.6,
    longitude: -2.5,
    description:
      "A working ostrich farm near Wenchi where visitors can see and learn about the world's largest living bird.",
    category: "WILDLIFE",
  },
  {
    name: "Asukese Forest Reserve",
    region: "Bono",
    latitude: 7.1833,
    longitude: -2.55,
    description:
      "A forest reserve southwest of Sunyani with tall timber species, trails and small forest wildlife.",
    category: "NATURE",
  },

  // ── Bono East ──────────────────────────────────────────────────────
  {
    name: "Fuller Falls",
    region: "Bono East",
    latitude: 8.0833,
    longitude: -1.7,
    description:
      "A smaller companion waterfall near Kintampo, reached by a short forest walk and often visited with the main falls.",
    category: "NATURE",
  },
  {
    name: "Buabeng-Fiema Monkey Sanctuary",
    region: "Bono East",
    latitude: 8.3,
    longitude: -1.7,
    description:
      "A community forest reserve where Mona and black-and-white colobus monkeys live alongside the village.",
    category: "WILDLIFE",
  },
  {
    name: "Buoyem Caves and Bats Colony",
    region: "Bono East",
    latitude: 7.7667,
    longitude: -1.75,
    description:
      "Rocky caves in the Techiman area that shelter a large bat colony and offer views over the surrounding hills.",
    category: "NATURE",
  },
  {
    name: "Bono Manso Slave Centre",
    region: "Bono East",
    latitude: 7.7,
    longitude: -1.8333,
    description:
      "A heritage site commemorating Bono Manso's role in the trans-Saharan and Atlantic slave trades.",
    category: "HISTORICAL",
  },
  {
    name: "Tano Boase Sacred Grove",
    region: "Bono East",
    latitude: 7.7167,
    longitude: -1.9,
    description:
      "A sacred forest and shrine near Tanoboase, preserved by local tradition and rich in tall trees and wildlife.",
    category: "CULTURAL",
  },
  {
    name: "Digya National Park",
    region: "Bono East",
    latitude: 7.5833,
    longitude: -0.5833,
    description:
      "Ghana's oldest national park, a large woodland savanna on the western shore of Lake Volta with elephants and primates.",
    category: "WILDLIFE",
  },
  {
    name: "Techiman Market",
    region: "Bono East",
    latitude: 7.5833,
    longitude: -1.9333,
    description:
      "One of Ghana's biggest weekly markets, drawing traders from across the middle belt for yams, grains and livestock.",
    category: "CULTURAL",
  },

  // ── Ahafo ──────────────────────────────────────────────────────────
  {
    name: "Mim Buo",
    region: "Ahafo",
    latitude: 6.9167,
    longitude: -2.6167,
    description:
      "Three dramatic rocky peaks rising above Mim, wrapped in local legend and offering views across the forest belt.",
    category: "SCENIC",
  },
  {
    name: "Mim Lake",
    region: "Ahafo",
    latitude: 6.91875,
    longitude: -2.55271,
    description:
      "A quiet lake at Mim used for recreation and fishing, surrounded by the town's cocoa-growing landscape.",
    category: "NATURE",
  },
  {
    name: "Asumura White-Necked Rockfowl Conservation",
    region: "Ahafo",
    latitude: 6.8833,
    longitude: -2.75,
    description:
      "A forest conservation site near Akrodie protecting the rare white-necked rockfowl, a magnet for birders.",
    category: "WILDLIFE",
  },
  {
    name: "Okomfo Anokye Tree at Sankore",
    region: "Ahafo",
    latitude: 6.95,
    longitude: -2.4167,
    description:
      "A historic tree at Sankore linked to the legendary priest Okomfo Anokye, still a local cultural landmark.",
    category: "HISTORICAL",
  },
  {
    name: "Bonsam Bepo Forest Reserve",
    region: "Ahafo",
    latitude: 6.65046,
    longitude: -2.6667,
    description:
      "A forest reserve in southern Ahafo with dense canopy, streams and trails for nature walks.",
    category: "NATURE",
  },
  {
    name: "Mim Quarry Lake",
    region: "Ahafo",
    latitude: 6.88314,
    longitude: -2.51389,
    description:
      "A striking blue-green lake formed in an old quarry near Mim, now a local scenic spot.",
    category: "NATURE",
  },

  // ── Northern ───────────────────────────────────────────────────────
  {
    name: "Greenwich Meridian Point, Yendi",
    region: "Northern",
    latitude: 9.45,
    longitude: -0.0167,
    description:
      "A marked point near Yendi where the Greenwich Meridian crosses Ghana, celebrated as a geographic curiosity.",
    category: "HISTORICAL",
  },
  {
    name: "Tamale Zoological Garden",
    region: "Northern",
    latitude: 9.4008,
    longitude: -0.8393,
    description:
      "A city zoo in Tamale with savanna wildlife, primates and reptiles, popular with families and school groups.",
    category: "WILDLIFE",
  },
  {
    name: "Tamale Craft Centre",
    region: "Northern",
    latitude: 9.4,
    longitude: -0.8333,
    description:
      "A cooperative of northern craftspeople selling woven baskets, leatherwork, smocks and metalwork.",
    category: "CULTURAL",
  },
  {
    name: "Kukuo Pottery Centre",
    region: "Northern",
    latitude: 9.3833,
    longitude: -0.85,
    description:
      "A Tamale pottery village where women shape and fire traditional earthenware using hand-built techniques.",
    category: "CULTURAL",
  },
  {
    name: "Gushegu Local Textile Centre",
    region: "Northern",
    latitude: 9.9167,
    longitude: -0.2167,
    description:
      "A weaving centre in Gushegu known for hand-spun and hand-woven northern textiles and smocks.",
    category: "CULTURAL",
  },
  {
    name: "Jaagbo Sacred Grove and Shrine",
    region: "Northern",
    latitude: 9.4,
    longitude: -0.9,
    description:
      "A protected sacred grove near Tolon with tall trees, shrines and cultural significance to local communities.",
    category: "CULTURAL",
  },
  {
    name: "Yendi Heritage Sites",
    region: "Northern",
    latitude: 9.45,
    longitude: -0.0167,
    description:
      "Traditional sites around Yendi associated with the Dagbon kingdom, including palaces, shrines and festival grounds.",
    category: "HERITAGE",
  },
  {
    name: "Naa Gbewaa Palace",
    region: "Northern",
    latitude: 9.45,
    longitude: -0.0167,
    description:
      "The royal palace at Yendi of the Ya-Na, spiritual and traditional leader of the Dagbon people.",
    category: "HERITAGE",
  },

  // ── North East ─────────────────────────────────────────────────────
  {
    name: "Gambaga Escarpment",
    region: "North East",
    latitude: 10.5333,
    longitude: -0.45,
    description:
      "A dramatic rocky ridge running across the North East, offering panoramic views of the surrounding savanna.",
    category: "SCENIC",
  },
  {
    name: "White Volta and Red Volta Confluence",
    region: "North East",
    latitude: 10.55,
    longitude: -0.45,
    description:
      "The meeting of the White and Red Volta rivers, an important waterway and birdlife corridor in the north-east.",
    category: "NATURE",
  },
  {
    name: "NaYiri Palace, Nalerigu",
    region: "North East",
    latitude: 10.5333,
    longitude: -0.3667,
    description:
      "The palace of the Nayiri, paramount chief of Mamprugu, a centre of traditional governance and culture.",
    category: "HERITAGE",
  },
  {
    name: "NaJeringa Historic Slave Wall",
    region: "North East",
    latitude: 10.5333,
    longitude: -0.3667,
    description:
      "Remains of an old defensive wall at Nalerigu tied to the history of slave raiding in the northern savanna.",
    category: "HISTORICAL",
  },
  {
    name: "Ancient Rock Art at Gingana",
    region: "North East",
    latitude: 10.6,
    longitude: -0.4,
    description:
      "Prehistoric rock paintings and engravings on outcrops near Gingana, among Ghana's oldest artistic records.",
    category: "HISTORICAL",
  },
  {
    name: "Zayaa Mosque-Shrine, Wulugu",
    region: "North East",
    latitude: 10.4667,
    longitude: -0.7667,
    description:
      "A historic Sudanese-style mosque and shrine at Wulugu, associated with early Islamic scholarship in the north.",
    category: "RELIGIOUS",
  },
  {
    name: "Buyuori Cave",
    region: "North East",
    latitude: 10.55,
    longitude: -0.4,
    description:
      "A natural cave in the rocky north-east landscape used historically as shelter and a local sacred site.",
    category: "NATURE",
  },
  {
    name: "Ancient Koma Figurines, Yikpabongo",
    region: "North East",
    latitude: 10.55,
    longitude: -0.8,
    description:
      "An archaeological site near Yikpabongo where distinctive Koma terracotta figurines were unearthed.",
    category: "HISTORICAL",
  },
  {
    name: "Gambaga Witch Camp",
    region: "North East",
    latitude: 10.5333,
    longitude: -0.45,
    description:
      "A settlement near Gambaga that has sheltered women accused of witchcraft, now a place of cultural and social reflection.",
    category: "CULTURAL",
  },

  // ── Oti ────────────────────────────────────────────────────────────
  {
    name: "Kyabobo National Park",
    region: "Oti",
    latitude: 8.28091,
    longitude: 0.53067,
    description:
      "A mountainous national park on the Togo border with forest-savanna, waterfalls and hiking trails around Mount Dzebobo.",
    category: "WILDLIFE",
  },
  {
    name: "Lake Volta at Kete Krachi",
    region: "Oti",
    latitude: 7.79104,
    longitude: -0.0618,
    description:
      "A lakeside town and ferry crossing on Lake Volta, with boat trips, fishing and views across the water.",
    category: "SCENIC",
  },
  {
    name: "Breast Mountain",
    region: "Oti",
    latitude: 8.35112,
    longitude: 0.53863,
    description:
      "Two adjacent hills in Kyabobo whose silhouette resembles a woman's breasts, with a summit viewpoint.",
    category: "SCENIC",
  },
  {
    name: "Chilinga",
    region: "Oti",
    latitude: 8.1,
    longitude: 0.3,
    description:
      "A scenic Oti landscape of hills, river valleys and forest, listed among the region's emerging nature attractions.",
    category: "NATURE",
  },
  {
    name: "Chaiso Forest Reserve",
    region: "Oti",
    latitude: 7.5,
    longitude: 0.4,
    description:
      "A protected forest reserve in the Oti hills with walking trails and rich bird and butterfly life.",
    category: "NATURE",
  },
  {
    name: "Shiare Hanging Village",
    region: "Oti",
    latitude: 8.29188,
    longitude: 0.60949,
    description:
      "A roughly 900-year-old Akyode settlement of rock-and-clay terraced houses built into the Breast Mountains.",
    category: "CULTURAL",
  },
  {
    name: "Dambai Ferry and Oti River",
    region: "Oti",
    latitude: 8.08907,
    longitude: 0.17772,
    description:
      "A working ferry crossing over the Oti River at Dambai, doubling as a scenic boat and canoe experience.",
    category: "SCENIC",
  },
  {
    name: "Kute Waterfalls",
    region: "Oti",
    latitude: 7.4,
    longitude: 0.5,
    description:
      "A forest waterfall in the Jasikan area, one of several hidden cascades in the Oti highlands.",
    category: "NATURE",
  },

  // ── Savannah ───────────────────────────────────────────────────────
  {
    name: "Larabanga Mystic Stone",
    region: "Savannah",
    latitude: 9.2333,
    longitude: -1.8667,
    description:
      "A sacred stone beside the Larabanga Mosque, linked to the town's founding legend and still a place of pilgrimage.",
    category: "CULTURAL",
  },
  {
    name: "Mognori Eco Village",
    region: "Savannah",
    latitude: 9.3,
    longitude: -1.9,
    description:
      "A community-run eco-village near Mole where visitors learn about local farming, shea butter and village life.",
    category: "CULTURAL",
  },
  {
    name: "Kulmasa Crocodile Pond",
    region: "Savannah",
    latitude: 9.4,
    longitude: -2.0,
    description:
      "A sacred pond near Mole where crocodiles are protected by tradition and can be viewed at close range.",
    category: "WILDLIFE",
  },
  {
    name: "Sonyo Eco-Village",
    region: "Savannah",
    latitude: 9.6,
    longitude: -1.9,
    description:
      "A community tourism village offering guided walks, traditional crafts and insight into savanna village life.",
    category: "CULTURAL",
  },
  {
    name: "Salaga Slave Well and Market",
    region: "Savannah",
    latitude: 8.55,
    longitude: -0.5167,
    description:
      "The historic Salaga market and slave well, once a major hub of the northern slave trade.",
    category: "HISTORICAL",
  },
  {
    name: "Daboya Waterfall",
    region: "Savannah",
    latitude: 9.5,
    longitude: -1.42,
    description:
      "A seasonal waterfall near Daboya, a historic town known for its salt and indigo dyeing traditions.",
    category: "NATURE",
  },
  {
    name: "Makango Water Safari",
    region: "Savannah",
    latitude: 8.6,
    longitude: -0.4,
    description:
      "Boat safaris on the Volta River near Makango, with birdlife, fishing communities and riverside scenery.",
    category: "WILDLIFE",
  },
  {
    name: "Yapei and Buipe River Ports",
    region: "Savannah",
    latitude: 8.95,
    longitude: -1.5,
    description:
      "Working river ports on the Volta, where ferries, cargo boats and fishing canoes cross the waterway.",
    category: "SCENIC",
  },

  // ── Upper East ─────────────────────────────────────────────────────
  {
    name: "Tongo-Tenzug Shrine",
    region: "Upper East",
    latitude: 10.85,
    longitude: -0.8,
    description:
      "A sacred shrine among the rocky Tongo Hills, reached by a climb and central to local Talensi belief.",
    category: "HERITAGE",
  },
  {
    name: "Sirigu Art and Pottery Village",
    region: "Upper East",
    latitude: 10.95,
    longitude: -1.0,
    description:
      "A women-led arts community famous for hand-built pottery, wall painting and basketry in northern styles.",
    category: "CULTURAL",
  },
  {
    name: "Bolgatanga Museum",
    region: "Upper East",
    latitude: 10.7833,
    longitude: -0.85,
    description:
      "A regional museum preserving Upper East artefacts, basketry, archaeology and cultural history.",
    category: "CULTURAL",
  },
  {
    name: "Navrongo Cathedral",
    region: "Upper East",
    latitude: 10.8833,
    longitude: -1.0833,
    description:
      "The historic Our Lady of Seven Sorrows Cathedral, built in the early 20th century with distinctive local architecture.",
    category: "RELIGIOUS",
  },
  {
    name: "Paga-Nania Slave Camp",
    region: "Upper East",
    latitude: 10.9833,
    longitude: -1.1,
    description:
      "A former slave transit camp near Paga with rock carvings, grinding stones and guided historical tours.",
    category: "HISTORICAL",
  },
  {
    name: "Kulungugu Bomb Site",
    region: "Upper East",
    latitude: 11.0,
    longitude: -0.85,
    description:
      "The site of the 1962 Kulungugu bomb incident that targeted President Kwame Nkrumah, marked as a historic landmark.",
    category: "HISTORICAL",
  },

  // ── Upper West ─────────────────────────────────────────────────────
  {
    name: "Wechiau Hippo Sanctuary",
    region: "Upper West",
    latitude: 9.8333,
    longitude: -2.6667,
    description:
      "A community-managed stretch of the Black Volta protecting hippos, with guided river safaris and riverside camps.",
    category: "WILDLIFE",
  },
  {
    name: "Gwollu Slave Defence Wall",
    region: "Upper West",
    latitude: 10.6,
    longitude: -2.5,
    description:
      "A 19th-century defensive wall built at Gwollu against slave raiders, a rare surviving example in northern Ghana.",
    category: "HISTORICAL",
  },
  {
    name: "Nakore Ancient Mosque",
    region: "Upper West",
    latitude: 10.0,
    longitude: -2.5,
    description:
      "A small Sudanese-style mosque believed to date from the 17th century, built with mud and timber forked supports.",
    category: "RELIGIOUS",
  },
  {
    name: "Wa Naa's Palace",
    region: "Upper West",
    latitude: 10.0667,
    longitude: -2.5,
    description:
      "The traditional palace of the Wa Naa, an important centre of Wala governance and culture in Wa.",
    category: "HERITAGE",
  },
  {
    name: "Gbelle Game Reserve",
    region: "Upper West",
    latitude: 10.0,
    longitude: -2.3,
    description:
      "A savanna reserve west of Wa protecting roan antelope, hartebeest, baboons and a variety of birds.",
    category: "WILDLIFE",
  },
  {
    name: "Dondoli Mosque",
    region: "Upper West",
    latitude: 10.1,
    longitude: -2.6,
    description:
      "A historic mud-and-timber mosque near Wa, an example of the Sudanese architectural tradition in Ghana.",
    category: "RELIGIOUS",
  },
  {
    name: "Bulenga Caves",
    region: "Upper West",
    latitude: 10.1,
    longitude: -2.3,
    description:
      "Rocky caves and outcrops near Bulenga used historically as shelter, with views over the surrounding savanna.",
    category: "NATURE",
  },
  {
    name: "Sankana Caves",
    region: "Upper West",
    latitude: 10.2,
    longitude: -2.4,
    description:
      "Caves in the Sankana hills linked to local history and resistance during the slave-raiding era.",
    category: "HISTORICAL",
  },
  {
    name: "Wa Central Market",
    region: "Upper West",
    latitude: 10.0667,
    longitude: -2.5,
    description:
      "A lively market in Wa selling shea butter, grains, woven goods and northern crafts.",
    category: "CULTURAL",
  },

  // ── Volta ──────────────────────────────────────────────────────────
  {
    name: "Amedzofe Village",
    region: "Volta",
    latitude: 6.8333,
    longitude: 0.4167,
    description:
      "A mountain village in the Avatime hills known for its cool climate, views and access to Mount Gemi.",
    category: "CULTURAL",
  },
  {
    name: "Tagbo Falls",
    region: "Volta",
    latitude: 6.8333,
    longitude: 0.4667,
    description:
      "A tall waterfall near Liata, reached by a forest trail from Amedzofe and popular for hiking.",
    category: "NATURE",
  },
  {
    name: "Kpetoe Kente Weaving Village",
    region: "Volta",
    latitude: 6.3,
    longitude: 0.6833,
    description:
      "An Ewe weaving town near the Togo border famous for brightly coloured kente and traditional cloth.",
    category: "CULTURAL",
  },
  {
    name: "Ho and Asogli Cultural Route",
    region: "Volta",
    latitude: 6.6,
    longitude: 0.4667,
    description:
      "Cultural sites around Ho connected to the Asogli state, including palaces, shrines and festival grounds.",
    category: "CULTURAL",
  },
  {
    name: "Volta Lake and Adome Bridge",
    region: "Volta",
    latitude: 6.35,
    longitude: 0.05,
    description:
      "The Adome Bridge crosses the Volta River near its delta, with lake views and riverside stops.",
    category: "SCENIC",
  },
  {
    name: "Fort Prinzenstein, Keta",
    region: "Volta",
    latitude: 5.92,
    longitude: 0.98,
    description:
      "A Danish-built coastal fort at Keta, now partly eroded by the sea, with a powerful slave-trade history.",
    category: "HISTORICAL",
  },
  {
    name: "Keta Lagoon",
    region: "Volta",
    latitude: 5.9,
    longitude: 0.9,
    description:
      "Ghana's largest lagoon, a Ramsar wetland with mangroves, fishing villages and large flocks of birds.",
    category: "NATURE",
  },
  {
    name: "Amedzofe Canopy Walk",
    region: "Volta",
    latitude: 6.8333,
    longitude: 0.4167,
    description:
      "A forest canopy walkway near Amedzofe offering views over the Avatime hills and surrounding rainforest.",
    category: "ADVENTURE",
  },

  // ── Western ────────────────────────────────────────────────────────
  {
    name: "Princess Town Beach",
    region: "Western",
    latitude: 5.15,
    longitude: -1.5,
    description:
      "A long Atlantic beach at Princes Town near Fort Gross Friedrichsburg, with fishing canoes and surf.",
    category: "BEACH",
  },
  {
    name: "Fort Metal Cross, Dixcove",
    region: "Western",
    latitude: 4.8,
    longitude: -1.95,
    description:
      "A 17th-century British fort on a headland above Dixcove harbour, with sweeping coastal views.",
    category: "HISTORICAL",
  },
  {
    name: "Fort Batenstein, Butre",
    region: "Western",
    latitude: 4.85,
    longitude: -1.9,
    description:
      "A hilltop Dutch fort overlooking Butre bay, surrounded by rainforest and a quiet fishing village.",
    category: "HISTORICAL",
  },
  {
    name: "Axim and Fort Santo Antonio",
    region: "Western",
    latitude: 4.8667,
    longitude: -2.2333,
    description:
      "A coastal town with a Portuguese-built fort, beaches and a lively fishing harbour.",
    category: "HISTORICAL",
  },
  {
    name: "Fort San Sebastian, Shama",
    region: "Western",
    latitude: 5.0,
    longitude: -1.6333,
    description:
      "One of the oldest European forts in Ghana, built by the Portuguese at Shama near the Pra River mouth.",
    category: "HISTORICAL",
  },
  {
    name: "Cape Three Points",
    region: "Western",
    latitude: 4.75,
    longitude: -2.0833,
    description:
      "The southernmost tip of Ghana, where rainforest meets the Atlantic and a lighthouse marks the cape.",
    category: "SCENIC",
  },
  {
    name: "Butre Beach",
    region: "Western",
    latitude: 4.85,
    longitude: -1.9,
    description:
      "A secluded palm-backed beach beside Butre village, good for walking and watching fishing canoes.",
    category: "BEACH",
  },
  {
    name: "Amansuri Wetland",
    region: "Western",
    latitude: 5.0,
    longitude: -2.5,
    description:
      "A Ramsar wetland of lagoons, swamps and raffia palms near Nzulezo, rich in birds and aquatic life.",
    category: "NATURE",
  },

  // ── Western North ──────────────────────────────────────────────────
  {
    name: "Bia National Park",
    region: "Western North",
    latitude: 6.50499,
    longitude: -3.07766,
    description:
      "A protected rainforest in the Bia Conservation Area known for primates, forest elephants and guided walks.",
    category: "WILDLIFE",
  },
  {
    name: "Bia Biosphere Reserve",
    region: "Western North",
    latitude: 6.5,
    longitude: -3.0,
    description:
      "A UNESCO biosphere reserve combining national park and resource reserve, home to exceptional forest biodiversity.",
    category: "NATURE",
  },
  {
    name: "Bonsai Waterfalls",
    region: "Western North",
    latitude: 6.39558,
    longitude: -2.8762,
    description:
      "A forest waterfall in the Juaboso-Bia district, reached by a short hike and flowing even in the dry season.",
    category: "NATURE",
  },
  {
    name: "Mystery Hole",
    region: "Western North",
    latitude: 6.4,
    longitude: -2.9,
    description:
      "A local natural curiosity in the Sefwi forest belt, wrapped in folklore and surrounded by cocoa farms.",
    category: "NATURE",
  },
  {
    name: "Ankobra River",
    region: "Western North",
    latitude: 5.5,
    longitude: -2.5,
    description:
      "A major forest river winding through Western North, with riverside trails, bridges and fishing communities.",
    category: "NATURE",
  },
  {
    name: "Bia River Landscape",
    region: "Western North",
    latitude: 6.4,
    longitude: -3.0,
    description:
      "The Bia River and its forested catchment, a scenic corridor through the cocoa and timber belt.",
    category: "SCENIC",
  },
  {
    name: "Sefwi-Wiawso Traditional Palace",
    region: "Western North",
    latitude: 6.5,
    longitude: -2.5,
    description:
      "The ceremonial seat of the Omanhene of Sefwi-Wiawso, a living heritage site tied to local festivals.",
    category: "HERITAGE",
  },
  {
    name: "Dwenase Market",
    region: "Western North",
    latitude: 6.5,
    longitude: -2.5,
    description:
      "Sefwi-Wiawso's main market, trading produce, foodstuffs, cloth and household goods from surrounding villages.",
    category: "CULTURAL",
  },
  {
    name: "Krokosue Forest Reserve",
    region: "Western North",
    latitude: 6.50661,
    longitude: -2.7979,
    description:
      "A forest reserve in the Sefwi hills with timber species, streams and quiet walking trails.",
    category: "NATURE",
  },
];
