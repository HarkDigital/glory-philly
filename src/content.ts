// All copy for the Glory Beer Bar & Kitchen site, VERBATIM from gloryphilly.com
// (About, Kitchen, Bar, Book an Event, Contact; tap list "Last Update:
// 2026-09-28") plus the Instagram bio (@glorybeerbarandkitchen: kitchen hours,
// the Toast reservations link) and the painted wall sign ("This must be the
// place"). Don't invent facts: every name, price, hour and line below is
// sourced. Typos on the source site are fixed only where obvious
// ("exerience", "Freshno", "POTOATOES", "Dirstrict"); menu text is kept in the
// site's own words, re-cased from ALL CAPS.

/** This site. */
export const SITE = {
  name: 'Glory',
  slug: 'glory-philly',
}

export const BRAND = {
  name: 'Glory Beer Bar & Kitchen',
  short: 'Glory',
  /** the site's title line */
  tagline: 'Craft Beer, Brunch & Events in Old City Philadelphia',
  /** painted on the brick wall by the front windows, under the name */
  motto: 'This must be the place.',
  street: '126 Chestnut Street',
  city: 'Philadelphia, PA 19106',
  neighborhood: 'Old City',
  phone: '(267) 687-7878',
  phoneHref: 'tel:+12676877878',
  email: 'systemadmin@gloryphilly.com',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=Glory+Beer+Bar+%26+Kitchen+126+Chestnut+St+Philadelphia+PA+19106',
  website: 'https://www.gloryphilly.com/',
  /** the red "G" roundel (the site icon) */
  roundel: 'photos/g-roundel.png',
}

/** Where to book, buy and follow (all from gloryphilly.com and the Instagram bio). */
export const LINKS = {
  reserve: { label: 'Make a Reservation', url: 'https://tables.toasttab.com/restaurants/ab48f890-bfb6-4327-ad83-31d5a38b0455/findTime' },
  reserveYelp: { label: 'Reserve at Glory Beer Bar & Kitchen on Yelp', url: 'https://www.yelp.com/reservations/glory-beer-bar-and-kitchen-philadelphia-3' },
  order: { label: 'Order for Pickup with ToastTab', url: 'https://www.toasttab.com/glory-beer-bar-kitchen-126-chestnut-st/v3' },
  giftCards: { label: 'Buy Gift Cards!', url: 'https://www.toasttab.com/glory-beer-bar-kitchen-126-chestnut-st/giftcards?utmCampaign=onlineOrdering' },
  app: { label: 'Download the Mobile App', url: 'https://apps.apple.com/gb/app/glory-beer-bar-kitchen/id1487567902' },
  untappd: { label: 'See UNTAPPD for additional info!', url: 'https://untappd.com/v/glory-beer-bar-and-kitchen/8087407' },
  events: { label: 'Upcoming Events', url: 'https://www.gloryphilly.com/events.php' },
}

export const SOCIALS = [
  { name: 'Instagram', handle: '@glorybeerbarandkitchen', url: 'https://www.instagram.com/glorybeerbarandkitchen/' },
  { name: 'Facebook', handle: 'Glory Beer Bar & Kitchen', url: 'https://www.facebook.com/glorybeerbarandkitchen' },
]

/** Bar hours (gloryphilly.com Contact). */
export const HOURS = [
  { day: 'Monday', hours: '4pm - 2am' },
  { day: 'Tuesday', hours: '4pm - 2am' },
  { day: 'Wednesday', hours: '4pm - 2am' },
  { day: 'Thursday', hours: '12pm - 2am' },
  { day: 'Friday', hours: '12pm - 2am' },
  { day: 'Saturday', hours: '12pm - 2am' },
  { day: 'Sunday', hours: '12pm - 2am' },
]

/** Kitchen hours (Instagram bio). */
export const KITCHEN_HOURS = [
  { day: 'Mon Tues Wed', hours: '4pm-9pm' },
  { day: 'Thurs', hours: '12pm-10pm' },
  { day: 'Fri Sat', hours: '12pm-11pm' },
  { day: 'Sun', hours: '12pm-9pm' },
]

/** Reservations note (gloryphilly.com). */
export const RESERVATIONS = {
  large: 'For reservations of more than 10, please email dave@gloryphilly.com for a request.',
  email: 'dave@gloryphilly.com',
}

// ─── KITCHEN ────────────────────────────────────────────────────────────────

export interface Dish {
  name: string
  /** the menu's price, as printed ("16/24", "18") */
  price: string
  desc: string
  /** V / GF, as marked */
  marks?: string[]
  /** a photo of this dish from gloryphilly.com (public/photos) */
  photo?: string
}

export interface MenuSection {
  id: string
  title: string
  note?: string
  items: Dish[]
}

/** The All Day Menu, section by section (gloryphilly.com Kitchen). */
export const MENU: MenuSection[] = [
  {
    id: 'starters',
    title: 'Starters',
    items: [
      { name: 'Cheese & Salumi', price: '16/24', desc: 'Goot Essa Der Mutterschaf, Manchego, Doe Run 7 Sisters, Hot Coppa, Chorizo de Pamplona, Salichicon di Vic, House Sourdough Bread (Small/Large)' },
      { name: 'Seared Octopus', price: '18', marks: ['GF'], desc: 'Leek, Fresno, Spinach, Nduja Aioli', photo: 'photos/octopus.webp' },
      { name: 'Charred Shishitos', price: '10', marks: ['V', 'GF'], desc: 'Tomato-Cilantro Aioli, Togarashi' },
      { name: 'Wings', price: '16', desc: 'Chipotle Lime, House Bleu Cheese', photo: 'photos/wings.webp' },
      { name: 'Mac & Cheese', price: '13', marks: ['V'], desc: 'Aged Cheddar, Cooper Sharp (Add Bacon + 3)', photo: 'photos/mac-and-cheese.webp' },
      { name: 'Olive & Hummus Plate', price: '15', marks: ['V'], desc: 'Assorted Hummus, House Marinated Olives, Herbed Feta, Grilled Pita' },
      { name: 'Hawaiian Flatbread', price: '14', desc: 'Pineapple, Smoked Ham, Mozzarella, Long Hot Aioli' },
      { name: 'Hand Cut Fries', price: '9', marks: ['V'], desc: 'House Made Ketchup & Aioli' },
    ],
  },
  {
    id: 'soups-salads',
    title: 'Soups & Salads',
    items: [
      { name: 'French Onion Soup', price: '12', desc: 'Day Old Bread, Gruyere', photo: 'photos/french-onion.webp' },
      { name: 'Watermelon Salad', price: '12', marks: ['V', 'GF'], desc: 'Maplebrook Farm Feta, Cucumber, Pistachios, Honey-Mint Vinaigrette' },
      { name: 'Burrata Salad', price: '13', marks: ['V', 'GF'], desc: 'Peaches, Apples, Almonds, Sweet Drops, Lime Juice, EVOO' },
      { name: 'Caesar Salad', price: '9', desc: 'Massaged Kale, Cured Egg Yolk, Pangritata' },
      { name: 'Add to Salad', price: '5/8', desc: 'Grilled or Crispy Chicken $5' },
    ],
  },
  {
    id: 'sandwiches',
    title: 'Sandwiches',
    note: 'Add Bacon for $3, Add Side of Mac & Cheese for $6',
    items: [
      { name: 'Fried Haddock', price: '16', desc: 'Kimchi, Avocado, Mayo, House Made Roll' },
      { name: 'Mortadella & Burrata', price: '17', desc: 'Pistachio Pesto, Greens, Sourdough Focaccia' },
      { name: 'Glory Porchetta', price: '17', desc: 'Roasted Pork Belly, Braised Greens, Sharp Provolone, House Made Roll', photo: 'photos/porchetta.webp' },
      { name: 'Kielbasa', price: '16', desc: 'House Made Sausage, Chipotle Mustard, Jalapeño Slaw, Onion Straws, Homemade Roll' },
      { name: 'Crispy Chicken', price: '15', desc: 'Horseradish Aioli, Lettuce, Tomato, Pickled Onion', photo: 'photos/crispy-chicken.webp' },
      { name: 'Glory Burger', price: '16', desc: 'Cooper Sharp Cheese, LTO by Request', photo: 'photos/glory-burger.webp' },
    ],
  },
  {
    id: 'specials',
    title: 'Specials',
    items: [
      { name: 'Lamb Kefta Burger', price: '17', desc: 'Whipped Feta, Pickled Onion, House Zaatar Roll, Tabouli Salad' },
      { name: 'Calabrian Chili Ravioli', price: '22', desc: 'Smoked Chicken, Ricotta, Summer Corn Cream', photo: 'photos/ig-ravioli-corn.webp' },
      { name: 'Fried Chicken', price: '24', desc: 'Breast, Leg, Thigh, Jersey Peach Hash, Delco Slaw, Buttermilk Biscuit', photo: 'photos/ig-fried-chicken.webp' },
      { name: 'Crispy Meatballs', price: '20', desc: 'Mashed Red Potatoes, Yellow Pepper Salad, Spinach Crema' },
      { name: 'Bistro Steak', price: '26', desc: 'Grilled Med-Rare, Potato Gratin, Sauteed Spinach, Rodenbach Steak Sauce, Crispy Shallots' },
    ],
  },
  {
    id: 'sweets',
    title: 'Sweets',
    items: [
      { name: 'Tiramisu', price: '9', marks: ['V'], desc: 'Amaretto, Mascarpone, Cocoa' },
      { name: 'Chocolate Cheesecake', price: '9', marks: ['V'], desc: 'Blueberry-Raspberry Topping' },
    ],
  },
]

/** The dishes with photos, in menu order: the Kitchen chapter's hero plates. */
export const FEATURED_DISHES: Dish[] = MENU.flatMap(s => s.items).filter(d => d.photo)

// ─── BAR ────────────────────────────────────────────────────────────────────

/** The Bar page intro, verbatim. */
export const BAR = {
  taps: 36,
  intro:
    'Glory Beer Bar & Kitchen has a revolving 36 beers on tap featuring a variety of American and Local Breweries while also offering a wide array of International and Seasonal favorites. Each of the selections are carefully chosen by our resident beer experts who can guide you to your perfect pour. Check back here for our current options.',
  wine: 'In addition to the extensive beer offerings, we have a dedicated tap system to red, white and rosé wine.',
  cocktails:
    'If beer and wine do not satisfy your thirst, our skilled bartenders can create a cocktail of your choosing using the finest spirits and freshest ingredients.',
  app: 'Click Here to Download the Mobile App to see current Draft, Bottle and Cocktail Lists!',
  lastUpdate: '2026-09-28',
}

export interface BeerGroup {
  id: 'american' | 'international' | 'local'
  title: string
  beers: string[]
}

/** DRAFTS (gloryphilly.com Bar, last update 2026-09-28). */
export const DRAFTS: BeerGroup[] = [
  {
    id: 'american',
    title: 'American',
    beers: [
      'Artifact Feels like Home',
      'Aurora Brewing Co. Fresh to Death',
      'Bravazzi - Blood Orange',
      'Burlington Little Wizard',
      'Crooked Stave Nightmare on Brett',
      'Great Lakes Dortmunder Gold',
      'Hill Farmstead - Sumner',
      'Hudson Valley Amulet',
      'Kelterei Possmann Rose Cider',
      'OEC Phantasma Sour Blend #11',
      'Other Half Green Caps',
      'Peak Organic Brewing - IPA',
      'Port City Brewing Optimal',
      'Russian River Pliny the Elder',
      'Talea Watermelon Splash',
      'Three Floyds - Yum Yum',
      'Widowmaker Secret Sesh',
      'Wissahickon Brewing Daybreak',
      'Xul - PB & J Mixtape',
    ],
  },
  {
    id: 'international',
    title: 'International',
    beers: [
      'Bitburger Pils',
      'Corsedonk Bruin',
      'de la Senne Taras Boulba',
      'Kostritzer Schwarzbier',
      'Liefmans Goudenband',
      'Piraat',
      'Straffe Hendrik Quadrupel',
      'Unibroue La Fin Du Monde',
      'Weihenstephaner Hefeweissbier',
    ],
  },
  {
    id: 'local',
    title: 'Local',
    beers: [
      'Braeloch Brewing Variance',
      'Free Will Scarecrow',
      'Glory Beer Bar - Gloria - Old City Saison',
      'Sacred Vice - Rubbish',
      'Second District Rosewood #1',
      'Second District Incante',
      'Second District Morton',
    ],
  },
]

/** BOTTLES (duplicates on the source list removed). */
export const BOTTLES: BeerGroup[] = [
  {
    id: 'american',
    title: 'American',
    beers: [
      'Central Waters Brewers Reserve',
      'Jolly Pumpkin Saison Z 2016',
      'Logsdon Cerasus 2016',
      'Logsdon Far West Vlaming 2016',
      'Logsdon Oak Aged Bretta 2016',
      'Logsdon The Conversation 2016',
      'Mortalis - Hydra Hostility',
      'Odd Breed Relatable Relic',
      'Russian River Consecration',
      'St. Feuillien - Tripel Methusula',
      'The Alchemist Heady Topper',
      'WeldWerks Brewing Co Last Scoop Neapolitan',
      'WeldWerks Brewing Co Orange Creamsicle',
      'Xul Magic Wands Upside Down',
    ],
  },
  {
    id: 'international',
    title: 'International',
    beers: [
      'BFM Abbaye De Saint Bon-Chien 2021',
      'Blaugies Darbyste',
      'Collective Arts Origin of Darkness Duggess Bryggeri',
      'De Dolle Dulle Teve',
      'De La Senne Taras Boulba',
      'DeRanke Cuvee',
      'Drei Fonteinen Aarbei Lambic',
      'Drie Fonteinen Aarbei Kriek 2021',
      'Drie Fonteinen Cuvee Armand & Gaston',
      'Drie Fonteinen Cuvee Miel',
      'Drie Fonteinen Frambozenlambic',
      'Drie Fonteinen Kriek',
      'Drie Fonteinen Kriek 1.5L',
      'Drie Fonteinen Oude Gueuze',
      'Drie Fonteinen Oude Gueuze Cuvee Armand & Gaston',
      'Drie Fonteinen Oude Kriekenlambik',
      'Drie Fonteinen Schaarbeekse Kriek',
      'Einbecker Winter Doppel Bock',
      'Etienne Dupont Cidre',
      'Fantome Blanche',
      'Fantome La Dalmatienne',
      'Fantome Oouupps (collab with Mariatorgets)',
      'Fantome Spiritus Spring Project',
      'Glazen Toren Ondineke Tripel',
      'Glazen Toren Saison Derpe Mere',
      'Gurutzeta Sagardo Artisinal Cider',
      'Gurutzeta Sagardo Natural Cider',
      'Hitachino Anbai Plum',
      'Insight Maturation Vin Jaune',
      'JW Lees Lagavulin Harvest Ale 2022',
      'Kestemont - Framboise',
      'Kestemont - Groene Druif',
      'Kestemont - Oude Kriek Shaarbeek',
      'La Malpolon Chanteloup 2022',
      'La Malpolon Grappe Blancs 2003',
      'Legendes - Tripel Goliath',
      'Lindemans Framboise',
      'Sesma - Termino Monte',
      'St Feuillien Tripel 3Liter',
      'St. Bernardus 2020 Abt 12 Magnum',
      'Tilquin Oude Gueuze 2018',
      'To OL - Mexican Hot Chocolate',
    ],
  },
  {
    id: 'local',
    title: 'Local',
    beers: ['Ploughman Cherrybyrd', 'Ploughman Goldrush'],
  },
]

/** WINE (on tap, plus a bottle list in house). */
export const WINE = [
  'Bodegas Albero Cabernet Sauvignon',
  'Bodegas Albero Sauvignon Blanc',
  'Bodegas Albero Rose',
  'House Sparkling',
  'In-House Bottle List',
]

/** SPECIALTY COCKTAILS. */
export const COCKTAILS = [
  { name: 'Rosemary Lemonade', spec: 'Vodka, Lemon Juice, Rosemary' },
  { name: 'Espresso Martini', spec: 'Vodka, Kahlua, Espresso' },
  { name: 'Classic Negroni', spec: 'Campari, Bluecoat Gin, Punt e Mes, Orange Peel' },
  { name: 'Smoke on the Water Slammer', spec: 'Aperol, Mezcal, Pineapple, Lime' },
  { name: 'Spicy Ranch Water', spec: 'Tequila, Jalapeño & Fresno Peppers, Lime Juice, Soda Water' },
  { name: 'Kingston Negroni', spec: 'Appleton Rum, Punt E Mes, Campari' },
  { name: 'Tiny Badger', spec: 'Prosecco, Benedictine, Lemon' },
]

// ─── PEOPLE ─────────────────────────────────────────────────────────────────

/** About, verbatim (typo "exerience" fixed, as on the site's second copy). */
export const PEOPLE = [
  {
    id: 'dave',
    name: 'Dave',
    role: 'Proprietor',
    photo: 'photos/dave.webp',
    bio: [
      'Dave, a long time Philadelphia resident, has spent 15 years behind the bar, the last 10, of course, being the stalwart beer aficionado at the old Eulogy Belgian Tavern. Dave prides himself on not just having a vast knowledge of product but an acumen that delivers on that knowledge and gives each guest their own personalized, optimal experience. From bartending, bar ownership always seemed to be his natural progression. He credits this opportunity to all the good people he has met along the way that helped lay the road that he now sets out upon.',
    ],
  },
  {
    id: 'kevin',
    name: 'Kevin Wieman',
    role: 'Executive Chef',
    photo: 'photos/kevin.webp',
    bio: [
      'Executive Chef Kevin Wieman has headed kitchens in the Delaware Valley for over 20 years, most recently as Executive Chef at The Concordville Inn in southern Delaware County. Previous to that stints at Brickside Grille in Exton and the now defunct General Lafayette Inn and Congress Rotisserie were learning and management growth experiences for him. Kevin cites his early experience working under Chef Glen Feller at South Jersey seasonal new American, Wild Orchid Cafe as the basis of his culinary education.',
      'His passion lies in the flavors that develop from homey slow roasting and braising techniques and he pulls influences from his extensive travels throughout the US and Latin America.',
    ],
  },
  {
    id: 'pier',
    name: 'Pier Mutovic',
    role: 'Proprietor',
    photo: 'photos/pier.webp',
    bio: [
      'Pier Mutovic has always been passionate about making people feel comfortable, connected and cared for – rallying friends to investigate new dining spots, assisting his family’s well-established home services company and helping clients secure their financial futures as a top-level banker. With 15+ years of planning, sales and management experience, an MBA, and a deep love for quality food, drink and hospitality, Pier is excited to create a rich and satisfying dining experience for the Old City community.',
    ],
  },
]

/**
 * The house mascot, from the Instagram grid (a Glory Beer Bar shirt: a bulldog
 * captioned "The Glorious Archibald"). Decorative only.
 */
export const MASCOT = { name: 'The Glorious Archibald', photo: 'photos/ig-archibald.webp' }

// ─── EVENTS ─────────────────────────────────────────────────────────────────

export const EVENTS = {
  title: 'Parties & Corporate Events',
  body: [
    'Glory Beer Bar & Kitchen is available for large parties and events.',
    'Our spacious dining room is large enough for a wedding or corporate event while also cozy enough for intimate smaller groups.',
  ],
  cta: 'Event Inquiry Form',
  email: 'dave@gloryphilly.com',
  /** the inquiry form's fields ("All form fields are required.") */
  fields: ['First and Last Name', 'Email', 'Phone Number', 'Date of Event', 'Summary of Event'],
  /** the site's Parties & Corporate Events slideshow, 1 / 7 … 7 / 7 */
  photos: ['photos/event-1.webp', 'photos/event-2.webp', 'photos/event-3.webp', 'photos/event-4.webp', 'photos/event-5.webp', 'photos/event-6.webp', 'photos/event-7.webp'],
}

/** A pre-filled email for the Event Inquiry Form's fields (the live form mails Dave). */
export const eventInquiryHref = () =>
  `mailto:${EVENTS.email}?subject=${encodeURIComponent('Event Inquiry')}&body=${encodeURIComponent(EVENTS.fields.map(f => `${f}: `).join('\n'))}`

/** Other photos from gloryphilly.com and the Instagram grid. */
export const PHOTOS = {
  wallSign: 'photos/wall-sign.webp',
  diningRoom: 'photos/dining-room.webp',
  mussels: 'photos/mussels.webp',
  pickleBoard: 'photos/pickle-board.webp',
  burrata: 'photos/burrata.webp',
  sidewalk: 'photos/ig-sidewalk.webp',
  flatbread: 'photos/ig-flatbread.webp',
  pecanTart: 'photos/ig-pecan-tart.webp',
  pasta: 'photos/ig-pasta.webp',
  raviolis: 'photos/ig-ravioli-mushroom.webp',
  igMussels: 'photos/ig-mussels.webp',
}

// ─── STORY ──────────────────────────────────────────────────────────────────

/** Section eyebrows + headlines (headlines are the site's own section names). */
export const SECTIONS = {
  taps: { eyebrow: 'The Bar', title: '36 beers on tap.' },
  kitchen: { eyebrow: 'The Kitchen', title: 'All Day Menu' },
  cellar: { eyebrow: 'Bottles · Wine · Cocktails', title: 'Wine & Specialty Cocktails' },
  people: { eyebrow: 'About', title: 'The people behind the bar.' },
  events: { eyebrow: 'Book an Event', title: 'Parties & Corporate Events' },
  visit: { eyebrow: 'Contact', title: 'This must be the place.' },
}

/** Contact (kept in this shape for the shared UI). */
export const CONTACT = {
  eyebrow: 'Contact',
  title: 'This must be the place.',
  href: BRAND.phoneHref,
  label: BRAND.phone,
}

/** Concept microcopy (not business claims). */
export const MICROCOPY = {
  signalEyebrow: '126 Chestnut St · Old City · Philadelphia',
  scrollHint: 'Scroll to pour',
  audio: 'Sound',
  audioOn: 'Sound on',
  audioOff: 'Sound off',
  motion: 'Motion',
  motionOn: 'Motion on',
  motionOff: 'Motion off',
  rotate: 'Turn your phone upright',
  rotateBody: 'Glory reads best held upright.',
}

export const CREDIT = { text: 'Site concept by Hark Digital Design', url: 'https://hark.digital' }
