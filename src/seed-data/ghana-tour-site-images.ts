/**
 * Photo URLs for the seeded tour sites.
 *
 * Most entries resolve to a specific Wikimedia Commons page image; sites without
 * a dedicated photograph fall back to a representative image for their category.
 * `credit` is kept alongside the URL so the frontend can render attribution.
 *
 * Each site can have up to 4 images. Sites with fewer than 4 images will
 * display whichever are available; the frontend should gracefully handle
 * missing images.
 */
export interface SiteImageDetail {
  url: string;
  credit: string;
}

/** Up to 4 images per tour site. */
export type SiteImageGallery = SiteImageDetail | SiteImageDetail[];

export const siteImages: Record<string, SiteImageGallery> = {
  "Aburi Botanical Gardens": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Aburi_garden_2.jpg/1920px-Aburi_garden_2.jpg",
    credit: "Wikimedia Commons",
  },
  "Ada Foah": {
    url: "https://upload.wikimedia.org/wikipedia/commons/4/44/Ada_Foah_Fort.jpg",
    credit: "Wikimedia Commons",
  },
  "Ajumako Craft Village": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Akaa Falls": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e3/Aka_falls_-_Ghana_-_West_Africa.png",
    credit: "Wikimedia Commons",
  },
  "Akosombo Dam": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Akosombo_Dam_from_the_Volta_Hotel.JPG/1920px-Akosombo_Dam_from_the_Volta_Hotel.JPG",
    credit: "Wikimedia Commons",
  },
  "Amansuri Wetland": {
    url: "https://upload.wikimedia.org/wikipedia/commons/5/50/Nzulezo_stilt_village.jpg",
    credit: "Wikimedia Commons",
  },
  "Amedzofe Canopy Walk": {
    url: "https://upload.wikimedia.org/wikipedia/commons/1/16/Kakum.jpg",
    credit: "Wikimedia Commons",
  },
  "Amedzofe Village": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Ancient Koma Figurines, Yikpabongo": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/Ghana_museums_and_monuments_Board6.jpg/1920px-Ghana_museums_and_monuments_Board6.jpg",
    credit: "Wikimedia Commons",
  },
  "Ancient Rock Art at Gingana": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c6/Tongo_Hills.jpg/1920px-Tongo_Hills.jpg",
    credit: "Wikimedia Commons",
  },
  "Ankasa Conservation Area": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Ankasa_Conservation_1.jpg/1920px-Ankasa_Conservation_1.jpg",
    credit: "Wikimedia Commons",
  },
  "Ankobra River": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1f/Ankobra_River%2C_Ghana.JPG/1920px-Ankobra_River%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Asante Traditional Buildings": {
    url: "https://upload.wikimedia.org/wikipedia/commons/3/3a/Ashant_architecture.jpg",
    credit: "Wikimedia Commons",
  },
  "Assin Manso Slave River Site": {
    url: "https://upload.wikimedia.org/wikipedia/commons/0/01/An_Adventurous_Trip.jpg",
    credit: "Wikimedia Commons",
  },
  "Assin Praso Heritage Site": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Asukese Forest Reserve": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "Asumura White-Necked Rockfowl Conservation": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fb/White-necked_rockfowl_%28Picathartes_gymnocephalus%29_Nyamebe_Bepo.jpg/1920px-White-necked_rockfowl_%28Picathartes_gymnocephalus%29_Nyamebe_Bepo.jpg",
    credit: "Wikimedia Commons",
  },
  "Axim and Fort Santo Antonio": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Bia Biosphere Reserve": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7d/Bia_National_Park_Ecosystem.jpg/1920px-Bia_National_Park_Ecosystem.jpg",
    credit: "Wikimedia Commons",
  },
  "Bia National Park": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c8/Bia_National_Park%2C_and_a_rice_farm.jpg/1920px-Bia_National_Park%2C_and_a_rice_farm.jpg",
    credit: "Wikimedia Commons",
  },
  "Bia River Landscape": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8e/Trees_in_Bia_Forest.JPG/1920px-Trees_in_Bia_Forest.JPG",
    credit: "Wikimedia Commons",
  },
  "Bobiri Forest Reserve": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Clerodendrum_paniculatum_1.jpg/1920px-Clerodendrum_paniculatum_1.jpg",
    credit: "Wikimedia Commons",
  },
  "Bojo Beach": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Solnedgang_p%C3%A5_Labadi_beach.jpg/1920px-Solnedgang_p%C3%A5_Labadi_beach.jpg",
    credit: "Wikimedia Commons",
  },
  "Bolgatanga Market": {
    url: "https://upload.wikimedia.org/wikipedia/commons/0/08/Bolgatanga_Montage.jpg",
    credit: "Wikimedia Commons",
  },
  "Bolgatanga Museum": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Bomfobiri Wildlife Sanctuary": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Bono Manso Slave Centre": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Bonsai Waterfalls": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "Bonsam Bepo Forest Reserve": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "Bonwire Kente Weaving Village": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Boti Falls": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/Boti_Falls%2C_Eastern_Region.JPG/1920px-Boti_Falls%2C_Eastern_Region.JPG",
    credit: "Wikimedia Commons",
  },
  "Breast Mountain": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Mountain_Afadja.jpg/1920px-Mountain_Afadja.jpg",
    credit: "Wikimedia Commons",
  },
  "Brenu Akyinim Beach": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Solnedgang_p%C3%A5_Labadi_beach.jpg/1920px-Solnedgang_p%C3%A5_Labadi_beach.jpg",
    credit: "Wikimedia Commons",
  },
  "Buabeng-Fiema Monkey Sanctuary": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Bui Dam": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Bui_Dam.jpg/1920px-Bui_Dam.jpg",
    credit: "Wikimedia Commons",
  },
  "Bui National Park": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ae/Bui_National_Park_2009.jpg",
    credit: "Wikimedia Commons",
  },
  "Bulenga Caves": {
    url: "https://upload.wikimedia.org/wikipedia/commons/d/d1/A_Big_Tree_Cave_in_Northern_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Bunso Arboretum": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e4/Bonsu_Eco_Park.jpg",
    credit: "Wikimedia Commons",
  },
  "Buoyem Caves and Bats Colony": {
    url: "https://upload.wikimedia.org/wikipedia/commons/d/d1/A_Big_Tree_Cave_in_Northern_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Busia Mausoleum": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Busua Beach": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Solnedgang_p%C3%A5_Labadi_beach.jpg/1920px-Solnedgang_p%C3%A5_Labadi_beach.jpg",
    credit: "Wikimedia Commons",
  },
  "Butre Beach": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Solnedgang_p%C3%A5_Labadi_beach.jpg/1920px-Solnedgang_p%C3%A5_Labadi_beach.jpg",
    credit: "Wikimedia Commons",
  },
  "Buyuori Cave": {
    url: "https://upload.wikimedia.org/wikipedia/commons/d/d1/A_Big_Tree_Cave_in_Northern_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Cape Coast Castle": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Cape Three Points": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Mountain_Afadja.jpg/1920px-Mountain_Afadja.jpg",
    credit: "Wikimedia Commons",
  },
  "Chaiso Forest Reserve": {
    url: "https://upload.wikimedia.org/wikipedia/commons/8/8d/A_Green_Forest_Reserve_in_Northern_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  Chilinga: {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "Daboya Waterfall": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "Dambai Ferry and Oti River": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Vehicles_and_people_awaiting_the_arrival_of_the_ferry_to_travel_across_river_Oti_at_Dambai.jpg/1920px-Vehicles_and_people_awaiting_the_arrival_of_the_ferry_to_travel_across_river_Oti_at_Dambai.jpg",
    credit: "Wikimedia Commons",
  },
  "Digya National Park": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Dondoli Mosque": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Larabanga_Mosque_Ghana.jpg/1920px-Larabanga_Mosque_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Duasidan Monkey Sanctuary": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Dwenase Market": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Elmina Castle": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Elmina_Castle_-_Ghana.jpg/1920px-Elmina_Castle_-_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Fort Amsterdam": {
    url: "https://upload.wikimedia.org/wikipedia/commons/0/02/FortAmsterdamCormantine.JPG",
    credit: "Wikimedia Commons",
  },
  "Fort Batenstein, Butre": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Fort Metal Cross, Dixcove": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Fort Prinzenstein, Keta": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Fort San Sebastian, Shama": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Fort St. Jago": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Fuller Falls": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/FullerFall.jpg/1920px-FullerFall.jpg",
    credit: "Wikimedia Commons",
  },
  "Gambaga Escarpment": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5f/Gambaga_escarpment.jpg/1920px-Gambaga_escarpment.jpg",
    credit: "Wikimedia Commons",
  },
  "Gambaga Witch Camp": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/73/Gambaga_Witch_Camp.jpg/1920px-Gambaga_Witch_Camp.jpg",
    credit: "Wikimedia Commons",
  },
  "Gbelle Game Reserve": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Greenwich Meridian Point, Yendi": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/49/Greenwich_Meridian_Point_at_Krobo_Odumase%2C_Ghana.jpg/1920px-Greenwich_Meridian_Point_at_Krobo_Odumase%2C_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Gushegu Local Textile Centre": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Gwollu Slave Defence Wall": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/51/Ancient_Slave_Defence_Wall_Gwollu_Sissala_West.jpg/1920px-Ancient_Slave_Defence_Wall_Gwollu_Sissala_West.jpg",
    credit: "Wikimedia Commons",
  },
  "Hani Archaeological Site": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Hans Cottage Botel": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Ho and Asogli Cultural Route": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Independence Square and Black Star Gate": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Jaagbo Sacred Grove and Shrine": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Jamestown Lighthouse": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/James_town_2.jpg/1920px-James_town_2.jpg",
    credit: "Wikimedia Commons",
  },
  "Kakum National Park": {
    url: "https://upload.wikimedia.org/wikipedia/commons/1/16/Kakum.jpg",
    credit: "Wikimedia Commons",
  },
  "Kejetia Market": {
    url: "https://upload.wikimedia.org/wikipedia/commons/1/15/Kumasi.jpg",
    credit: "Wikimedia Commons",
  },
  "Keta Lagoon": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/42/Keta_Lagoon-1.jpg/1920px-Keta_Lagoon-1.jpg",
    credit: "Wikimedia Commons",
  },
  "Kintampo Waterfalls": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Kintempo_Water_Falls_II.jpg/1920px-Kintempo_Water_Falls_II.jpg",
    credit: "Wikimedia Commons",
  },
  "Koforidua Beads Market": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Koforidua_Township_and_Market_2.jpg/1920px-Koforidua_Township_and_Market_2.jpg",
    credit: "Wikimedia Commons",
  },
  "Kokrobite Beach": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Samvera_Summers.jpg/1920px-Samvera_Summers.jpg",
    credit: "Wikimedia Commons",
  },
  "Kpetoe Kente Weaving Village": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Krobo Beads Market": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Krokosue Forest Reserve": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "Kukuo Pottery Centre": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Kulmasa Crocodile Pond": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Kulungugu Bomb Site": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Kumasi Fort and Military Museum": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Ghana_Air_Force_Historic_Attack_Aircraft_and_Attack_Helicopter.jpg/1920px-Ghana_Air_Force_Historic_Attack_Aircraft_and_Attack_Helicopter.jpg",
    credit: "Wikimedia Commons",
  },
  "Kumasi Zoo": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Chimpazee_at_the_Kumasi_Zoo.jpg/1920px-Chimpazee_at_the_Kumasi_Zoo.jpg",
    credit: "Wikimedia Commons",
  },
  "Kute Waterfalls": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "Kwame Nkrumah Mausoleum": {
    url: "https://upload.wikimedia.org/wikipedia/commons/1/17/Kwame_Nkrumah_Memorial_Park.jpg",
    credit: "Wikimedia Commons",
  },
  "Kyabobo National Park": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Hiking_at_Kyabobo_National_Park.jpg/1920px-Hiking_at_Kyabobo_National_Park.jpg",
    credit: "Wikimedia Commons",
  },
  "Labadi Beach": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Solnedgang_p%C3%A5_Labadi_beach.jpg/1920px-Solnedgang_p%C3%A5_Labadi_beach.jpg",
    credit: "Wikimedia Commons",
  },
  "Lake Bosomtwe": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/83/Lake_Bosumtwi%2C_Ghana.jpg/1920px-Lake_Bosumtwi%2C_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Lake Volta and Dodi Island": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ef/Dodi_Island_Pier.jpg/1920px-Dodi_Island_Pier.jpg",
    credit: "Wikimedia Commons",
  },
  "Lake Volta at Kete Krachi": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1f/Lake_Volta_Ghana.jpg/1920px-Lake_Volta_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Larabanga Mosque": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Larabanga_Mosque_Ghana.jpg/1920px-Larabanga_Mosque_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Larabanga Mystic Stone": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/29/Larabanga_Mystic_Stone.jpg/1920px-Larabanga_Mystic_Stone.jpg",
    credit: "Wikimedia Commons",
  },
  "Legon Botanical Gardens": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Botanical_Garden_in_Legon.jpg/1920px-Botanical_Garden_in_Legon.jpg",
    credit: "Wikimedia Commons",
  },
  "Makango Water Safari": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Makola Market": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Makola_Market_Entrance%2C_Accra%2C_Ghana.JPG/1920px-Makola_Market_Entrance%2C_Accra%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Manhyia Palace Museum": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Mankessim Posuban Shrines": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Mim Buo": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Mountain_Afadja.jpg/1920px-Mountain_Afadja.jpg",
    credit: "Wikimedia Commons",
  },
  "Mim Lake": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f0/Mim_lake1.jpg/1920px-Mim_lake1.jpg",
    credit: "Wikimedia Commons",
  },
  "Mim Quarry Lake": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f0/Mim_lake1.jpg/1920px-Mim_lake1.jpg",
    credit: "Wikimedia Commons",
  },
  "Mognori Eco Village": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Mole National Park": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Mount Afadjato": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Mountain_Afadja.jpg/1920px-Mountain_Afadja.jpg",
    credit: "Wikimedia Commons",
  },
  "Mystery Hole": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "NaJeringa Historic Slave Wall": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "NaYiri Palace, Nalerigu": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/17/Nayiri_Palace_in_Nalerigu.jpg/1920px-Nayiri_Palace_in_Nalerigu.jpg",
    credit: "Wikimedia Commons",
  },
  "Naa Gbewaa Palace": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/86/Gbewaa_palace_in_Yendi.jpg/1920px-Gbewaa_palace_in_Yendi.jpg",
    credit: "Wikimedia Commons",
  },
  "Nakore Ancient Mosque": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c3/Nakore_Mosque%2C_Upper_West_Region%2C_Ghana_3.JPG/1920px-Nakore_Mosque%2C_Upper_West_Region%2C_Ghana_3.JPG",
    credit: "Wikimedia Commons",
  },
  "National Museum of Ghana": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Museum_Ground_floor_from_1st_floor.jpg/1920px-Museum_Ground_floor_from_1st_floor.jpg",
    credit: "Wikimedia Commons",
  },
  "National Theatre of Ghana": {
    url: "https://upload.wikimedia.org/wikipedia/commons/8/82/National_Theatre_of_Ghana_20060826.jpg",
    credit: "Wikimedia Commons",
  },
  "Navrongo Cathedral": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Larabanga_Mosque_Ghana.jpg/1920px-Larabanga_Mosque_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Nchiraa Waterfalls": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "Ntonso Adinkra Craft Village": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Nwoase Ostrich Farm": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Nzulezo Stilt Village": {
    url: "https://upload.wikimedia.org/wikipedia/commons/1/16/Nzulezo1.jpg",
    credit: "Wikimedia Commons",
  },
  "Okomfo Anokye Sword Site": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Okomfo Anokye Tree at Sankore": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Osu Castle (Christiansborg Castle)": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Osu_Castle_%28also_known_as_Fort_Christiansborg_or_Christiansborg_Castle%29_in_Accra%2C_Ghana.jpg/1920px-Osu_Castle_%28also_known_as_Fort_Christiansborg_or_Christiansborg_Castle%29_in_Accra%2C_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Owabi Wildlife Sanctuary": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Owabi_wildlife_sanctuary_16.jpg/1920px-Owabi_wildlife_sanctuary_16.jpg",
    credit: "Wikimedia Commons",
  },
  "Paga Crocodile Pond": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Friendly_Paga_Crocodile_I.jpg/1920px-Friendly_Paga_Crocodile_I.jpg",
    credit: "Wikimedia Commons",
  },
  "Paga-Nania Slave Camp": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Princess Town Beach": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Solnedgang_p%C3%A5_Labadi_beach.jpg/1920px-Solnedgang_p%C3%A5_Labadi_beach.jpg",
    credit: "Wikimedia Commons",
  },
  "Salaga Slave Well and Market": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Cape_Coast_Castle%2C_Cape_Coast%2C_Ghana.JPG",
    credit: "Wikimedia Commons",
  },
  "Sankana Caves": {
    url: "https://upload.wikimedia.org/wikipedia/commons/d/d1/A_Big_Tree_Cave_in_Northern_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Sefwi-Wiawso Traditional Palace": {
    url: "https://upload.wikimedia.org/wikipedia/commons/3/3a/Ashant_architecture.jpg",
    credit: "Wikimedia Commons",
  },
  "Shai Hills Resource Reserve": {
    url: "https://upload.wikimedia.org/wikipedia/commons/1/1b/Shai_Hills_Resource_Reserve.jpg",
    credit: "Wikimedia Commons",
  },
  "Shiare Hanging Village": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/The_isolated_village_of_Shiare.jpg/1920px-The_isolated_village_of_Shiare.jpg",
    credit: "Wikimedia Commons",
  },
  "Sirigu Art and Pottery Village": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Sonyo Eco-Village": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Tafi Atome Monkey Sanctuary": {
    url: "https://upload.wikimedia.org/wikipedia/commons/d/d8/Tafi_Atome_Monkey_Sanctuary.jpg",
    credit: "Wikimedia Commons",
  },
  "Tagbo Falls": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "Tamale Central Mosque": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/69/Tamale_Central_Mosque.jpg/1920px-Tamale_Central_Mosque.jpg",
    credit: "Wikimedia Commons",
  },
  "Tamale Craft Centre": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Tamale Zoological Garden": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Tano Boase Sacred Grove": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Techiman Market": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Tetteh Quarshie Cocoa Farm": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Tetteh_Quarshie_Cocao_Farm_-_One_of_the_original_trees%2C_planted_1879.JPG/1920px-Tetteh_Quarshie_Cocao_Farm_-_One_of_the_original_trees%2C_planted_1879.JPG",
    credit: "Wikimedia Commons",
  },
  "The Big Tree": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Big_Tree_with_spring_picnic.jpg/1920px-Big_Tree_with_spring_picnic.jpg",
    credit: "Wikimedia Commons",
  },
  "Tongo-Tenzug Shrine": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b8/A_shrine_at_Tongo_hills.jpg/1920px-A_shrine_at_Tongo_hills.jpg",
    credit: "Wikimedia Commons",
  },
  "Umbrella Rock": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Umbrella_rock%2C_Koforidua%2C_Ghana.jpg/1920px-Umbrella_rock%2C_Koforidua%2C_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Volta Lake and Adome Bridge": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Mountain_Afadja.jpg/1920px-Mountain_Afadja.jpg",
    credit: "Wikimedia Commons",
  },
  "W.E.B. Du Bois Memorial Centre": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Wa Central Market": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg/1920px-Manhyia_Palace_Museum_%28Kumasi%2C_Ghana_2017%29.jpg",
    credit: "Wikimedia Commons",
  },
  "Wa Naa's Palace": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/29/The_Palace_of_Wa_Naa%2C_Wa.jpg/1920px-The_Palace_of_Wa_Naa%2C_Wa.jpg",
    credit: "Wikimedia Commons",
  },
  "Wechiau Hippo Sanctuary": {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Elefant_Ghana.jpg/1920px-Elefant_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "White Volta and Red Volta Confluence": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  Winneba: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/University_of_Education%2C_Winneba_%28UEW%29_North_Campus.jpg/1920px-University_of_Education%2C_Winneba_%28UEW%29_North_Campus.jpg",
    credit: "Wikimedia Commons",
  },
  "Wli Waterfalls": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Wli_Lower_Fall-4.jpg",
    credit: "Wikimedia Commons",
  },
  "Wurobo Ancestral Caves": {
    url: "https://upload.wikimedia.org/wikipedia/commons/d/d1/A_Big_Tree_Cave_in_Northern_Ghana.jpg",
    credit: "Wikimedia Commons",
  },
  "Yapei and Buipe River Ports": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a3/Buipe_River.jpg/1920px-Buipe_River.jpg",
    credit: "Wikimedia Commons",
  },
  "Yendi Heritage Sites": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/86/Gbewaa_palace_in_Yendi.jpg/1920px-Gbewaa_palace_in_Yendi.jpg",
    credit: "Wikimedia Commons",
  },
  "Zayaa Mosque-Shrine, Wulugu": {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/49/Zayaa_Mud_Mosque.jpg/1920px-Zayaa_Mud_Mosque.jpg",
    credit: "Wikimedia Commons",
  },
};
