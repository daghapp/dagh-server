/**
 * Long-form historical background for every seeded tour site.
 *
 * Keyed by the unique `TourSite.name` so the seed can enrich both new and
 * existing rows without duplicating the catalogue definitions.
 */
export const siteHistories: Record<string, string> = {
  // ── Greater Accra ──────────────────────────────────────────────────
  "Kwame Nkrumah Mausoleum":
    "Opened in 1992, the mausoleum honours Kwame Nkrumah, leader of Ghana's independence movement and the country's first president. The site combines his tomb, a museum and a memorial park that has become a civic and Pan-African pilgrimage point.",
  "Labadi Beach":
    "Labadi has served as Accra's best-known leisure beach since the colonial era, when it was a favoured coastal retreat. Today it hosts Homowo-related festivities and weekend concerts that blend Ga tradition with modern city life.",
  "Shai Hills Resource Reserve":
    "The reserve protects the rocky Shai hills, once the homeland of the Shai people before their displacement in the nineteenth century. Its caves and rock shelters hold traces of that settlement history alongside the wildlife that now draws visitors.",
  "Independence Square and Black Star Gate":
    "Built to mark Ghana's independence in 1957, the square centres on the Black Star Gate and the Independence Arch. It has hosted state ceremonies, military parades and national celebrations ever since.",
  "National Museum of Ghana":
    "Established in 1957, the National Museum of Ghana was opened as part of the country's independence-era cultural programme. Its collections bring together archaeology, ethnography and modern Ghanaian art.",
  "Osu Castle (Christiansborg Castle)":
    "Originally a sixteenth-century Portuguese trading fort, Christiansborg passed through Danish, British and Ghanaian hands. It served as the seat of government until the administration moved to Jubilee House and remains a symbol of the coastal trade era.",
  "Jamestown Lighthouse":
    "The lighthouse stands above Jamestown, one of Accra's oldest Ga communities and a former colonial harbour. The surrounding district retains fishing fleets, historic warehouses and the annual Homowo celebrations.",
  "Makola Market":
    "Makola grew into Accra's principal market in the early twentieth century, supplying the city with food, cloth and imported goods. It remains a majority-women trading hub and a barometer of the local economy.",
  "National Theatre of Ghana":
    "Completed in 1992, the National Theatre was designed as a showcase for Ghanaian performing arts. Its distinctive architecture and programme of theatre, dance and music made it a landmark of the city's cultural revival.",
  "Legon Botanical Gardens":
    "The gardens were laid out around the University of Ghana's Legon campus and developed for conservation, research and recreation. Recent additions such as canopy walks have turned them into a popular city escape.",
  "Ada Foah":
    "Ada Foah grew as a trading settlement at the mouth of the Volta, where river and ocean traffic met. Its estuary, beaches and birdlife now support tourism alongside the area's salt and fishing economy.",
  "Bojo Beach":
    "Bojo's long sandbar is separated from the mainland by the Densu River, giving it a secluded character. The crossing by boat and the surrounding wetlands have made it a favourite Accra day-trip destination.",
  "Kokrobite Beach":
    "A fishing village turned beach destination, Kokrobite became known in the 1980s for its drumming school and relaxed arts scene. It continues to attract surfers, musicians and weekend visitors from Accra.",
  "W.E.B. Du Bois Memorial Centre":
    "The centre occupies the Accra home where W.E.B. Du Bois spent his final years working on the Encyclopedia Africana. It preserves his library, personal effects and the Pan-African legacy he brought to Ghana.",

  // ── Central ────────────────────────────────────────────────────────
  "Cape Coast Castle":
    "Begun by the Swedes in 1653 and later expanded by the British, Cape Coast Castle was a major hub of the transatlantic slave trade. It is now a UNESCO World Heritage Site and a memorial to the people who passed through its dungeons.",
  "Elmina Castle":
    "Built by the Portuguese in 1482 as São Jorge da Mina, Elmina is the oldest European building in sub-Saharan Africa. It changed hands several times and became central to the gold and slave trades before becoming a heritage site.",
  "Kakum National Park":
    "Kakum was established as a forest reserve in 1931 and became a national park in 1992. Its canopy walkway, opened in the 1990s, helped make it one of Ghana's most visited nature attractions.",
  "Fort St. Jago":
    "The Portuguese built St. Jago on a hill above Elmina in 1555 to guard the castle below. The small fort later served Dutch and British garrisons and remains part of the Elmina World Heritage landscape.",
  "Assin Manso Slave River Site":
    "Assin Manso was a major inland market where enslaved people were gathered before the march to the coast. The Donkor Nsuo, or Last Bath, is remembered as the place where captives were washed before their final journey.",
  "Assin Praso Heritage Site":
    "Assin Praso stood at a crossing of the Pra River on the slave route from the interior to Cape Coast. Memorials and archaeological traces recall the forced marches and the local communities caught up in the trade.",
  "Ajumako Craft Village":
    "The craft village developed as a cooperative for artisans in the Ajumako area, preserving local pottery, weaving and woodwork. It gives visitors a working view of techniques passed down through generations.",
  Winneba:
    "Winneba is an old Fante coastal town with a strong tradition of fishing, music and masquerade festivals. Its Effutu people celebrate the Aboakyer deer-hunting festival, one of Ghana's best-known cultural events.",
  "Fort Amsterdam":
    "Fort Amsterdam was built by the English at Abandze in the seventeenth century and later taken by the Dutch. It formed part of the chain of coastal forts that regulated trade and the movement of enslaved people.",
  "Brenu Akyinim Beach":
    "Brenu Akyinim is a quiet stretch of coast between Cape Coast and Elmina, backed by palms and fishing hamlets. It has long been a local bathing spot and is now promoted for low-key coastal tourism.",
  "Hans Cottage Botel":
    "Hans Cottage began as a small lakeside rest stop and grew around a crocodile pond and bird sanctuary. Its over-water restaurant and wildlife displays made it a familiar stop on the Cape Coast road.",
  "Mankessim Posuban Shrines":
    "Mankessim is the traditional capital of the Fante and the seat of the Omanhene. Its posuban shrines, built as military and religious posts, are celebrated for their colourful figurative sculpture.",

  // ── Western ────────────────────────────────────────────────────────
  "Busua Beach":
    "Busua grew as a fishing village and became one of Ghana's earliest surf and beach destinations. Its sheltered bay, surf schools and nearby Dixcove fort make it a base for exploring the western coast.",
  "Nzulezo Stilt Village":
    "Nzulezo is a community built on stilts over Lake Tadane by people who, according to tradition, migrated from the north. It has survived for centuries on fishing, farming and trade and is reached only by canoe.",
  "Ankasa Conservation Area":
    "Ankasa protects one of the last tracts of Ghana's primary rainforest, with species found nowhere else in the country. It was established as a resource reserve and now supports research, birding and guided forest walks.",
  "Princess Town Beach":
    "Princes Town, formerly Gross Friedrichsburg, was a Brandenburg-Prussian trading post in the seventeenth century. Its beach and nearby fort recall a less-visited chapter of Ghana's coastal history.",
  "Fort Metal Cross, Dixcove":
    "Built by the British at Dixcove in the 1690s, Fort Metal Cross guarded the coastal trade and changed hands during European conflicts. It overlooks the harbour that still supports a fishing fleet.",
  "Fort Batenstein, Butre":
    "Fort Batenstein was built by the Dutch at Butre in the seventeenth century on a hill above the bay. It witnessed the 1656 treaty between the Dutch and the Ahanta, an early example of coastal diplomacy.",
  "Axim and Fort Santo Antonio":
    "Axim was an early Portuguese trading settlement, and Fort Santo Antonio was begun in 1515. The town remained an important coastal port and the fort later passed to the Dutch and British.",
  "Fort San Sebastian, Shama":
    "The Portuguese built Fort San Sebastian at Shama in the 1520s, making it one of the oldest forts in Ghana. It later served the Dutch and British and stands near the mouth of the Pra River.",
  "Cape Three Points":
    "Cape Three Points is the southernmost point of Ghana, where the coastline turns toward the Gulf of Guinea. Its lighthouse and rainforest-backed beaches mark a dramatic meeting of forest and ocean.",
  "Butre Beach":
    "Butre is a small fishing village beneath Fort Batenstein, with a beach used by canoes and local traders. The surrounding hills and estuary make it a quiet stop on the western coastal route.",
  "Amansuri Wetland":
    "The Amansuri wetland is a Ramsar site of lagoons, swamps and raffia palm forest near Nzulezo. It supports rich birdlife and the canoe routes that link the stilt village to the coast.",

  // ── Western North ──────────────────────────────────────────────────
  "Bia National Park":
    "Bia National Park protects part of the Bia Conservation Area, a rainforest known for primates and forest elephants. It was established in the 1970s and is used for research, conservation and guided walks.",
  "Bia Biosphere Reserve":
    "The Bia Biosphere Reserve combines national park and resource reserve land in the forest belt near the Ivorian border. UNESCO recognition has supported efforts to balance conservation with cocoa farming and local livelihoods.",
  "Bonsai Waterfalls":
    "Bonsai Falls in the Juaboso-Bia district is one of Western North's best-known natural attractions. The surrounding forest and cocoa farms support a small local tourism economy.",
  "Mystery Hole":
    "The Mystery Hole is a natural feature in the Sefwi forest belt surrounded by local folklore. Its origins and depth have long puzzled residents and visitors.",
  "Ankobra River":
    "The Ankobra rises in the northern forest and flows to the coast near Axim, long serving as a route for trade and fishing. Its basin includes some of Ghana's most important gold and cocoa landscapes.",
  "Bia River Landscape":
    "The Bia River drains the forested borderlands of Western North and feeds the Bia conservation area. Its banks support farming communities and important wildlife corridors.",
  "Sefwi-Wiawso Traditional Palace":
    "The palace is the ceremonial seat of the Omanhene of the Sefwi-Wiawso Traditional Area. It remains central to festivals, chieftaincy and the preservation of Sefwi identity.",
  "Dwenase Market":
    "Dwenase Market is the main trading centre of the Sefwi-Wiawso conurbation. It handles produce, cloth and household goods from the surrounding cocoa and food-crop districts.",
  "Krokosue Forest Reserve":
    "Krokosue is a forest reserve in the Sefwi hills managed for timber, water and biodiversity. Its trails and streams offer a quiet introduction to the region's forest ecology.",

  // ── Volta ──────────────────────────────────────────────────────────
  "Wli Waterfalls":
    "Wli Falls drops about 80 metres from the Agumatsa escarpment and is among the highest in West Africa. The surrounding sanctuary protects bats, birds and monkeys and is managed with the local community.",
  "Mount Afadjato":
    "At 885 metres, Afadjato is Ghana's highest mountain and a popular day hike from the Wli area. The trail passes through farmland and forest with views toward Togo.",
  "Tafi Atome Monkey Sanctuary":
    "Tafi Atome's sacred grove has long protected a troop of Mona monkeys. Community-managed tourism now lets visitors feed the monkeys and supports local conservation.",
  "Amedzofe Village":
    "Amedzofe is a highland Avatime village known for its cool climate and views from Mount Gemi. Missionary and colonial history are visible in its old church and stone buildings.",
  "Tagbo Falls":
    "Tagbo Falls lies in the forest near Liata and is reached on foot from Amedzofe. The trail passes through cocoa farms and remnant forest before the falls.",
  "Kpetoe Kente Weaving Village":
    "Kpetoe is an Ewe weaving town near the Togo border, known for brightly coloured kente. Weaving remains a family craft and a key part of the local economy.",
  "Ho and Asogli Cultural Route":
    "Ho is the capital of the Volta Region and seat of the Asogli traditional state. The route links palaces, shrines and festival grounds that tell the story of Ewe settlement and governance.",
  "Volta Lake and Adome Bridge":
    "The Adome Bridge carries the Accra–Ho road across the Volta near the river's lower reaches. The surrounding lake and wetlands support fishing and riverside trade.",
  "Fort Prinzenstein, Keta":
    "Fort Prinzenstein was built by the Danes at Keta in 1784 and later passed to the British. Coastal erosion has damaged the fort, but its dungeons and history remain a powerful memorial.",
  "Keta Lagoon":
    "Keta Lagoon is Ghana's largest lagoon and a Ramsar wetland. It supports fishing, salt production and large populations of migratory and resident birds.",
  "Amedzofe Canopy Walk":
    "The canopy walk near Amedzofe gives visitors a view over the Avatime hills and forest. It was developed to add an adventure experience to the village's ecotourism offerings.",

  // ── Oti ────────────────────────────────────────────────────────────
  "Kyabobo National Park":
    "Kyabobo was established in 1997 on the Togo border and covers about 220 square kilometres of mountain savanna and forest. It protects elephants, primates and Mount Dzebobo, Ghana's second-highest peak.",
  "Lake Volta at Kete Krachi":
    "Kete Krachi sits on the shores of Lake Volta and is one of the region's oldest ferry crossings. The lake brought new trade routes and displaced communities when it was formed in the 1960s.",
  "Breast Mountain":
    "The Breast Mountains are twin hills in Kyabobo whose shape gives them their name. The summit viewpoint is a local landmark and a hiking destination.",
  Chilinga:
    "Chilinga is a scenic area of hills, valleys and forest in the Oti Region. Its landscape is part of the region's emerging eco-tourism offering.",
  "Chaiso Forest Reserve":
    "Chaiso is a protected forest reserve in the Oti hills. It shelters birds, butterflies and forest plants and is used for guided nature walks.",
  "Shiare Hanging Village":
    "Shiare is an Akyode settlement of rock-and-clay houses built into the Breast Mountains. Oral tradition traces its founding back roughly nine centuries.",
  "Dambai Ferry and Oti River":
    "Dambai is the capital of Oti and a crossing point on the Oti River arm of Lake Volta. The ferry links communities and gives travellers a working view of the river economy.",
  "Kute Waterfalls":
    "Kute Falls is a forest waterfall in the Jasikan area of Oti. It is one of several cascades promoted as the region opens up to tourism.",

  // ── Eastern ────────────────────────────────────────────────────────
  "Aburi Botanical Gardens":
    "Aburi Gardens were established in 1890 as a colonial botanical station in the Akuapem hills. Their cool climate and plant collections made them a retreat from Accra and a centre for crop research.",
  "Boti Falls":
    "Boti Falls is a twin waterfall in the Yilo Krobo hills, with the two streams merging in the rainy season. The surrounding forest and nearby Umbrella Rock make it a popular day trip.",
  "Akosombo Dam":
    "The Akosombo Dam was completed in 1965 and created Lake Volta, then the world's largest man-made lake by surface area. It remains Ghana's main source of hydroelectric power.",
  "Krobo Beads Market":
    "Krobo beads are made from recycled glass by artisans in the Yilo and Manya Krobo districts. The market at Krobo Odumase showcases a craft tradition that reaches back centuries.",
  "Akaa Falls":
    "Akaa Falls lies near Amanase in the Eastern Region, reached by a forest trail. Its plunge pool and surrounding vegetation make it a popular hike from Accra.",
  "Umbrella Rock":
    "Umbrella Rock is a natural formation near Boti whose overhanging top resembles an umbrella. It offers views over the Krobo hills and is usually visited with Boti Falls.",
  "Bunso Arboretum":
    "Bunso Arboretum was established as a botanical and conservation site in the eastern forest belt. Its canopy walkway and tree collection have made it a roadside attraction on the Accra–Kumasi route.",
  "The Big Tree":
    "The Big Tree is a giant forest tree in Ghana's eastern forest belt that became a roadside landmark. Its size and age reflect the original rainforest that once covered the region.",
  "Lake Volta and Dodi Island":
    "Dodi Island lies in Lake Volta near Akosombo and is reached by boat from the dam area. The island's beaches and fishing communities offer a different view of the lake.",
  "Koforidua Beads Market":
    "Koforidua's bead market brings together makers and traders from the New Juaben area. The beads are made from glass, recycled materials and imported stones in a wide range of designs.",
  "Tetteh Quarshie Cocoa Farm":
    "Tetteh Quarshie brought cocoa seedlings from Fernando Po in the 1870s and planted them at Mampong-Akuapem. The farm is regarded as the birthplace of Ghana's cocoa industry.",

  // ── Ashanti ────────────────────────────────────────────────────────
  "Manhyia Palace Museum":
    "Manhyia Palace is the seat of the Asantehene and the centre of Asante royal authority. The museum, opened in the former palace, displays regalia, photographs and objects from the kingdom's history.",
  "Kejetia Market":
    "Kejetia is one of West Africa's largest open-air markets, trading food, cloth, crafts and household goods. It grew around Kumasi's central transport hub and remains a major economic engine.",
  "Lake Bosomtwe":
    "Lake Bosomtwe formed in a meteorite impact crater and is Ghana's only natural lake. It is sacred in Asante tradition and supports fishing and lakeside communities.",
  "Okomfo Anokye Sword Site":
    "The sword is said to have been planted by Okomfo Anokye, the priest who helped found the Asante Kingdom. It remains at the spot in Kumasi and is a powerful symbol of Asante origin.",
  "Bonwire Kente Weaving Village":
    "Bonwire is traditionally regarded as the home of kente, the woven cloth associated with Asante royalty. Weavers still use narrow looms to produce the patterns that made the town famous.",
  "Ntonso Adinkra Craft Village":
    "Ntonso is known for adinkra cloth, printed with symbols stamped from carved calabash. The craft is linked to mourning and royal traditions and remains a living local industry.",
  "Bobiri Forest Reserve":
    "Bobiri protects a patch of rainforest and is known for its butterfly population. The reserve supports research and environmental education and is a short drive from Kumasi.",
  "Owabi Wildlife Sanctuary":
    "Owabi surrounds the reservoir that supplies Kumasi with water and protects forest and wetland habitat. It is home to monkeys, antelopes and a variety of birds.",
  "Bomfobiri Wildlife Sanctuary":
    "Bomfobiri is a hilly forest reserve with waterfalls, caves and hiking trails. It is one of the less-visited nature reserves in Ashanti.",
  "Kumasi Fort and Military Museum":
    "The fort was built in the nineteenth century and later used by the British after the Asante wars. It now houses a military museum with weapons, uniforms and historical exhibits.",
  "Asante Traditional Buildings":
    "The Asante Traditional Buildings are surviving courtyard houses with decorated walls, listed by UNESCO in 1980. They represent the architectural tradition of the Asante kingdom.",
  "Kumasi Zoo":
    "Kumasi Zoo was established in the colonial period and has long been a centre for wildlife display and education. It houses lions, primates, reptiles and other animals.",

  // ── Bono ───────────────────────────────────────────────────────────
  "Bui National Park":
    "Bui National Park was gazetted in 1971 and covers savanna and forest along the Black Volta. It is known for hippos, antelopes and boat safaris.",
  "Bui Dam":
    "The Bui Dam was completed in 2013 on the Black Volta at the edge of Bui National Park. It added significant hydroelectric capacity and created a reservoir that changed the local landscape.",
  "Nchiraa Waterfalls":
    "Nchiraa Falls lies north of Wenchi and is reached by a rocky forest hike. The nearby Wurobo caves are part of the same local heritage landscape.",
  "Wurobo Ancestral Caves":
    "The Wurobo caves are believed to have sheltered the ancestors of the Nchiraa people. They remain a cultural site and a stop for visitors exploring the waterfalls.",
  "Duasidan Monkey Sanctuary":
    "Duasidan's community sanctuary protects Mona monkeys in a bamboo forest southwest of Dormaa Ahenkro. Visitors can watch the monkeys feed and move through the canopy.",
  "Hani Archaeological Site":
    "Hani is an archaeological site near Wenchi linked to the ancient Begho trading civilisation. Excavations have revealed relics from centuries of settlement and regional trade.",
  "Busia Mausoleum":
    "The mausoleum commemorates Kofi Abrefa Busia, Prime Minister of Ghana's Second Republic. It displays personal items and documents from his political career.",
  "Nwoase Ostrich Farm":
    "Nwoase Ostrich Farm near Wenchi keeps ostriches for visitors and commercial purposes. It is one of the few places in Ghana to see the world's largest bird up close.",
  "Asukese Forest Reserve":
    "Asukese Forest Reserve lies southwest of Sunyani and protects timber species and forest wildlife. It is managed for conservation, research and limited community use.",

  // ── Bono East ──────────────────────────────────────────────────────
  "Kintampo Waterfalls":
    "Kintampo Falls drops in several tiers near the geographical centre of Ghana. The surrounding forest and plunge pools make it one of the country's most popular waterfall stops.",
  "Fuller Falls":
    "Fuller Falls is a smaller waterfall near Kintampo, often visited together with the main falls. The forest walk and pools offer a quieter alternative.",
  "Buabeng-Fiema Monkey Sanctuary":
    "Buabeng-Fiema is a community forest where Mona and colobus monkeys live close to the village. Local tradition protects the monkeys and supports a long-running ecotourism project.",
  "Buoyem Caves and Bats Colony":
    "The Buoyem caves shelter a large colony of bats and are set among rocky hills near Techiman. They are visited for their wildlife and views.",
  "Bono Manso Slave Centre":
    "Bono Manso was an important trading town connected to both trans-Saharan and Atlantic commerce. The heritage centre remembers its role in the slave trade and the history of the Bono people.",
  "Tano Boase Sacred Grove":
    "The Tano Boase grove is a sacred forest near Tanoboase, preserved by local religious tradition. Its tall trees and shrine are central to the area's cultural identity.",
  "Digya National Park":
    "Digya was gazetted in 1971 and is Ghana's oldest national park. It lies on the western shore of Lake Volta and protects savanna woodland, elephants and primates.",
  "Techiman Market":
    "Techiman is one of Ghana's largest weekly markets and a major hub for yams, grains and livestock. Its central location makes it a meeting point for traders from across the middle belt.",

  // ── Ahafo ──────────────────────────────────────────────────────────
  "Mim Buo":
    "Mim Buo is a group of three rocky peaks rising above the town of Mim. Oral tradition links the tallest peak to the first chief of Mim and the site is being developed for tourism.",
  "Mim Lake":
    "Mim Lake is a small inland lake used by the local community for fishing and recreation. It sits in the cocoa and forest landscape around Mim.",
  "Asumura White-Necked Rockfowl Conservation":
    "The Asumura forest near Akrodie protects the white-necked rockfowl, a rare bird highly sought by birders. The site is managed as a community conservation area.",
  "Okomfo Anokye Tree at Sankore":
    "The tree at Sankore is linked in local tradition to Okomfo Anokye, the famous Asante priest. It remains a cultural landmark and a place of local memory.",
  "Bonsam Bepo Forest Reserve":
    "Bonsam Bepo is a forest reserve in southern Ahafo with dense canopy and streams. It supports forest wildlife and is used for nature walks.",
  "Mim Quarry Lake":
    "Mim Quarry Lake formed in an abandoned quarry and is known for its striking colour. It has become a local scenic spot in the Mim area.",

  // ── Savannah ───────────────────────────────────────────────────────
  "Mole National Park":
    "Mole was gazetted in 1971 and is Ghana's largest wildlife refuge. It protects savanna woodland and elephants, antelopes, baboons and hundreds of bird species.",
  "Larabanga Mosque":
    "Larabanga Mosque is one of the oldest mosques in West Africa, built in Sudanese style and traditionally dated to 1421. It is a pilgrimage site and a national monument.",
  "Larabanga Mystic Stone":
    "The Mystic Stone stands beside the Larabanga Mosque and is linked to the town's founding legend. Local tradition holds that attempts to move it failed, making it sacred.",
  "Mognori Eco Village":
    "Mognori is a community near Mole that runs eco-tourism activities for visitors. Guided walks, farming demonstrations and shea butter making give insight into savanna life.",
  "Kulmasa Crocodile Pond":
    "Kulmasa's sacred pond is home to crocodiles protected by local tradition. Visitors can view them with guides and learn about the beliefs that keep the pond safe.",
  "Sonyo Eco-Village":
    "Sonyo is a community tourism village in the savanna near Mole. It offers cultural walks, traditional crafts and a chance to stay overnight in a village setting.",
  "Salaga Slave Well and Market":
    "Salaga was a major market town in the eighteenth and nineteenth centuries, connected to the northern slave trade. The slave well and old market site are preserved as historical monuments.",
  "Daboya Waterfall":
    "Daboya Falls lies near the historic salt-making town of Daboya. The town is also known for indigo dyeing and its long connection to the Volta trade routes.",
  "Makango Water Safari":
    "Makango is a riverside community on the Volta where boat safaris explore the river and its birdlife. Fishing and river trade remain central to local life.",
  "Yapei and Buipe River Ports":
    "Yapei and Buipe are working ports on the Volta, handling goods, ferries and fishing boats. They connect the savanna hinterland to the lake and southern markets.",

  // ── Northern ───────────────────────────────────────────────────────
  "Tamale Central Mosque":
    "Tamale Central Mosque is the largest mosque in Ghana and a landmark of the city. Its architecture and central location make it a focus of Islamic life in the north.",
  "Greenwich Meridian Point, Yendi":
    "The Greenwich Meridian crosses Ghana near Yendi, marked as a geographic point of interest. The site celebrates the country's position on the zero-degree line.",
  "Tamale Zoological Garden":
    "Tamale Zoo displays savanna wildlife, primates and reptiles for education and recreation. It is a long-standing family attraction in the city.",
  "Tamale Craft Centre":
    "The craft centre brings together artisans from across the north. Baskets, leatherwork, smocks and metal goods reflect the region's diverse craft traditions.",
  "Kukuo Pottery Centre":
    "Kukuo is a pottery village near Tamale where women make earthenware by hand. The craft supplies local households and has become a cultural tourism stop.",
  "Gushegu Local Textile Centre":
    "Gushegu is known for hand-woven textiles and smocks in the northern tradition. The centre supports local weavers and sells their work.",
  "Jaagbo Sacred Grove and Shrine":
    "Jaagbo is a sacred grove near Tolon protected by local belief. Its tall trees and shrines are important to the area's traditional religion.",
  "Yendi Heritage Sites":
    "Yendi is the capital of the Dagbon kingdom and home to sites tied to its history. Palaces, shrines and festival grounds tell the story of the Ya-Na and the Dagomba people.",
  "Naa Gbewaa Palace":
    "The palace is the seat of the Ya-Na, overlord of Dagbon, in Yendi. It is a ceremonial and political centre for the Dagomba and a symbol of the kingdom's continuity.",

  // ── North East ─────────────────────────────────────────────────────
  "Gambaga Escarpment":
    "The Gambaga Escarpment is a long rocky ridge that shapes the North East landscape. Its cliffs and viewpoints are among the region's most distinctive natural features.",
  "White Volta and Red Volta Confluence":
    "The White and Red Volta rivers meet in the North East, forming an important waterway and wetland habitat. The confluence supports fishing and birdlife.",
  "NaYiri Palace, Nalerigu":
    "The NaYiri Palace at Nalerigu is the seat of the Nayiri, paramount chief of Mamprugu. It is a centre of traditional governance and the Mamprugu cultural heritage.",
  "NaJeringa Historic Slave Wall":
    "The wall at Nalerigu is a remnant of defences linked to the era of slave raiding in the northern savanna. It is preserved as a historical site.",
  "Ancient Rock Art at Gingana":
    "The rock art at Gingana includes paintings and engravings attributed to early inhabitants of the area. The site is among the oldest artistic records in Ghana.",
  "Zayaa Mosque-Shrine, Wulugu":
    "The Zayaa mosque and shrine at Wulugu are associated with early Islamic scholarship in the north. The Sudanese-style building is a local religious landmark.",
  "Buyuori Cave":
    "Buyuori is a natural cave in the rocky North East landscape. It has served as shelter and a sacred site and is now visited for its geology and history.",
  "Ancient Koma Figurines, Yikpabongo":
    "The Koma figurines were unearthed near Yikpabongo and date back centuries. They are among the most important archaeological finds in northern Ghana.",
  "Gambaga Witch Camp":
    "The camp near Gambaga has sheltered women accused of witchcraft for decades. It is a complex cultural and social site that reflects beliefs about accusation and protection.",

  // ── Upper East ─────────────────────────────────────────────────────
  "Paga Crocodile Pond":
    "Paga's sacred pond is home to crocodiles regarded as ancestral spirits by the local community. Visitors can view and touch the crocodiles with guides in a long-standing cultural practice.",
  "Bolgatanga Market":
    "Bolgatanga Market is the main trading centre of the Upper East and is famous for baskets, leather and crafts. It draws buyers and sellers from across the region and beyond.",
  "Tongo-Tenzug Shrine":
    "The Tengzug shrine sits among the rocky Tongo Hills and is central to Talensi traditional religion. The climb to the shrine offers views over the surrounding savanna.",
  "Sirigu Art and Pottery Village":
    "Sirigu is known for women-led pottery, wall painting and basketry. The community's art centres have become an important source of income and cultural pride.",
  "Bolgatanga Museum":
    "The museum preserves artefacts and history from across the Upper East Region. Its collections include basketry, archaeology and ethnographic objects.",
  "Navrongo Cathedral":
    "Our Lady of Seven Sorrows Cathedral was built in the early twentieth century by the White Fathers. Its architecture blends European and local building traditions.",
  "Paga-Nania Slave Camp":
    "The Nania camp near Paga was a transit point in the slave trade. Rock carvings, grinding stones and oral history preserve the memory of those held there.",
  "Kulungugu Bomb Site":
    "The Kulungugu site marks the 1962 bomb attack on Kwame Nkrumah's convoy. It is remembered as a turning point in Ghana's early post-independence politics.",

  // ── Upper West ─────────────────────────────────────────────────────
  "Wechiau Hippo Sanctuary":
    "The Wechiau sanctuary protects hippos along a stretch of the Black Volta. It is run with the local community and offers river safaris and riverside camps.",
  "Gwollu Slave Defence Wall":
    "The wall at Gwollu was built in the nineteenth century to defend the town against slave raiders. It is one of the few surviving examples of such defences in northern Ghana.",
  "Nakore Ancient Mosque":
    "Nakore Mosque is a Sudanese-style mud-and-timber mosque believed to date from the seventeenth century. It is still used by the local Muslim community.",
  "Wa Naa's Palace":
    "The palace is the traditional seat of the Wa Naa, ruler of the Wala people. It is a centre of chieftaincy and culture in the Upper West capital.",
  "Gbelle Game Reserve":
    "Gbelle protects savanna woodland west of Wa and is known for roan antelope and birdlife. It is managed for conservation and wildlife viewing.",
  "Dondoli Mosque":
    "Dondoli Mosque is a historic Sudanese-style mosque near Wa. Its timber-framed mud walls are characteristic of the region's Islamic architecture.",
  "Bulenga Caves":
    "The Bulenga caves are natural rock shelters in the Upper West savanna. They are visited for their geology and local history.",
  "Sankana Caves":
    "The Sankana caves are linked to resistance against slave raiders in the nineteenth century. They remain a site of local memory and historical interest.",
  "Wa Central Market":
    "Wa Central Market is the main trading hub of the Upper West. It sells shea butter, grains, cloth and crafts from across the region.",
};

/** Returns the curated history for a site, if one has been written. */
export function getSiteHistory(name: string): string | undefined {
  return siteHistories[name];
}
