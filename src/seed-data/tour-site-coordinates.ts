/**
 * Precise coordinates for catalogue sites whose seed entries used a shared
 * town-level point. Keeping the fixes in one map makes them reviewable and lets
 * the production sync repair existing rows without overwriting unrelated admin
 * edits. Coordinates come from OpenStreetMap/Wikidata/Wikivoyage lookups.
 */
export const siteCoordinateOverrides: Record<string, { latitude: number; longitude: number }> = {
  "Kumasi Fort and Military Museum": { latitude: 6.6914241, longitude: -1.6249476 },
  "Kumasi Zoo": { latitude: 6.7015184, longitude: -1.62605 },
  "Manhyia Palace Museum": { latitude: 6.7041635, longitude: -1.6159392 },
  "Okomfo Anokye Sword Site": { latitude: 6.6964165, longitude: -1.6290179 },
  "Elmina Castle": { latitude: 5.0827429, longitude: -1.3482357 },
  "Fort St. Jago": { latitude: 5.0848153, longitude: -1.3508077 },
  "Gambaga Escarpment": { latitude: 10.5415, longitude: -0.46 },
  "Gambaga Witch Camp": { latitude: 10.53056, longitude: -0.44222 },
  "NaJeringa Historic Slave Wall": { latitude: 10.5296445, longitude: -0.3831888 },
  "NaYiri Palace, Nalerigu": { latitude: 10.5274033, longitude: -0.3693844 },
  "Greenwich Meridian Point, Yendi": { latitude: 9.452, longitude: -0.006 },
  "Naa Gbewaa Palace": { latitude: 9.4429742, longitude: -0.0014311 },
  "Tamale Central Mosque": { latitude: 9.4018009, longitude: -0.8411022 },
  "Tamale Zoological Garden": { latitude: 9.4115538, longitude: -0.8084766 },
  "Yendi Heritage Sites": { latitude: 9.446, longitude: -0.024 },
  "Larabanga Mosque": { latitude: 9.2203179, longitude: -1.8599446 },
  "Larabanga Mystic Stone": { latitude: 9.2206087, longitude: -1.8650182 },
  "Bolgatanga Market": { latitude: 10.7843582, longitude: -0.850617 },
  "Bolgatanga Museum": { latitude: 10.7943141, longitude: -0.8560174 },
  "Wa Central Market": { latitude: 10.0632627, longitude: -2.5056949 },
  "Wa Naa's Palace": { latitude: 10.0645548, longitude: -2.505548 },
  "Amedzofe Canopy Walk": { latitude: 6.84535, longitude: 0.43616 },
  "Amedzofe Village": { latitude: 6.8473866, longitude: 0.435497 },
  "Butre Beach": { latitude: 4.8215, longitude: -1.9185 },
  "Fort Batenstein, Butre": { latitude: 4.824286, longitude: -1.917229 },
  "Dwenase Market": { latitude: 6.2205855, longitude: -2.4827175 },
  "Sefwi-Wiawso Traditional Palace": { latitude: 6.2068281, longitude: -2.485365 },
};
