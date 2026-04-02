// src/lib/ghanaLocations.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Ghana Administrative Locations — All 16 Regions
//  Covers: Regions → Cities/Districts → Towns/Areas
//  Last updated: 2025
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════ TYPES ═══════════════════════════════════════

export type Area = {
  id: string;
  name: string;
  slug: string;
};

export type City = {
  id: string;
  name: string;
  slug: string;
  regionId: string; // FK → Region.id
  areas: Area[];
};

export type Region = {
  id: string;
  name: string;
  slug: string;
  capital: string;
  cities: City[];
};

export type GhanaLocations = {
  regions: Region[];
};

// ══════════════════════════ SEARCH / VALIDATE RETURN TYPES ═══════════════════

export type SearchResult =
  | { type: "region"; region: string; regionSlug: string }
  | { type: "city"; city: string; citySlug: string; region: string; regionSlug: string }
  | { type: "area"; area: string; areaSlug: string; city: string; citySlug: string; region: string; regionSlug: string };

export type ValidationResult =
  | { valid: false; message: string }
  | { valid: true; data: { region: string; regionSlug: string; city: string; citySlug: string; area: string; areaSlug: string } };

export type LocationPath = {
  region: { id: string; name: string; slug: string };
  city: { id: string; name: string; slug: string };
  area: { id: string; name: string; slug: string };
};

// ═══════════════════════════════ DATA ════════════════════════════════════════

export const ghanaLocations: GhanaLocations = {
  regions: [
    // ── 1. GREATER ACCRA ──────────────────────────────────────────────────
    {
      id: "greater-accra",
      name: "Greater Accra Region",
      slug: "greater-accra",
      capital: "Accra",
      cities: [
        {
          id: "accra",
          name: "Accra",
          slug: "accra",
          regionId: "greater-accra",
          areas: [
            { id: "airport-residential", name: "Airport Residential", slug: "airport-residential" },
            { id: "cantonments", name: "Cantonments", slug: "cantonments" },
            { id: "dzorwulu", name: "Dzorwulu", slug: "dzorwulu" },
            { id: "east-legon", name: "East Legon", slug: "east-legon" },
            { id: "east-legon-hills", name: "East Legon Hills", slug: "east-legon-hills" },
            { id: "haatso", name: "Haatso", slug: "haatso" },
            { id: "kanda", name: "Kanda", slug: "kanda" },
            { id: "kokomlemle", name: "Kokomlemle", slug: "kokomlemle" },
            { id: "labone", name: "Labone", slug: "labone" },
            { id: "labadi", name: "Labadi", slug: "labadi" },
            { id: "madina", name: "Madina", slug: "madina" },
            { id: "maamobi", name: "Maamobi", slug: "maamobi" },
            { id: "north-kaneshie", name: "North Kaneshie", slug: "north-kaneshie" },
            { id: "nungua", name: "Nungua", slug: "nungua" },
            { id: "osu", name: "Osu", slug: "osu" },
            { id: "ring-road", name: "Ring Road", slug: "ring-road" },
            { id: "roman-ridge", name: "Roman Ridge", slug: "roman-ridge" },
            { id: "ridge", name: "Ridge", slug: "ridge" },
            { id: "spintex", name: "Spintex", slug: "spintex" },
            { id: "tesano", name: "Tesano", slug: "tesano" },
            { id: "teshie", name: "Teshie", slug: "teshie" },
            { id: "accra-central", name: "Accra Central", slug: "accra-central" },
            { id: "achimota", name: "Achimota", slug: "achimota" },
            { id: "adenta", name: "Adenta", slug: "adenta" },
            { id: "agbogbloshie", name: "Agbogbloshie", slug: "agbogbloshie" },
            { id: "dansoman", name: "Dansoman", slug: "dansoman" },
            { id: "darkuman", name: "Darkuman", slug: "darkuman" },
            { id: "dome", name: "Dome", slug: "dome" },
            { id: "okaishie", name: "Okaishie", slug: "okaishie" },
          ],
        },
        {
          id: "tema",
          name: "Tema",
          slug: "tema",
          regionId: "greater-accra",
          areas: [
            { id: "community-1", name: "Community 1", slug: "community-1" },
            { id: "community-2", name: "Community 2", slug: "community-2" },
            { id: "community-3", name: "Community 3", slug: "community-3" },
            { id: "community-4", name: "Community 4", slug: "community-4" },
            { id: "community-5", name: "Community 5", slug: "community-5" },
            { id: "community-6", name: "Community 6", slug: "community-6" },
            { id: "community-7", name: "Community 7", slug: "community-7" },
            { id: "community-8", name: "Community 8", slug: "community-8" },
            { id: "community-9", name: "Community 9", slug: "community-9" },
            { id: "community-10", name: "Community 10", slug: "community-10" },
            { id: "community-11", name: "Community 11", slug: "community-11" },
            { id: "community-12", name: "Community 12", slug: "community-12" },
            { id: "community-18", name: "Community 18", slug: "community-18" },
            { id: "community-25", name: "Community 25", slug: "community-25" },
            { id: "lashibi", name: "Lashibi", slug: "lashibi" },
            { id: "sakumono", name: "Sakumono", slug: "sakumono" },
            { id: "tema-industrial", name: "Tema Industrial Area", slug: "tema-industrial" },
            { id: "tema-newtown", name: "Tema Newtown", slug: "tema-newtown" },
          ],
        },
        {
          id: "ashaiman",
          name: "Ashaiman",
          slug: "ashaiman",
          regionId: "greater-accra",
          areas: [
            { id: "ashaiman-central", name: "Ashaiman Central", slug: "ashaiman-central" },
            { id: "lebanon", name: "Lebanon", slug: "lebanon" },
            { id: "tulaku", name: "Tulaku", slug: "tulaku" },
            { id: "zenu", name: "Zenu", slug: "zenu" },
          ],
        },
        {
          id: "ga-south",
          name: "Ga South",
          slug: "ga-south",
          regionId: "greater-accra",
          areas: [
            { id: "weija", name: "Weija", slug: "weija" },
            { id: "gbawe", name: "Gbawe", slug: "gbawe" },
            { id: "kasoa", name: "Kasoa", slug: "kasoa" },
            { id: "obom", name: "Obom", slug: "obom" },
          ],
        },
        {
          id: "ga-east",
          name: "Ga East",
          slug: "ga-east",
          regionId: "greater-accra",
          areas: [
            { id: "abokobi", name: "Abokobi", slug: "abokobi" },
            { id: "ashiaman", name: "Ashiaman", slug: "ashiaman" },
            { id: "danfa", name: "Danfa", slug: "danfa" },
            { id: "frafraha", name: "Frafraha", slug: "frafraha" },
          ],
        },
      ],
    },

    // ── 2. ASHANTI ────────────────────────────────────────────────────────
    {
      id: "ashanti",
      name: "Ashanti Region",
      slug: "ashanti",
      capital: "Kumasi",
      cities: [
        {
          id: "kumasi",
          name: "Kumasi",
          slug: "kumasi",
          regionId: "ashanti",
          areas: [
            { id: "adum", name: "Adum", slug: "adum" },
            { id: "airport-kumasi", name: "Airport (Kumasi)", slug: "airport-kumasi" },
            { id: "asokwa", name: "Asokwa", slug: "asokwa" },
            { id: "bantama", name: "Bantama", slug: "bantama" },
            { id: "bohyen", name: "Bohyen", slug: "bohyen" },
            { id: "dechemso", name: "Dechemso", slug: "dechemso" },
            { id: "dichemso", name: "Dichemso", slug: "dichemso" },
            { id: "domiabra", name: "Domiabra", slug: "domiabra" },
            { id: "fankyenebra", name: "Fankyenebra", slug: "fankyenebra" },
            { id: "kronum", name: "Kronum", slug: "kronum" },
            { id: "kwadaso", name: "Kwadaso", slug: "kwadaso" },
            { id: "manhyia", name: "Manhyia", slug: "manhyia" },
            { id: "nhyiaeso", name: "Nhyiaeso", slug: "nhyiaeso" },
            { id: "north-suntreso", name: "North Suntreso", slug: "north-suntreso" },
            { id: "oforikrom", name: "Oforikrom", slug: "oforikrom" },
            { id: "patasi", name: "Patasi", slug: "patasi" },
            { id: "santasi", name: "Santasi", slug: "santasi" },
            { id: "south-suntreso", name: "South Suntreso", slug: "south-suntreso" },
            { id: "suame", name: "Suame", slug: "suame" },
            { id: "tafo", name: "Tafo", slug: "tafo" },
          ],
        },
        {
          id: "obuasi",
          name: "Obuasi",
          slug: "obuasi",
          regionId: "ashanti",
          areas: [
            { id: "obuasi-central", name: "Obuasi Central", slug: "obuasi-central" },
            { id: "kwabrafoso", name: "Kwabrafoso", slug: "kwabrafoso" },
            { id: "tutuka", name: "Tutuka", slug: "tutuka" },
          ],
        },
        {
          id: "bekwai",
          name: "Bekwai",
          slug: "bekwai",
          regionId: "ashanti",
          areas: [
            { id: "bekwai-central", name: "Bekwai Central", slug: "bekwai-central" },
            { id: "anwiankwanta", name: "Anwiankwanta", slug: "anwiankwanta" },
          ],
        },
        {
          id: "mampong",
          name: "Mampong",
          slug: "mampong",
          regionId: "ashanti",
          areas: [
            { id: "mampong-central", name: "Mampong Central", slug: "mampong-central" },
            { id: "nkoranza-ashanti", name: "Nkoranza", slug: "nkoranza-ashanti" },
          ],
        },
        {
          id: "ejisu",
          name: "Ejisu",
          slug: "ejisu",
          regionId: "ashanti",
          areas: [
            { id: "ejisu-central", name: "Ejisu Central", slug: "ejisu-central" },
            { id: "juaben", name: "Juaben", slug: "juaben" },
          ],
        },
      ],
    },

    // ── 3. WESTERN ────────────────────────────────────────────────────────
    {
      id: "western",
      name: "Western Region",
      slug: "western",
      capital: "Sekondi-Takoradi",
      cities: [
        {
          id: "sekondi-takoradi",
          name: "Sekondi-Takoradi",
          slug: "sekondi-takoradi",
          regionId: "western",
          areas: [
            { id: "sekondi", name: "Sekondi", slug: "sekondi" },
            { id: "takoradi", name: "Takoradi", slug: "takoradi" },
            { id: "effia", name: "Effia", slug: "effia" },
            { id: "ketan", name: "Ketan", slug: "ketan" },
            { id: "market-circle", name: "Market Circle", slug: "market-circle" },
            { id: "new-takoradi", name: "New Takoradi", slug: "new-takoradi" },
          ],
        },
        {
          id: "tarkwa",
          name: "Tarkwa",
          slug: "tarkwa",
          regionId: "western",
          areas: [
            { id: "tarkwa-central", name: "Tarkwa Central", slug: "tarkwa-central" },
            { id: "aboso", name: "Aboso", slug: "aboso" },
            { id: "bogoso", name: "Bogoso", slug: "bogoso" },
          ],
        },
        {
          id: "axim",
          name: "Axim",
          slug: "axim",
          regionId: "western",
          areas: [
            { id: "axim-central", name: "Axim Central", slug: "axim-central" },
            { id: "beyin", name: "Beyin", slug: "beyin" },
          ],
        },
        {
          id: "half-assini",
          name: "Half Assini",
          slug: "half-assini",
          regionId: "western",
          areas: [
            { id: "half-assini-central", name: "Half Assini Central", slug: "half-assini-central" },
            { id: "eikwe", name: "Eikwe", slug: "eikwe" },
          ],
        },
      ],
    },

    // ── 4. WESTERN NORTH ─────────────────────────────────────────────────
    {
      id: "western-north",
      name: "Western North Region",
      slug: "western-north",
      capital: "Sefwi Wiawso",
      cities: [
        {
          id: "sefwi-wiawso",
          name: "Sefwi Wiawso",
          slug: "sefwi-wiawso",
          regionId: "western-north",
          areas: [
            { id: "wiawso-central", name: "Wiawso Central", slug: "wiawso-central" },
            { id: "datano", name: "Datano", slug: "datano" },
          ],
        },
        {
          id: "sefwi-bekwai",
          name: "Sefwi Bekwai",
          slug: "sefwi-bekwai",
          regionId: "western-north",
          areas: [
            { id: "sefwi-bekwai-central", name: "Sefwi Bekwai Central", slug: "sefwi-bekwai-central" },
          ],
        },
        {
          id: "bibiani",
          name: "Bibiani",
          slug: "bibiani",
          regionId: "western-north",
          areas: [
            { id: "bibiani-central", name: "Bibiani Central", slug: "bibiani-central" },
            { id: "anwiaso", name: "Anwiaso", slug: "anwiaso" },
            { id: "bekwai-wnorth", name: "Bekwai", slug: "bekwai-wnorth" },
          ],
        },
      ],
    },

    // ── 5. CENTRAL ────────────────────────────────────────────────────────
    {
      id: "central",
      name: "Central Region",
      slug: "central",
      capital: "Cape Coast",
      cities: [
        {
          id: "cape-coast",
          name: "Cape Coast",
          slug: "cape-coast",
          regionId: "central",
          areas: [
            { id: "abura", name: "Abura", slug: "abura" },
            { id: "adisadel", name: "Adisadel", slug: "adisadel" },
            { id: "cape-coast-central", name: "Cape Coast Central", slug: "cape-coast-central" },
            { id: "pedu", name: "Pedu", slug: "pedu" },
            { id: "university-cape-coast", name: "University Area", slug: "university-cape-coast" },
          ],
        },
        {
          id: "winneba",
          name: "Winneba",
          slug: "winneba",
          regionId: "central",
          areas: [
            { id: "winneba-central", name: "Winneba Central", slug: "winneba-central" },
            { id: "swedru", name: "Agona Swedru", slug: "swedru" },
          ],
        },
        {
          id: "saltpond",
          name: "Saltpond",
          slug: "saltpond",
          regionId: "central",
          areas: [
            { id: "saltpond-central", name: "Saltpond Central", slug: "saltpond-central" },
            { id: "anomabo", name: "Anomabo", slug: "anomabo" },
          ],
        },
        {
          id: "elmina",
          name: "Elmina",
          slug: "elmina",
          regionId: "central",
          areas: [
            { id: "elmina-central", name: "Elmina Central", slug: "elmina-central" },
            { id: "komenda", name: "Komenda", slug: "komenda" },
          ],
        },
        {
          id: "kasoa-central",
          name: "Kasoa",
          slug: "kasoa-central",
          regionId: "central",
          areas: [
            { id: "kasoa-town", name: "Kasoa Town", slug: "kasoa-town" },
            { id: "millennium-city", name: "Millennium City", slug: "millennium-city" },
            { id: "budumburam", name: "Budumburam", slug: "budumburam" },
          ],
        },
      ],
    },

    // ── 6. EASTERN ────────────────────────────────────────────────────────
    {
      id: "eastern",
      name: "Eastern Region",
      slug: "eastern",
      capital: "Koforidua",
      cities: [
        {
          id: "koforidua",
          name: "Koforidua",
          slug: "koforidua",
          regionId: "eastern",
          areas: [
            { id: "koforidua-central", name: "Koforidua Central", slug: "koforidua-central" },
            { id: "area-3", name: "Area 3", slug: "area-3" },
            { id: "old-estate", name: "Old Estate", slug: "old-estate" },
            { id: "zongo", name: "Zongo", slug: "zongo" },
          ],
        },
        {
          id: "nkawkaw",
          name: "Nkawkaw",
          slug: "nkawkaw",
          regionId: "eastern",
          areas: [
            { id: "nkawkaw-central", name: "Nkawkaw Central", slug: "nkawkaw-central" },
            { id: "mpraeso", name: "Mpraeso", slug: "mpraeso" },
          ],
        },
        {
          id: "akim-oda",
          name: "Akim Oda",
          slug: "akim-oda",
          regionId: "eastern",
          areas: [
            { id: "oda-central", name: "Oda Central", slug: "oda-central" },
            { id: "akim-swedru", name: "Akim Swedru", slug: "akim-swedru" },
          ],
        },
        {
          id: "suhum",
          name: "Suhum",
          slug: "suhum",
          regionId: "eastern",
          areas: [
            { id: "suhum-central", name: "Suhum Central", slug: "suhum-central" },
            { id: "apedwa", name: "Apedwa", slug: "apedwa" },
          ],
        },
        {
          id: "aburi",
          name: "Aburi",
          slug: "aburi",
          regionId: "eastern",
          areas: [
            { id: "aburi-central", name: "Aburi Central", slug: "aburi-central" },
            { id: "mamfe", name: "Mamfe", slug: "mamfe" },
            { id: "peduase", name: "Peduase", slug: "peduase" },
          ],
        },
      ],
    },

    // ── 7. VOLTA ──────────────────────────────────────────────────────────
    {
      id: "volta",
      name: "Volta Region",
      slug: "volta",
      capital: "Ho",
      cities: [
        {
          id: "ho",
          name: "Ho",
          slug: "ho",
          regionId: "volta",
          areas: [
            { id: "ho-central", name: "Ho Central", slug: "ho-central" },
            { id: "bankoe", name: "Bankoe", slug: "bankoe" },
            { id: "dome-ho", name: "Dome", slug: "dome-ho" },
            { id: "heve", name: "Heve", slug: "heve" },
            { id: "kpota", name: "Kpota", slug: "kpota" },
          ],
        },
        {
          id: "hohoe",
          name: "Hohoe",
          slug: "hohoe",
          regionId: "volta",
          areas: [
            { id: "hohoe-central", name: "Hohoe Central", slug: "hohoe-central" },
            { id: "gbledi", name: "Gbledi", slug: "gbledi" },
          ],
        },
        {
          id: "keta",
          name: "Keta",
          slug: "keta",
          regionId: "volta",
          areas: [
            { id: "keta-central", name: "Keta Central", slug: "keta-central" },
            { id: "anloga", name: "Anloga", slug: "anloga" },
          ],
        },
        {
          id: "kpando",
          name: "Kpando",
          slug: "kpando",
          regionId: "volta",
          areas: [
            { id: "kpando-central", name: "Kpando Central", slug: "kpando-central" },
            { id: "torkor", name: "Torkor", slug: "torkor" },
          ],
        },
      ],
    },

    // ── 8. OTI ────────────────────────────────────────────────────────────
    {
      id: "oti",
      name: "Oti Region",
      slug: "oti",
      capital: "Dambai",
      cities: [
        {
          id: "dambai",
          name: "Dambai",
          slug: "dambai",
          regionId: "oti",
          areas: [
            { id: "dambai-central", name: "Dambai Central", slug: "dambai-central" },
            { id: "chinderi", name: "Chinderi", slug: "chinderi" },
          ],
        },
        {
          id: "jasikan",
          name: "Jasikan",
          slug: "jasikan",
          regionId: "oti",
          areas: [
            { id: "jasikan-central", name: "Jasikan Central", slug: "jasikan-central" },
          ],
        },
        {
          id: "kadjebi",
          name: "Kadjebi",
          slug: "kadjebi",
          regionId: "oti",
          areas: [
            { id: "kadjebi-central", name: "Kadjebi Central", slug: "kadjebi-central" },
            { id: "abotoase", name: "Abotoase", slug: "abotoase" },
          ],
        },
        {
          id: "nkwanta",
          name: "Nkwanta",
          slug: "nkwanta",
          regionId: "oti",
          areas: [
            { id: "nkwanta-central", name: "Nkwanta Central", slug: "nkwanta-central" },
          ],
        },
      ],
    },

    // ── 9. BRONG-AHAFO (now split; kept as legacy + Bono/Bono East) ──────
    {
      id: "bono",
      name: "Bono Region",
      slug: "bono",
      capital: "Sunyani",
      cities: [
        {
          id: "sunyani",
          name: "Sunyani",
          slug: "sunyani",
          regionId: "bono",
          areas: [
            { id: "sunyani-central", name: "Sunyani Central", slug: "sunyani-central" },
            { id: "abesim", name: "Abesim", slug: "abesim" },
            { id: "fiapre", name: "Fiapre", slug: "fiapre" },
            { id: "odumase-bono", name: "Odumase", slug: "odumase-bono" },
          ],
        },
        {
          id: "berekum",
          name: "Berekum",
          slug: "berekum",
          regionId: "bono",
          areas: [
            { id: "berekum-central", name: "Berekum Central", slug: "berekum-central" },
            { id: "dormaa-ahenkro", name: "Dormaa Ahenkro", slug: "dormaa-ahenkro" },
          ],
        },
        {
          id: "wenchi",
          name: "Wenchi",
          slug: "wenchi",
          regionId: "bono",
          areas: [
            { id: "wenchi-central", name: "Wenchi Central", slug: "wenchi-central" },
          ],
        },
      ],
    },

    // ── 10. BONO EAST ─────────────────────────────────────────────────────
    {
      id: "bono-east",
      name: "Bono East Region",
      slug: "bono-east",
      capital: "Techiman",
      cities: [
        {
          id: "techiman",
          name: "Techiman",
          slug: "techiman",
          regionId: "bono-east",
          areas: [
            { id: "techiman-central", name: "Techiman Central", slug: "techiman-central" },
            { id: "techiman-north", name: "Techiman North", slug: "techiman-north" },
          ],
        },
        {
          id: "kintampo",
          name: "Kintampo",
          slug: "kintampo",
          regionId: "bono-east",
          areas: [
            { id: "kintampo-central", name: "Kintampo Central", slug: "kintampo-central" },
            { id: "buipe", name: "Buipe", slug: "buipe" },
          ],
        },
        {
          id: "atebubu",
          name: "Atebubu",
          slug: "atebubu",
          regionId: "bono-east",
          areas: [
            { id: "atebubu-central", name: "Atebubu Central", slug: "atebubu-central" },
            { id: "prang", name: "Prang", slug: "prang" },
          ],
        },
      ],
    },

    // ── 11. AHAFO ─────────────────────────────────────────────────────────
    {
      id: "ahafo",
      name: "Ahafo Region",
      slug: "ahafo",
      capital: "Goaso",
      cities: [
        {
          id: "goaso",
          name: "Goaso",
          slug: "goaso",
          regionId: "ahafo",
          areas: [
            { id: "goaso-central", name: "Goaso Central", slug: "goaso-central" },
            { id: "kukuom", name: "Kukuom", slug: "kukuom" },
          ],
        },
        {
          id: "kenyasi",
          name: "Kenyasi",
          slug: "kenyasi",
          regionId: "ahafo",
          areas: [
            { id: "kenyasi-central", name: "Kenyasi Central", slug: "kenyasi-central" },
          ],
        },
        {
          id: "hwidiem",
          name: "Hwidiem",
          slug: "hwidiem",
          regionId: "ahafo",
          areas: [
            { id: "hwidiem-central", name: "Hwidiem Central", slug: "hwidiem-central" },
          ],
        },
      ],
    },

    // ── 12. NORTHERN ──────────────────────────────────────────────────────
    {
      id: "northern",
      name: "Northern Region",
      slug: "northern",
      capital: "Tamale",
      cities: [
        {
          id: "tamale",
          name: "Tamale",
          slug: "tamale",
          regionId: "northern",
          areas: [
            { id: "aboabo", name: "Aboabo", slug: "aboabo" },
            { id: "central-tamale", name: "Central Tamale", slug: "central-tamale" },
            { id: "datoyili", name: "Datoyili", slug: "datoyili" },
            { id: "gumbihini", name: "Gumbihini", slug: "gumbihini" },
            { id: "kukuo", name: "Kukuo", slug: "kukuo" },
            { id: "lamashegu", name: "Lamashegu", slug: "lamashegu" },
            { id: "nyohini", name: "Nyohini", slug: "nyohini" },
            { id: "sagnarigu", name: "Sagnarigu", slug: "sagnarigu" },
            { id: "tamale-south", name: "Tamale South", slug: "tamale-south" },
            { id: "vittin", name: "Vittin", slug: "vittin" },
          ],
        },
        {
          id: "yendi",
          name: "Yendi",
          slug: "yendi",
          regionId: "northern",
          areas: [
            { id: "yendi-central", name: "Yendi Central", slug: "yendi-central" },
            { id: "saboba", name: "Saboba", slug: "saboba" },
          ],
        },
        {
          id: "bimbilla",
          name: "Bimbilla",
          slug: "bimbilla",
          regionId: "northern",
          areas: [
            { id: "bimbilla-central", name: "Bimbilla Central", slug: "bimbilla-central" },
          ],
        },
        {
          id: "salaga",
          name: "Salaga",
          slug: "salaga",
          regionId: "northern",
          areas: [
            { id: "salaga-central", name: "Salaga Central", slug: "salaga-central" },
          ],
        },
      ],
    },

    // ── 13. SAVANNAH ──────────────────────────────────────────────────────
    {
      id: "savannah",
      name: "Savannah Region",
      slug: "savannah",
      capital: "Damongo",
      cities: [
        {
          id: "damongo",
          name: "Damongo",
          slug: "damongo",
          regionId: "savannah",
          areas: [
            { id: "damongo-central", name: "Damongo Central", slug: "damongo-central" },
            { id: "busunu", name: "Busunu", slug: "busunu" },
          ],
        },
        {
          id: "bole",
          name: "Bole",
          slug: "bole",
          regionId: "savannah",
          areas: [
            { id: "bole-central", name: "Bole Central", slug: "bole-central" },
            { id: "tuna", name: "Tuna", slug: "tuna" },
          ],
        },
        {
          id: "sawla",
          name: "Sawla",
          slug: "sawla",
          regionId: "savannah",
          areas: [
            { id: "sawla-central", name: "Sawla Central", slug: "sawla-central" },
            { id: "tuna-kalba", name: "Tuna-Kalba", slug: "tuna-kalba" },
          ],
        },
      ],
    },

    // ── 14. NORTH EAST ────────────────────────────────────────────────────
    {
      id: "north-east",
      name: "North East Region",
      slug: "north-east",
      capital: "Nalerigu",
      cities: [
        {
          id: "nalerigu",
          name: "Nalerigu",
          slug: "nalerigu",
          regionId: "north-east",
          areas: [
            { id: "nalerigu-central", name: "Nalerigu Central", slug: "nalerigu-central" },
            { id: "gambaga", name: "Gambaga", slug: "gambaga" },
          ],
        },
        {
          id: "walewale",
          name: "Walewale",
          slug: "walewale",
          regionId: "north-east",
          areas: [
            { id: "walewale-central", name: "Walewale Central", slug: "walewale-central" },
          ],
        },
        {
          id: "bunkpurugu",
          name: "Bunkpurugu",
          slug: "bunkpurugu",
          regionId: "north-east",
          areas: [
            { id: "bunkpurugu-central", name: "Bunkpurugu Central", slug: "bunkpurugu-central" },
            { id: "nkoranza-ne", name: "Nkoranza", slug: "nkoranza-ne" },
          ],
        },
      ],
    },

    // ── 15. UPPER EAST ────────────────────────────────────────────────────
    {
      id: "upper-east",
      name: "Upper East Region",
      slug: "upper-east",
      capital: "Bolgatanga",
      cities: [
        {
          id: "bolgatanga",
          name: "Bolgatanga",
          slug: "bolgatanga",
          regionId: "upper-east",
          areas: [
            { id: "bolgatanga-central", name: "Bolgatanga Central", slug: "bolgatanga-central" },
            { id: "bolga-east", name: "Bolga East", slug: "bolga-east" },
            { id: "soe", name: "Soe", slug: "soe" },
            { id: "tindongo", name: "Tindongo", slug: "tindongo" },
          ],
        },
        {
          id: "navrongo",
          name: "Navrongo",
          slug: "navrongo",
          regionId: "upper-east",
          areas: [
            { id: "navrongo-central", name: "Navrongo Central", slug: "navrongo-central" },
            { id: "sirigu", name: "Sirigu", slug: "sirigu" },
          ],
        },
        {
          id: "bawku",
          name: "Bawku",
          slug: "bawku",
          regionId: "upper-east",
          areas: [
            { id: "bawku-central", name: "Bawku Central", slug: "bawku-central" },
            { id: "zebilla", name: "Zebilla", slug: "zebilla" },
          ],
        },
        {
          id: "paga",
          name: "Paga",
          slug: "paga",
          regionId: "upper-east",
          areas: [
            { id: "paga-central", name: "Paga Central", slug: "paga-central" },
          ],
        },
      ],
    },

    // ── 16. UPPER WEST ────────────────────────────────────────────────────
    {
      id: "upper-west",
      name: "Upper West Region",
      slug: "upper-west",
      capital: "Wa",
      cities: [
        {
          id: "wa",
          name: "Wa",
          slug: "wa",
          regionId: "upper-west",
          areas: [
            { id: "wa-central", name: "Wa Central", slug: "wa-central" },
            { id: "wa-east", name: "Wa East", slug: "wa-east" },
            { id: "wa-west", name: "Wa West", slug: "wa-west" },
            { id: "kpongu", name: "Kpongu", slug: "kpongu" },
          ],
        },
        {
          id: "lawra",
          name: "Lawra",
          slug: "lawra",
          regionId: "upper-west",
          areas: [
            { id: "lawra-central", name: "Lawra Central", slug: "lawra-central" },
            { id: "nandom", name: "Nandom", slug: "nandom" },
          ],
        },
        {
          id: "jirapa",
          name: "Jirapa",
          slug: "jirapa",
          regionId: "upper-west",
          areas: [
            { id: "jirapa-central", name: "Jirapa Central", slug: "jirapa-central" },
            { id: "lambussie", name: "Lambussie", slug: "lambussie" },
          ],
        },
        {
          id: "tumu",
          name: "Tumu",
          slug: "tumu",
          regionId: "upper-west",
          areas: [
            { id: "tumu-central", name: "Tumu Central", slug: "tumu-central" },
            { id: "gwolu", name: "Gwolu", slug: "gwolu" },
          ],
        },
      ],
    },
  ],
};


// ═══════════════════════════════ HELPERS ════════════════════════════════════

/** Normalise a string for case-insensitive, trimmed comparisons */
const normalize = (value: string): string => value.trim().toLowerCase();


// ─────────────────────────────────────────────────────────────────────────────
//  READ  helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a flat list of all regions (without city/area detail).
 */
export const getAllRegions = () =>
  ghanaLocations.regions.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    capital: r.capital,
    cityCount: r.cities.length,
  }));


/**
 * Returns all cities across every region in a flat list.
 */
export const getAllCities = () =>
  ghanaLocations.regions.flatMap((r) =>
    r.cities.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      region: r.name,
      regionSlug: r.slug,
      areaCount: c.areas.length,
    }))
  );


/**
 * Returns all areas across every region and city in a flat list.
 */
export const getAllAreas = () =>
  ghanaLocations.regions.flatMap((r) =>
    r.cities.flatMap((c) =>
      c.areas.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        city: c.name,
        citySlug: c.slug,
        region: r.name,
        regionSlug: r.slug,
      }))
    )
  );


/**
 * Returns cities belonging to a given region slug, including area counts.
 * @throws if the region slug does not exist
 */
export const getCitiesByRegion = (regionSlug: string) => {
  const region = ghanaLocations.regions.find(
    (r) => normalize(r.slug) === normalize(regionSlug)
  );
  if (!region) throw new Error(`Region not found: "${regionSlug}"`);

  return {
    region: region.name,
    regionSlug: region.slug,
    capital: region.capital,
    cities: region.cities.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      areaCount: c.areas.length,
    })),
  };
};


/**
 * Returns areas belonging to a specific city within a region.
 * @throws if region or city slug does not exist
 */
export const getAreasByCity = (regionSlug: string, citySlug: string) => {
  const region = ghanaLocations.regions.find(
    (r) => normalize(r.slug) === normalize(regionSlug)
  );
  if (!region) throw new Error(`Region not found: "${regionSlug}"`);

  const city = region.cities.find(
    (c) => normalize(c.slug) === normalize(citySlug)
  );
  if (!city) throw new Error(`City not found: "${citySlug}" in "${regionSlug}"`);

  return {
    region: region.name,
    regionSlug: region.slug,
    city: city.name,
    citySlug: city.slug,
    areas: city.areas,
  };
};


// ─────────────────────────────────────────────────────────────────────────────
//  SEARCH  helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global full-text search across regions, cities, and areas.
 * Returns the FIRST exact or partial match (most specific wins: area > city > region).
 *
 * @example
 * searchLocation("East Legon")
 * // → { type: "area", area: "East Legon", city: "Accra", region: "Greater Accra Region", ... }
 */
export const searchLocation = (query: string): SearchResult | null => {
  const q = normalize(query);

  for (const region of ghanaLocations.regions) {
    for (const city of region.cities) {
      for (const area of city.areas) {
        if (normalize(area.name).includes(q)) {
          return {
            type: "area",
            area: area.name,
            areaSlug: area.slug,
            city: city.name,
            citySlug: city.slug,
            region: region.name,
            regionSlug: region.slug,
          };
        }
      }
      if (normalize(city.name).includes(q)) {
        return {
          type: "city",
          city: city.name,
          citySlug: city.slug,
          region: region.name,
          regionSlug: region.slug,
        };
      }
    }
    if (normalize(region.name).includes(q)) {
      return { type: "region", region: region.name, regionSlug: region.slug };
    }
  }

  return null;
};


/**
 * Like `searchLocation` but returns ALL matches — useful for autocomplete / search dropdowns.
 */
export const searchAllLocations = (query: string): SearchResult[] => {
  const q = normalize(query);
  const results: SearchResult[] = [];

  for (const region of ghanaLocations.regions) {
    if (normalize(region.name).includes(q)) {
      results.push({ type: "region", region: region.name, regionSlug: region.slug });
    }
    for (const city of region.cities) {
      if (normalize(city.name).includes(q)) {
        results.push({
          type: "city",
          city: city.name,
          citySlug: city.slug,
          region: region.name,
          regionSlug: region.slug,
        });
      }
      for (const area of city.areas) {
        if (normalize(area.name).includes(q)) {
          results.push({
            type: "area",
            area: area.name,
            areaSlug: area.slug,
            city: city.name,
            citySlug: city.slug,
            region: region.name,
            regionSlug: region.slug,
          });
        }
      }
    }
  }

  return results;
};


// ─────────────────────────────────────────────────────────────────────────────
//  VALIDATE  helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a region → city → area triplet exists in the dataset.
 * Use this before persisting a property listing.
 *
 * @example
 * validateLocation("greater-accra", "accra", "east-legon")
 * // → { valid: true, data: { region: "Greater Accra Region", city: "Accra", area: "East Legon", ... } }
 */
export const validateLocation = (
  regionSlug: string,
  citySlug: string,
  areaSlug: string
): ValidationResult => {
  const region = ghanaLocations.regions.find(
    (r) => normalize(r.slug) === normalize(regionSlug)
  );
  if (!region) return { valid: false, message: `Invalid region: "${regionSlug}"` };

  const city = region.cities.find(
    (c) => normalize(c.slug) === normalize(citySlug)
  );
  if (!city) return { valid: false, message: `Invalid city: "${citySlug}" for region "${regionSlug}"` };

  const area = city.areas.find(
    (a) => normalize(a.slug) === normalize(areaSlug)
  );
  if (!area) return { valid: false, message: `Invalid area: "${areaSlug}" for city "${citySlug}"` };

  return {
    valid: true,
    data: {
      region: region.name,
      regionSlug: region.slug,
      city: city.name,
      citySlug: city.slug,
      area: area.name,
      areaSlug: area.slug,
    },
  };
};


// ─────────────────────────────────────────────────────────────────────────────
//  UTILITY  helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a full location path object from three slugs.
 * Useful for building breadcrumbs, canonical URLs, or display labels.
 *
 * @throws if any slug is not found
 *
 * @example
 * getLocationPath("greater-accra", "accra", "osu")
 * // → { region: { id, name, slug }, city: { id, name, slug }, area: { id, name, slug } }
 */
export const getLocationPath = (
  regionSlug: string,
  citySlug: string,
  areaSlug: string
): LocationPath => {
  const result = validateLocation(regionSlug, citySlug, areaSlug);
  if (!result.valid) throw new Error(result.message);

  const region = ghanaLocations.regions.find(
    (r) => normalize(r.slug) === normalize(regionSlug)
  )!;
  const city = region.cities.find(
    (c) => normalize(c.slug) === normalize(citySlug)
  )!;
  const area = city.areas.find(
    (a) => normalize(a.slug) === normalize(areaSlug)
  )!;

  return {
    region: { id: region.id, name: region.name, slug: region.slug },
    city: { id: city.id, name: city.name, slug: city.slug },
    area: { id: area.id, name: area.name, slug: area.slug },
  };
};


/**
 * Converts a display name to a URL-safe slug.
 * Useful when adding new entries programmatically.
 *
 * @example toSlug("East Legon Hills") → "east-legon-hills"
 */
export const toSlug = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");