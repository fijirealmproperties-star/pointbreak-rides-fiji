const DEFAULT_WEBSITE_CONTENT = {
  heroEyebrow: 'YOUR ISLAND. YOUR WAY.',
  heroTitle: 'Find your way',
  heroEmphasis: 'with a little more Fiji in the journey.',
  heroBody: 'A ride experience shaped by the islands we call home. Book a trip, meet your driver and get moving.',
  heroBookLabel: 'Book a ride',
  heroAboutLabel: 'Meet Pointbreak',
  heroNote: 'ISLAND SPIRIT, EVERY MILE',
  heroCardKicker: 'THE JOURNEY STARTS HERE',
  heroCardTitle: 'Where to?',
  heroPickupLabel: 'Your pickup',
  heroDestinationLabel: 'Your destination',
  heroCardButton: 'Start a ride',
  heroCardFoot: 'Simple booking. A smoother ride.',
  introLabel: 'A BETTER WAY TO GET THERE',
  introText: 'From the first hello to the final stop, make every trip feel a little more like Fiji.',
  featuresKicker: 'THE POINTBREAK FEELING',
  featuresTitle: 'The ride is part of the destination.',
  featuresLead: 'The details matter. We bring booking, trip updates and driver tools together in one easy-to-use experience.',
  ridesKicker: 'YOUR NEXT RIDE',
  ridesTitle: 'Choose your way to go.',
  ridesLead: 'Request an on-demand ride in the app, or reserve transport as a guest.',
  driverKicker: 'BEHIND THE WHEEL?',
  driverTitle: 'This ride is for drivers, too.',
  driverBody: 'Sign in to the driver app to manage your availability and ride requests.',
  driverLink: 'Driver sign in',
  bookingKicker: 'VISITING FIJI?',
  bookingTitle: 'Request transport as a guest.',
  bookingLead: 'Share your trip details and our team will review your request and contact you to confirm availability. This is a request, not a confirmed booking.',
  bookingNote: "No Pointbreak account is needed. Please allow at least 10 minutes' notice; requests can be made up to 30 days ahead.",
  bookingFormTitle: 'Tourist transport request',
  bookingLocationHint: 'Choose from saved Pointbreak locations.',
  bookingSubmitLabel: 'Send booking request',
  newsKicker: 'FROM POINTBREAK',
  newsTitle: 'Island updates & stories.',
  features: [
    { number: '01', title: 'A simpler way to ride', body: 'Set your pickup and destination, then request a ride right from the app.' },
    { number: '02', title: 'Stay in the know', body: 'Follow your ride as it moves through each step, from request to arrival.' },
    { number: '03', title: 'Made for both sides', body: 'A connected experience for riders booking trips and drivers accepting them.' },
  ],
  rides: [
    { icon: '01', title: 'On-demand rides', body: 'Ready to go? Open the rider app, set your trip details and request a ride.', label: 'BOOK A RIDE', action: 'login' },
    { icon: '02', title: 'Schedule ahead', body: 'Traveling as a guest? Share your trip details and our team will follow up to confirm availability.', label: 'REQUEST TRANSPORT', action: 'booking' },
  ],
  aboutImageId: null,
  aboutImageAlt: '',
  aboutTitle: 'Rooted in Fiji. Ready for the road.',
  aboutBody: 'Pointbreak Fiji Rides is here to make getting around feel simpler and more connected. We bring riders and drivers together with tools to arrange a trip, follow the ride and keep the journey moving.',
  aboutSecondBody: 'Wherever the road takes you, we hope the warmth and welcome of the islands come along for the ride.',
  aboutKicker: 'OUR STORY',
  aboutLink: 'Say bula',
  contactKicker: "LET'S TALK",
  contactTitle: 'Have a trip in mind?',
  contactLead: 'Questions, feedback or just want to say bula? Drop us a note.',
  contactEmail: 'pointbreakfj@gmail.com',
  contactPhone: '',
  contactEmailLabel: 'EMAIL US DIRECTLY',
  contactFoot: "We'd love to hear from you.",
  contactFormTitle: 'Reach out to us',
  contactFormHint: 'Your email app will open with your message ready to send.',
  contactFormButton: 'Open email to send',
  footerTagline: 'ISLAND SPIRIT, EVERY MILE.',
  heroImageId: null,
  theme: {
    backgroundColor: '#0A1628',
    surfaceColor: '#1A2B3D',
    accentColor: '#33AADD',
    textColor: '#FFFFFF',
    borderColor: '#2A3B4D',
    borderRadius: 12,
    backgroundImageId: null,
  },
  sectionOrder: ['home', 'features', 'rides', 'booking', 'news', 'about', 'contact'],
  links: [],
};

const SECTION_ORDER = ['home', 'features', 'rides', 'booking', 'news', 'about', 'contact'];
const THEME_COLORS = ['backgroundColor', 'surfaceColor', 'accentColor', 'textColor', 'borderColor'];

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isSafeWebsiteLink(value) {
  if (/^#(?:home|features|rides|booking|news|about|contact)$/.test(value)) return true;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)) return true;
  if (/^tel:\+?[0-9(). -]{3,30}$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateWebsiteContent(input, db) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Website content must be an object' };
  }
  const content = {
    heroEyebrow: cleanText(input.heroEyebrow, 100),
    heroTitle: cleanText(input.heroTitle, 100),
    heroEmphasis: cleanText(input.heroEmphasis, 140),
    heroBody: cleanText(input.heroBody, 500),
    heroBookLabel: cleanText(input.heroBookLabel, 40),
    heroAboutLabel: cleanText(input.heroAboutLabel, 40),
    heroNote: cleanText(input.heroNote, 100),
    heroCardKicker: cleanText(input.heroCardKicker, 100),
    heroCardTitle: cleanText(input.heroCardTitle, 80),
    heroPickupLabel: cleanText(input.heroPickupLabel, 80),
    heroDestinationLabel: cleanText(input.heroDestinationLabel, 80),
    heroCardButton: cleanText(input.heroCardButton, 40),
    heroCardFoot: cleanText(input.heroCardFoot, 140),
    introLabel: cleanText(input.introLabel, 100),
    introText: cleanText(input.introText, 500),
    featuresKicker: cleanText(input.featuresKicker, 100),
    featuresTitle: cleanText(input.featuresTitle, 160),
    featuresLead: cleanText(input.featuresLead, 500),
    ridesKicker: cleanText(input.ridesKicker, 100),
    ridesTitle: cleanText(input.ridesTitle, 160),
    ridesLead: cleanText(input.ridesLead, 500),
    driverKicker: cleanText(input.driverKicker, 100),
    driverTitle: cleanText(input.driverTitle, 140),
    driverBody: cleanText(input.driverBody, 500),
    driverLink: cleanText(input.driverLink, 40),
    bookingKicker: cleanText(input.bookingKicker, 100),
    bookingTitle: cleanText(input.bookingTitle, 140),
    bookingLead: cleanText(input.bookingLead, 800),
    bookingNote: cleanText(input.bookingNote, 500),
    bookingFormTitle: cleanText(input.bookingFormTitle, 100),
    bookingLocationHint: cleanText(input.bookingLocationHint, 200),
    bookingSubmitLabel: cleanText(input.bookingSubmitLabel, 40),
    newsKicker: cleanText(input.newsKicker, 100),
    newsTitle: cleanText(input.newsTitle, 160),
    aboutTitle: cleanText(input.aboutTitle, 160),
    aboutBody: cleanText(input.aboutBody, 1000),
    aboutSecondBody: cleanText(input.aboutSecondBody, 1000),
    aboutKicker: cleanText(input.aboutKicker, 100),
    aboutLink: cleanText(input.aboutLink, 40),
    contactKicker: cleanText(input.contactKicker, 100),
    contactTitle: cleanText(input.contactTitle, 120),
    contactLead: cleanText(input.contactLead, 500),
    contactEmail: cleanText(input.contactEmail, 254).toLowerCase(),
    contactPhone: cleanText(input.contactPhone, 30),
    contactEmailLabel: cleanText(input.contactEmailLabel, 80),
    contactFoot: cleanText(input.contactFoot, 200),
    contactFormTitle: cleanText(input.contactFormTitle, 100),
    contactFormHint: cleanText(input.contactFormHint, 200),
    contactFormButton: cleanText(input.contactFormButton, 40),
    footerTagline: cleanText(input.footerTagline, 100),
    heroImageId: input.heroImageId == null || input.heroImageId === '' ? null : cleanText(input.heroImageId, 80),
    theme: {},
    sectionOrder: [],
    aboutImageId: input.aboutImageId == null || input.aboutImageId === '' ? null : cleanText(input.aboutImageId, 80),
    aboutImageAlt: cleanText(input.aboutImageAlt, 200),
    links: [],
  };
  for (const key of Object.keys(content).filter((key) => !['heroImageId', 'aboutImageId', 'aboutImageAlt', 'contactPhone', 'theme', 'sectionOrder', 'links'].includes(key))) {
    if (!content[key]) return { error: `${key} is required` };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content.contactEmail)) {
    return { error: 'Enter a valid contact email address' };
  }
  if (content.contactPhone &&
      (!/^\+?[0-9(). -]{2,29}$/.test(content.contactPhone) || !/\d/.test(content.contactPhone))) {
    return { error: 'Enter a valid contact phone number' };
  }
  if (input.heroImageId && !db.prepare('SELECT id FROM website_media WHERE id=?').get(content.heroImageId)) {
    return { error: 'The selected hero photo does not exist' };
  }
  if (content.aboutImageId && !db.prepare('SELECT id FROM website_media WHERE id=?').get(content.aboutImageId)) {
    return { error: 'The selected About photo does not exist' };
  }
  const themeInput = input.theme == null ? DEFAULT_WEBSITE_CONTENT.theme : input.theme;
  if (!themeInput || typeof themeInput !== 'object' || Array.isArray(themeInput)) {
    return { error: 'Website theme must be an object' };
  }
  for (const key of THEME_COLORS) {
    const value = themeInput[key] == null ? DEFAULT_WEBSITE_CONTENT.theme[key] : cleanText(themeInput[key], 7);
    if (!/^#[0-9a-f]{6}$/i.test(value)) return { error: `${key} must be a six-digit hex color` };
    content.theme[key] = value.toUpperCase();
  }
  const borderRadius = themeInput.borderRadius == null
    ? DEFAULT_WEBSITE_CONTENT.theme.borderRadius
    : Number(themeInput.borderRadius);
  if (!Number.isInteger(borderRadius) || borderRadius < 0 || borderRadius > 32) {
    return { error: 'Border radius must be a whole number between 0 and 32' };
  }
  content.theme.borderRadius = borderRadius;
  content.theme.backgroundImageId = themeInput.backgroundImageId == null || themeInput.backgroundImageId === ''
    ? null
    : cleanText(themeInput.backgroundImageId, 80);
  if (content.theme.backgroundImageId &&
      !db.prepare('SELECT id FROM website_media WHERE id=?').get(content.theme.backgroundImageId)) {
    return { error: 'The selected background photo does not exist' };
  }
  const sectionOrder = input.sectionOrder == null ? DEFAULT_WEBSITE_CONTENT.sectionOrder : input.sectionOrder;
  if (!Array.isArray(sectionOrder) || sectionOrder.length !== SECTION_ORDER.length ||
      new Set(sectionOrder).size !== SECTION_ORDER.length ||
      sectionOrder.some((section) => !SECTION_ORDER.includes(section))) {
    return { error: 'Choose a valid order for every website section' };
  }
  content.sectionOrder = sectionOrder;
  const links = input.links == null ? [] : input.links;
  if (!Array.isArray(links) || links.length > 8) return { error: 'Add no more than 8 custom links' };
  content.links = links.map((link) => ({
    label: cleanText(link && link.label, 40),
    url: cleanText(link && link.url, 300),
  }));
  if (content.links.some((link) => !link.label || !link.url || !isSafeWebsiteLink(link.url))) {
    return { error: 'Each custom link needs a label and a safe URL (https, http, email, phone, or section link)' };
  }
  if (!Array.isArray(input.features) || input.features.length !== 3) {
    return { error: 'Add exactly 3 feature cards' };
  }
  content.features = input.features.map((feature, index) => ({
    number: String(index + 1).padStart(2, '0'),
    title: cleanText(feature && feature.title, 100),
    body: cleanText(feature && feature.body, 500),
  }));
  if (content.features.some((feature) => !feature.title || !feature.body)) {
    return { error: 'Every feature needs a title and description' };
  }
  if (!Array.isArray(input.rides) || input.rides.length !== 2) {
    return { error: 'Add exactly 2 ride options' };
  }
  content.rides = input.rides.map((ride, index) => ({
    icon: String(index + 1).padStart(2, '0'),
    title: cleanText(ride && ride.title, 100),
    body: cleanText(ride && ride.body, 500),
    label: cleanText(ride && ride.label, 40).toUpperCase(),
    action: index === 0 ? 'login' : 'booking',
  }));
  if (content.rides.some((ride) => !ride.title || !ride.body || !ride.label)) {
    return { error: 'Every ride option needs a title, description and button label' };
  }
  return { content };
}

module.exports = { DEFAULT_WEBSITE_CONTENT, validateWebsiteContent };
