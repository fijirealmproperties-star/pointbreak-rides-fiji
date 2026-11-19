import { createElement, type ChangeEvent, type CSSProperties, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { api, getApiUrl, Place } from "../api";
import PlacePicker from "../components/PlacePicker";
import { loadPlaces, PLACES } from "../places";

const HERO_IMAGE = require("../../assets/pointbreak-logo.png");
const FIJI_HOURLY_TIMES = Array.from(
  { length: 24 },
  (_, hour) => `${String(hour).padStart(2, "0")}:00`
);
type Section = "features" | "shop" | "booking" | "news" | "about" | "contact";
type SiteLink = { label: string; url: string };
type SectionOrder = Array<"home" | "features" | "rides" | "booking" | "news" | "about" | "contact">;

const webDateTimeInputStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  height: 43,
  marginBottom: 10,
  padding: "12px 13px",
  border: "1px solid #2A3B4D",
  borderRadius: 10,
  backgroundColor: "#0A1628",
  color: "#FFFFFF",
  fontFamily: "inherit",
  fontSize: 13,
};

const DEFAULT_SITE_CONTENT = {
  heroEyebrow: "YOUR ISLAND. YOUR WAY.",
  heroTitle: "Find your way",
  heroEmphasis: "with a little more Fiji in the journey.",
  heroBody: "A ride experience shaped by the islands we call home. Book a trip, meet your driver and get moving.",
  heroBookLabel: "Book a ride",
  heroAboutLabel: "Meet Pointbreak",
  heroNote: "ISLAND SPIRIT, EVERY MILE",
  heroCardKicker: "THE JOURNEY STARTS HERE",
  heroCardTitle: "Where to?",
  heroPickupLabel: "Your pickup",
  heroDestinationLabel: "Your destination",
  heroCardButton: "Start a ride",
  heroCardFoot: "Simple booking. A smoother ride.",
  introLabel: "A BETTER WAY TO GET THERE",
  introText: "From the first hello to the final stop, make every trip feel a little more like Fiji.",
  featuresKicker: "THE POINTBREAK FEELING",
  featuresTitle: "The ride is part of the destination.",
  featuresLead: "The details matter. We bring booking, trip updates and driver tools together in one easy-to-use experience.",
  ridesKicker: "YOUR NEXT RIDE",
  ridesTitle: "Choose your way to go.",
  ridesLead: "Request an on-demand ride in the app, or reserve transport as a guest.",
  driverKicker: "BEHIND THE WHEEL?",
  driverTitle: "This ride is for drivers, too.",
  driverBody: "Sign in to the driver app to manage your availability and ride requests.",
  driverLink: "Driver sign in",
  bookingKicker: "VISITING FIJI?",
  bookingTitle: "Request transport as a guest.",
  bookingLead: "Share your trip details and our team will review your request and contact you to confirm availability. This is a request, not a confirmed booking.",
  bookingNote: "No Pointbreak account is needed. Please allow at least 10 minutes' notice; requests can be made up to 30 days ahead.",
  bookingFormTitle: "Tourist transport request",
  bookingLocationHint: "Choose from saved Pointbreak locations.",
  bookingSubmitLabel: "Send booking request",
  newsKicker: "FROM POINTBREAK",
  newsTitle: "Island updates & stories.",
  features: [
    { number: "01", title: "A simpler way to ride", body: "Set your pickup and destination, then request a ride right from the app." },
    { number: "02", title: "Stay in the know", body: "Follow your ride as it moves through each step, from request to arrival." },
    { number: "03", title: "Made for both sides", body: "A connected experience for riders booking trips and drivers accepting them." },
  ],
  rides: [
    { icon: "01", title: "On-demand rides", body: "Ready to go? Open the rider app, set your trip details and request a ride.", label: "BOOK A RIDE", action: "login" },
    { icon: "02", title: "Schedule ahead", body: "Traveling as a guest? Share your trip details and our team will follow up to confirm availability.", label: "REQUEST TRANSPORT", action: "booking" },
  ],
  aboutImageId: null as string | null,
  aboutImageUrl: null as string | null,
  aboutImageAlt: "",
  aboutTitle: "Rooted in Fiji. Ready for the road.",
  aboutBody: "Pointbreak Fiji Rides is here to make getting around feel simpler and more connected. We bring riders and drivers together with tools to arrange a trip, follow the ride and keep the journey moving.",
  aboutSecondBody: "Wherever the road takes you, we hope the warmth and welcome of the islands come along for the ride.",
  aboutKicker: "OUR STORY",
  aboutLink: "Say bula",
  contactKicker: "LET'S TALK",
  contactTitle: "Have a trip in mind?",
  contactLead: "Questions, feedback or just want to say bula? Drop us a note.",
  contactEmail: "pointbreakfj@gmail.com",
  contactPhone: "",
  contactEmailLabel: "EMAIL US DIRECTLY",
  contactFoot: "We'd love to hear from you.",
  contactFormTitle: "Reach out to us",
  contactFormHint: "Your email app will open with your message ready to send.",
  contactFormButton: "Open email to send",
  footerTagline: "ISLAND SPIRIT, EVERY MILE.",
  heroImageId: null as string | null,
  heroImageUrl: null as string | null,
  theme: {
    backgroundColor: "#0A1628",
    surfaceColor: "#1A2B3D",
    accentColor: "#33AADD",
    textColor: "#FFFFFF",
    borderColor: "#2A3B4D",
    borderRadius: 12,
    backgroundImageId: null as string | null,
    backgroundImageUrl: null as string | null,
  },
  sectionOrder: ["home", "features", "rides", "booking", "news", "about", "contact"] as SectionOrder,
  links: [] as SiteLink[],
};
type SiteContent = typeof DEFAULT_SITE_CONTENT;
type WebsitePost = {
  id: string;
  title: string;
  summary: string;
  body: string;
  image_alt: string;
  imageUrl: string | null;
  published_at: string;
};

function normalizeSiteContent(content: Partial<SiteContent>): SiteContent {
  return {
    ...DEFAULT_SITE_CONTENT,
    ...content,
    features: content.features?.length === 3 ? content.features : DEFAULT_SITE_CONTENT.features,
    rides: content.rides?.length === 2 ? content.rides : DEFAULT_SITE_CONTENT.rides,
    theme: { ...DEFAULT_SITE_CONTENT.theme, ...content.theme },
    sectionOrder: content.sectionOrder?.length === DEFAULT_SITE_CONTENT.sectionOrder.length
      ? content.sectionOrder
      : DEFAULT_SITE_CONTENT.sectionOrder,
    links: Array.isArray(content.links) ? content.links : DEFAULT_SITE_CONTENT.links,
  };
}

function websiteImageUri(url: string): string {
  if (url.startsWith("data:") || url.startsWith("blob:") || /^https?:\/\//.test(url)) return url;
  return `${getApiUrl()}${url}`;
}

function isSafeSiteLink(url: string): boolean {
  if (/^#(?:home|features|rides|booking|news|about|contact)$/.test(url)) return true;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(url)) return true;
  if (/^tel:\+?[0-9(). -]{3,30}$/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !!parsed.hostname && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export default function PublicLanding({ onContinue }: { onContinue: () => void }) {
  const { width } = useWindowDimensions();
  const wide = width >= 980;
  const scroll = useRef<ScrollView>(null);
  const [offsets, setOffsets] = useState<Partial<Record<Section, number>>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [formStatus, setFormStatus] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestPickup, setGuestPickup] = useState("");
  const [guestDropoff, setGuestDropoff] = useState("");
  const [guestDate, setGuestDate] = useState("");
  const [guestTime, setGuestTime] = useState("");
  const [guestPassengers, setGuestPassengers] = useState("1");
  const [guestNotes, setGuestNotes] = useState("");
  const [guestBookingStatus, setGuestBookingStatus] = useState("");
  const [submittingGuestBooking, setSubmittingGuestBooking] = useState(false);
  const [places, setPlaces] = useState<Place[]>(PLACES);
  const [placePickerOpen, setPlacePickerOpen] = useState<"pickup" | "dropoff" | null>(null);
  const [siteContent, setSiteContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [newsPosts, setNewsPosts] = useState<WebsitePost[]>([]);
  const builderPreviewReceived = useRef(false);
  const builderPreviewImages = useRef<{ hero: string | null; about: string | null; background: string | null; post: string | null }>({
    hero: null,
    about: null,
    background: null,
    post: null,
  });
  const theme = siteContent.theme;
  const surfMotion = useRef(new Animated.Value(0)).current;
  const today = new Date();
  const earliestBookingDate = formatDate(today);
  const latestBookingDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);

  useEffect(() => {
    loadPlaces().then(setPlaces);
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${getApiUrl()}/api/website`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active || !data || builderPreviewReceived.current) return;
        setSiteContent(normalizeSiteContent(data.content || {}));
        setNewsPosts(Array.isArray(data.posts) ? data.posts : []);
      })
      .catch(() => {
        // Keep the bundled homepage copy available if the website API is offline.
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window ||
        new URLSearchParams(window.location.search).get("websiteBuilderPreview") !== "1") {
      return;
    }

    function receivePreview(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const payload = event.data as {
        type?: string;
        content?: Partial<SiteContent>;
        posts?: WebsitePost[];
        target?: "hero" | "about" | "background" | "post";
        url?: string | null;
      } | null;
      if (payload?.type === "pointbreak-website-builder-image") {
        if (!payload.target || !(payload.url === null ||
            (typeof payload.url === "string" && /^data:image\/(?:jpeg|png|webp);base64,/.test(payload.url)))) return;
        builderPreviewImages.current[payload.target] = payload.url;
        return;
      }
      if (payload?.type !== "pointbreak-website-builder-preview" || !payload.content) return;

      builderPreviewReceived.current = true;
      const content = { ...payload.content };
      if (content.heroImageUrl === "website-builder-preview:hero") {
        content.heroImageUrl = builderPreviewImages.current.hero;
      }
      if (content.aboutImageUrl === "website-builder-preview:about") {
        content.aboutImageUrl = builderPreviewImages.current.about;
      }
      const theme = { ...DEFAULT_SITE_CONTENT.theme, ...content.theme };
      if (theme.backgroundImageUrl === "website-builder-preview:background") {
        theme.backgroundImageUrl = builderPreviewImages.current.background;
      }
      const posts = Array.isArray(payload.posts)
        ? payload.posts.map((post) => post.imageUrl === "website-builder-preview:post"
          ? { ...post, imageUrl: builderPreviewImages.current.post }
          : post)
        : [];
      setSiteContent(normalizeSiteContent({ ...content, theme }));
      setNewsPosts(posts);
    }

    window.addEventListener("message", receivePreview);
    return () => window.removeEventListener("message", receivePreview);
  }, []);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionPreview =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("motion") === "on";
    if (prefersReducedMotion && !motionPreview) {
      return;
    }

    const surfAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(surfMotion, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(surfMotion, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    surfAnimation.start();
    return () => surfAnimation.stop();
  }, [surfMotion]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const sectionIds: Record<SectionOrder[number], string[]> = {
      home: ["website-section-home-hero", "website-section-home-intro"],
      features: ["website-section-features"],
      rides: ["website-section-rides"],
      booking: ["website-section-booking"],
      news: ["website-section-news"],
      about: ["website-section-about"],
      contact: ["website-section-contact"],
    };
    siteContent.sectionOrder.forEach((section, index) => {
      sectionIds[section].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.style.order = String(index);
      });
    });
  }, [siteContent.sectionOrder]);

  const surfX = surfMotion.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] });
  const surfY = surfMotion.interpolate({ inputRange: [0, 1], outputRange: [-13, 13] });
  const surfTilt = surfMotion.interpolate({ inputRange: [0, 1], outputRange: ["-1deg", "1deg"] });
  const surfScale = surfMotion.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });

  function rememberOffset(section: Section, y: number) {
    setOffsets((current) => ({ ...current, [section]: y }));
  }

  function goTo(section: Section) {
    const y = offsets[section];
    if (y != null) scroll.current?.scrollTo({ y: Math.max(0, y - 22), animated: true });
  }

  function openCustomLink(link: SiteLink) {
    if (!isSafeSiteLink(link.url)) return;
    if (link.url.startsWith("#")) {
      const section = link.url.slice(1);
      if (section === "home") {
        scroll.current?.scrollTo({ y: 0, animated: true });
      } else if (section === "rides") {
        goTo("shop");
      } else if (section === "features" || section === "booking" || section === "news" ||
          section === "about" || section === "contact") {
        goTo(section);
      }
      return;
    }
    Linking.openURL(link.url);
  }

  async function sendMessage() {
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanMessage = message.trim();
    if (!cleanName || !cleanEmail || !cleanMessage) {
      setFormStatus("Please fill in your name, email and message.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFormStatus("Please enter a valid email address.");
      return;
    }
    const subject = encodeURIComponent(`Website enquiry from ${cleanName}`);
    const body = encodeURIComponent(
      `Name: ${cleanName}\nReply to: ${cleanEmail}\n\n${cleanMessage}`
    );
    try {
      await Linking.openURL(`mailto:${siteContent.contactEmail}?subject=${subject}&body=${body}`);
      setFormStatus("Your email app is opening with your message ready to send.");
    } catch {
      setFormStatus(`Couldn't open an email app. You can email us directly at ${siteContent.contactEmail}.`);
    }
  }

  async function submitGuestBooking() {
    if (submittingGuestBooking) return;
    setGuestBookingStatus("");
    setSubmittingGuestBooking(true);
    try {
      const { booking } = await api<{ booking: { id: string } }>("/guest-bookings", {
        method: "POST",
        body: {
          name: guestName,
          email: guestEmail,
          phone: guestPhone,
          pickup: guestPickup,
          dropoff: guestDropoff,
          date: guestDate,
          time: guestTime,
          passengers: Number(guestPassengers),
          notes: guestNotes,
        },
      });
      setGuestBookingStatus(`Request ${booking.id.slice(0, 8)} sent. Our team will contact you to confirm availability.`);
      setGuestName("");
      setGuestEmail("");
      setGuestPhone("");
      setGuestPickup("");
      setGuestDropoff("");
      setGuestDate("");
      setGuestTime("");
      setGuestPassengers("1");
      setGuestNotes("");
    } catch (error) {
      setGuestBookingStatus(error instanceof Error ? error.message : "Could not send your request. Please try again.");
    } finally {
      setSubmittingGuestBooking(false);
    }
  }

  const surfaceThemeStyle = {
    backgroundColor: theme.surfaceColor,
    borderColor: theme.borderColor,
    borderRadius: theme.borderRadius,
  };
  const accentThemeStyle = {
    backgroundColor: theme.accentColor,
    borderRadius: theme.borderRadius,
  };

  return (
    <View style={[styles.pageShell, { backgroundColor: theme.backgroundColor }]}>
      {theme.backgroundImageUrl ? (
        <Image
          source={{ uri: websiteImageUri(theme.backgroundImageUrl) }}
          resizeMode="cover"
          style={styles.pageBackgroundImage}
        />
      ) : null}
      <ScrollView
        ref={scroll}
        style={[styles.page, { backgroundColor: "transparent" }]}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
      <View style={[styles.header, { maxWidth: 1180, backgroundColor: theme.backgroundColor, borderBottomColor: theme.borderColor }]}>
        <TouchableOpacity style={styles.brand} onPress={() => scroll.current?.scrollTo({ y: 0, animated: true })}>
          <View style={[styles.brandMark, { backgroundColor: theme.accentColor, borderRadius: theme.borderRadius }]}><Text style={styles.brandMarkText}>P</Text></View>
          <View>
            <Text style={styles.brandName}>POINTBREAK</Text>
            <Text style={styles.brandSub}>FIJI RIDES</Text>
          </View>
        </TouchableOpacity>
        {wide ? (
          <View style={[styles.nav, { flexWrap: "wrap", justifyContent: "center" }]}>
            <TouchableOpacity onPress={() => goTo("features")}><Text style={[styles.navText, { color: theme.textColor }]}>Why Pointbreak</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => goTo("shop")}><Text style={[styles.navText, { color: theme.textColor }]}>Ride options</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => goTo("booking")}><Text style={[styles.navText, { color: theme.textColor }]}>Book a ride</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => goTo("about")}><Text style={[styles.navText, { color: theme.textColor }]}>Our story</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => goTo("contact")}><Text style={[styles.navText, { color: theme.textColor }]}>Contact</Text></TouchableOpacity>
            {siteContent.links.map((link, index) => (
              <TouchableOpacity key={`${link.url}-${index}`} onPress={() => openCustomLink(link)}>
                <Text style={[styles.navText, { color: theme.textColor }]}>{link.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        <TouchableOpacity style={[styles.headerButton, accentThemeStyle]} onPress={onContinue}>
          <Text style={styles.headerButtonText}>Rider / Driver login</Text>
        </TouchableOpacity>
      </View>

      <View nativeID="website-section-home-hero" style={[styles.heroOuter, { maxWidth: 1180, minHeight: wide ? 520 : 610 }]}>
        <View style={[styles.hero, surfaceThemeStyle]}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.heroArtworkLayer,
              { transform: [{ translateX: surfX }, { translateY: surfY }, { rotate: surfTilt }, { scale: surfScale }] },
            ]}
          >
            <Image
              source={siteContent.heroImageUrl ? { uri: websiteImageUri(siteContent.heroImageUrl) } : HERO_IMAGE}
              resizeMode="contain"
              style={[styles.heroImage, { borderRadius: theme.borderRadius }]}
            />
            <View style={styles.heroLicensePlate}>
              <Text style={styles.heroLicenseText}>FIJI</Text>
            </View>
          </Animated.View>
          <View style={styles.heroShade} />
          <View style={[styles.heroInner, wide ? styles.heroInnerWide : null]}>
            <View style={styles.heroCopy}>
              <View style={styles.eyebrow}>
                <View style={styles.eyebrowDot} />
                <Text style={[styles.eyebrowText, { color: theme.textColor }]}>{siteContent.heroEyebrow}</Text>
              </View>
              <Text style={[styles.heroTitle, { fontSize: wide ? 56 : 42, lineHeight: wide ? 64 : 50, color: theme.textColor }]}>
                {siteContent.heroTitle}{'\n'}<Text style={[styles.heroEmphasis, { color: theme.accentColor }]}>{siteContent.heroEmphasis}</Text>
              </Text>
              <Text style={[styles.heroBody, { color: theme.textColor }]}>{siteContent.heroBody}</Text>
              <View style={[styles.heroActions, !wide ? styles.heroActionsMobile : null]}>
                <TouchableOpacity style={[styles.primaryButton, accentThemeStyle]} onPress={() => goTo("booking")}>
                  <Text style={styles.primaryButtonText}>{siteContent.heroBookLabel} <Text style={styles.buttonArrow}>→</Text></Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => goTo("about")}>
                  <Text style={styles.secondaryButtonText}>{siteContent.heroAboutLabel}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.heroNote}>
                <Text style={styles.heroNoteLine}>──────</Text>
                <Text style={styles.heroNoteText}>{siteContent.heroNote}</Text>
              </View>
            </View>
            {wide ? (
              <View style={[styles.heroCard, surfaceThemeStyle]}>
                <Text style={styles.heroCardKicker}>{siteContent.heroCardKicker}</Text>
                <Text style={styles.heroCardTitle}>{siteContent.heroCardTitle}</Text>
                <View style={styles.routeRow}>
                  <View style={styles.routeDots}><View style={styles.routeDot} /><View style={styles.routeLine} /><View style={styles.routeDotEnd} /></View>
                  <View style={styles.routeLabels}>
                    <Text style={styles.routeLabel}>{siteContent.heroPickupLabel}</Text>
                    <View style={styles.routeDivider} />
                    <Text style={styles.routeLabel}>{siteContent.heroDestinationLabel}</Text>
                  </View>
                </View>
                <TouchableOpacity style={[styles.heroCardButton, accentThemeStyle]} onPress={() => goTo("booking")}>
                  <Text style={styles.heroCardButtonText}>{siteContent.heroCardButton} <Text>→</Text></Text>
                </TouchableOpacity>
                <Text style={styles.heroCardFoot}>{siteContent.heroCardFoot}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.heroStamp}>
            <Text style={styles.heroStampTop}>FIJI</Text>
            <Text style={styles.heroStampBottom}>17° 42′ S</Text>
          </View>
        </View>
      </View>

      <View nativeID="website-section-home-intro" style={[styles.introBand, { backgroundColor: theme.surfaceColor }]}>
        <View style={[styles.introInner, { maxWidth: 1120 }, wide ? styles.introInnerWide : null]}>
          <Text style={[styles.introLabel, { color: theme.accentColor }]}>{siteContent.introLabel}</Text>
          <Text style={[styles.introText, { color: theme.textColor }, wide ? { maxWidth: 720 } : null]}>
            {siteContent.introText}
          </Text>
          <Text style={styles.introOrnament}>◇  ·  ◇  ·  ◇</Text>
        </View>
      </View>

      <View
        nativeID="website-section-features"
        onLayout={(event) => rememberOffset("features", event.nativeEvent.layout.y)}
        style={[styles.section, { backgroundColor: theme.backgroundColor }]}
      >
        <View style={[styles.sectionInner, { maxWidth: 1120 }]}>
          <View style={[styles.sectionHeading, wide ? styles.sectionHeadingWide : null]}>
            <View style={styles.headingCopy}>
              <Text style={[styles.kicker, { color: theme.accentColor }]}>{siteContent.featuresKicker}</Text>
              <Text style={[styles.sectionTitle, { color: theme.textColor }]}>{siteContent.featuresTitle}</Text>
            </View>
            <Text style={[styles.sectionLead, { color: theme.textColor }]}>{siteContent.featuresLead}</Text>
          </View>
          <View style={[styles.featureGrid, wide ? styles.cardRowWide : null]}>
            {siteContent.features.map((feature) => (
              <View key={feature.number} style={[styles.featureCard, surfaceThemeStyle, wide ? styles.featureCardWide : null]}>
                <View style={styles.featureTop}>
                  <Text style={styles.featureNumber}>{feature.number}</Text>
                  <View style={styles.featureRule} />
                  <Text style={styles.featureGlyph}>{feature.number === "01" ? "↗" : feature.number === "02" ? "◎" : "◇"}</Text>
                </View>
                <Text style={[styles.featureTitle, { color: theme.textColor }]}>{feature.title}</Text>
                <Text style={[styles.featureBody, { color: theme.textColor }]}>{feature.body}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View
        nativeID="website-section-rides"
        onLayout={(event) => rememberOffset("shop", event.nativeEvent.layout.y)}
        style={[styles.shopSection, { backgroundColor: theme.accentColor }]}
      >
        <View style={[styles.sectionInner, { maxWidth: 1120 }]}>
          <View style={[styles.shopHeading, wide ? styles.sectionHeadingWide : null]}>
            <View style={styles.headingCopy}>
              <Text style={[styles.kickerLight, { color: theme.textColor }]}>{siteContent.ridesKicker}</Text>
              <Text style={[styles.shopTitle, { color: theme.textColor }]}>{siteContent.ridesTitle}</Text>
            </View>
            <Text style={[styles.shopLead, { color: theme.textColor }]}>{siteContent.ridesLead}</Text>
          </View>
          <View style={[styles.rideGrid, wide ? styles.cardRowWide : null]}>
            {siteContent.rides.map((option) => (
              <TouchableOpacity
                key={option.title}
                accessibilityRole="button"
                onPress={option.action === "booking" ? () => goTo("booking") : onContinue}
                style={[styles.rideCard, surfaceThemeStyle, wide ? styles.rideCardWide : null]}
              >
                <View style={styles.rideCardTop}>
                  <View style={styles.rideIcon}><Text style={styles.rideIconText}>{option.icon}</Text></View>
                  <Text style={styles.rideArrow}>↗</Text>
                </View>
                <Text style={[styles.rideTitle, { color: theme.textColor }]}>{option.title}</Text>
                <Text style={[styles.rideBody, { color: theme.textColor }]}>{option.body}</Text>
                <Text style={styles.rideLink}>{option.label} <Text>→</Text></Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={[styles.driverBanner, surfaceThemeStyle]}>
            <View style={styles.driverBannerCopy}>
              <Text style={styles.driverBannerKicker}>{siteContent.driverKicker}</Text>
              <Text style={[styles.driverBannerTitle, { color: theme.textColor }]}>{siteContent.driverTitle}</Text>
              <Text style={[styles.driverBannerBody, { color: theme.textColor }]}>{siteContent.driverBody}</Text>
            </View>
            <TouchableOpacity style={styles.driverBannerButton} onPress={onContinue}>
              <Text style={styles.driverBannerButtonText}>{siteContent.driverLink} <Text>→</Text></Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View
        nativeID="website-section-booking"
        onLayout={(event) => rememberOffset("booking", event.nativeEvent.layout.y)}
        style={[styles.bookingSection, { backgroundColor: theme.backgroundColor }]}
      >
        <View style={[styles.bookingInner, { maxWidth: 1120 }, wide ? styles.bookingInnerWide : null]}>
          <View style={styles.bookingCopy}>
            <Text style={[styles.kicker, { color: theme.accentColor }]}>{siteContent.bookingKicker}</Text>
            <Text style={[styles.bookingTitle, { color: theme.textColor }]}>{siteContent.bookingTitle}</Text>
            <Text style={[styles.bookingLead, { color: theme.textColor }]}>{siteContent.bookingLead}</Text>
            <Text style={[styles.bookingNote, { color: theme.textColor }]}>{siteContent.bookingNote}</Text>
          </View>
          <View style={[styles.bookingForm, surfaceThemeStyle]}>
            <Text style={[styles.formTitle, { color: theme.textColor }]}>{siteContent.bookingFormTitle}</Text>
            <TextInput style={[styles.input, surfaceThemeStyle, { backgroundColor: theme.backgroundColor, color: theme.textColor }]} placeholder="Traveler's full name" placeholderTextColor="#8899AA" value={guestName} onChangeText={setGuestName} accessibilityLabel="Traveler's full name" autoComplete="name" />
            <TextInput style={[styles.input, surfaceThemeStyle, { backgroundColor: theme.backgroundColor, color: theme.textColor }]} placeholder="Email address" placeholderTextColor="#8899AA" value={guestEmail} onChangeText={setGuestEmail} accessibilityLabel="Email address" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <TextInput style={[styles.input, surfaceThemeStyle, { backgroundColor: theme.backgroundColor, color: theme.textColor }]} placeholder="Phone / WhatsApp (include country code)" placeholderTextColor="#8899AA" value={guestPhone} onChangeText={setGuestPhone} accessibilityLabel="Phone or WhatsApp number" keyboardType="phone-pad" autoComplete="tel" />
            <Text style={styles.bookingFieldHint}>{siteContent.bookingLocationHint}</Text>
            <View style={wide ? styles.bookingRow : null}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Pickup location${guestPickup ? `: ${guestPickup}` : ", choose from list"}`}
                accessibilityState={{ expanded: placePickerOpen === "pickup" }}
                style={[styles.input, styles.bookingHalf, styles.locationSelect, surfaceThemeStyle, { backgroundColor: theme.backgroundColor }]}
                onPress={() => setPlacePickerOpen("pickup")}
              >
                <Text style={guestPickup ? styles.locationSelected : styles.locationPlaceholder}>{guestPickup || "Select pickup location"}</Text>
                <Text style={styles.locationChevron}>⌄</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Destination${guestDropoff ? `: ${guestDropoff}` : ", choose from list"}`}
                accessibilityState={{ expanded: placePickerOpen === "dropoff" }}
                style={[styles.input, styles.bookingHalf, styles.locationSelect, surfaceThemeStyle, { backgroundColor: theme.backgroundColor }]}
                onPress={() => setPlacePickerOpen("dropoff")}
              >
                <Text style={guestDropoff ? styles.locationSelected : styles.locationPlaceholder}>{guestDropoff || "Select destination"}</Text>
                <Text style={styles.locationChevron}>⌄</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.bookingRow}>
              {Platform.OS === "web" ? (
                createElement("input", {
                  type: "date",
                  value: guestDate,
                  min: earliestBookingDate,
                  max: formatDate(latestBookingDate),
                  "aria-label": "Travel date",
                  onChange: (event) => setGuestDate(event.currentTarget.value),
                  style: { ...webDateTimeInputStyle, flex: 1, backgroundColor: theme.backgroundColor, color: theme.textColor, borderColor: theme.borderColor, borderRadius: theme.borderRadius },
                })
              ) : (
                <TextInput style={[styles.input, styles.bookingHalf, surfaceThemeStyle, { backgroundColor: theme.backgroundColor, color: theme.textColor }]} placeholder="Date (YYYY-MM-DD)" placeholderTextColor="#8899AA" value={guestDate} onChangeText={setGuestDate} accessibilityLabel="Travel date, year month day" />
              )}
              {Platform.OS === "web" ? (
                createElement("select", {
                  value: guestTime,
                  "aria-label": "Travel time in Fiji, 24-hour format",
                  onChange: (event: ChangeEvent<HTMLSelectElement>) => setGuestTime(event.currentTarget.value),
                  style: { ...webDateTimeInputStyle, flex: 1, backgroundColor: theme.backgroundColor, color: theme.textColor, borderColor: theme.borderColor, borderRadius: theme.borderRadius },
                },
                  createElement("option", { value: "" }, "Choose a time (Fiji, 24-hour)"),
                  ...FIJI_HOURLY_TIMES.map((time) =>
                    createElement("option", { key: time, value: time }, time)
                  )
                )
              ) : (
                <TextInput style={[styles.input, styles.bookingHalf, surfaceThemeStyle, { backgroundColor: theme.backgroundColor, color: theme.textColor }]} placeholder="Time in Fiji (HH:MM)" placeholderTextColor="#8899AA" value={guestTime} onChangeText={setGuestTime} accessibilityLabel="Travel time in Fiji, hours and minutes" />
              )}
            </View>
            <TextInput style={[styles.input, surfaceThemeStyle, { backgroundColor: theme.backgroundColor, color: theme.textColor }]} placeholder="Number of passengers (1–15)" placeholderTextColor="#8899AA" value={guestPassengers} onChangeText={setGuestPassengers} accessibilityLabel="Number of passengers" keyboardType="number-pad" />
            <TextInput style={[styles.input, styles.messageInput, surfaceThemeStyle, { backgroundColor: theme.backgroundColor, color: theme.textColor }]} placeholder="Flight details or other notes (optional)" placeholderTextColor="#8899AA" value={guestNotes} onChangeText={setGuestNotes} accessibilityLabel="Flight details or other notes" multiline textAlignVertical="top" />
            {guestBookingStatus ? <Text accessibilityLiveRegion="polite" style={styles.formStatus}>{guestBookingStatus}</Text> : null}
            <TouchableOpacity style={[styles.formButton, submittingGuestBooking ? styles.formButtonDisabled : null]} disabled={submittingGuestBooking} onPress={submitGuestBooking}>
              <Text style={styles.formButtonText}>{submittingGuestBooking ? "Sending request…" : siteContent.bookingSubmitLabel} <Text>→</Text></Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {newsPosts.length > 0 ? (
        <View
          nativeID="website-section-news"
          onLayout={(event) => rememberOffset("news", event.nativeEvent.layout.y)}
          style={[styles.newsSection, { backgroundColor: theme.backgroundColor }]}
        >
          <View style={[styles.sectionInner, { maxWidth: 1120 }]}>
            <Text style={styles.kicker}>{siteContent.newsKicker}</Text>
            <Text style={styles.newsTitle}>{siteContent.newsTitle}</Text>
            <View style={[styles.newsGrid, wide ? styles.newsGridWide : null]}>
              {newsPosts.map((post) => (
                <View key={post.id} style={[styles.newsCard, surfaceThemeStyle, wide ? styles.newsCardWide : null]}>
                  {post.imageUrl ? (
                    <Image
                      source={{ uri: websiteImageUri(post.imageUrl) }}
                      accessibilityLabel={post.image_alt || post.title}
                      resizeMode="cover"
                      style={styles.newsImage}
                    />
                  ) : null}
                  <View style={styles.newsCardCopy}>
                    <Text style={styles.newsDate}>
                      {post.published_at ? new Date(post.published_at).toLocaleDateString("en-FJ", { day: "numeric", month: "short", year: "numeric" }) : ""}
                    </Text>
                    <Text style={styles.newsCardTitle}>{post.title}</Text>
                    <Text style={styles.newsSummary}>{post.summary}</Text>
                    <Text style={styles.newsBody}>{post.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      <View
        nativeID="website-section-about"
        onLayout={(event) => rememberOffset("about", event.nativeEvent.layout.y)}
        style={[styles.aboutSection, { backgroundColor: theme.backgroundColor }]}
      >
        <View style={[styles.aboutInner, { maxWidth: 1120 }, wide ? styles.aboutInnerWide : null]}>
          <View style={[styles.aboutArt, { backgroundColor: theme.accentColor, borderRadius: theme.borderRadius }]}>
            {siteContent.aboutImageUrl ? (
              <Image
                source={{ uri: websiteImageUri(siteContent.aboutImageUrl) }}
                accessibilityLabel={siteContent.aboutImageAlt || "About Pointbreak Fiji Rides"}
                resizeMode="cover"
                style={styles.aboutArtImage}
              />
            ) : (
              <>
                <View style={styles.artCircle}><Text style={styles.artSun}>◯</Text></View>
                <View style={styles.artPalm}><Text style={styles.artPalmText}>FJ</Text></View>
                <View style={styles.artCaption}><Text style={styles.artCaptionText}>A LITTLE ISLAND{'\n'}STATE OF MIND</Text></View>
                <View style={styles.artPattern}><Text style={styles.artPatternText}>◇  ◇  ◇  ◇</Text></View>
              </>
            )}
          </View>
          <View style={styles.aboutCopy}>
            <Text style={[styles.kicker, { color: theme.accentColor }]}>{siteContent.aboutKicker}</Text>
            <Text style={[styles.aboutTitle, { color: theme.textColor }]}>{siteContent.aboutTitle}</Text>
            <Text style={[styles.aboutBody, { color: theme.textColor }]}>
              {siteContent.aboutBody}
            </Text>
            <Text style={[styles.aboutBody, { color: theme.textColor }]}>
              {siteContent.aboutSecondBody}
            </Text>
            <TouchableOpacity style={styles.textLink} onPress={() => goTo("contact")}>
              <Text style={styles.textLinkText}>{siteContent.aboutLink} <Text>→</Text></Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View
        nativeID="website-section-contact"
        onLayout={(event) => rememberOffset("contact", event.nativeEvent.layout.y)}
        style={[styles.contactSection, { backgroundColor: theme.accentColor }]}
      >
        <View style={[styles.contactInner, { maxWidth: 1120 }, wide ? styles.contactInnerWide : null]}>
          <View style={styles.contactCopy}>
            <Text style={[styles.kickerLight, { color: theme.textColor }]}>{siteContent.contactKicker}</Text>
            <Text style={[styles.contactTitle, { color: theme.textColor }]}>{siteContent.contactTitle}</Text>
            <Text style={[styles.contactLead, { color: theme.textColor }]}>{siteContent.contactLead}</Text>
            <Text style={styles.contactLabel}>{siteContent.contactEmailLabel}</Text>
            <TouchableOpacity onPress={() => Linking.openURL(`mailto:${siteContent.contactEmail}`)}>
              <Text style={styles.contactEmail}>{siteContent.contactEmail}</Text>
            </TouchableOpacity>
            {siteContent.contactPhone ? (
              <>
                <Text style={[styles.contactLabel, { color: theme.textColor, marginTop: 18 }]}>PHONE</Text>
                <TouchableOpacity
                  accessibilityRole="link"
                  accessibilityLabel={`Call ${siteContent.contactPhone}`}
                  onPress={() => Linking.openURL(`tel:${siteContent.contactPhone.replace(/[^\d+]/g, "")}`)}
                >
                  <Text style={styles.contactEmail}>{siteContent.contactPhone}</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <Text style={styles.contactFoot}>{siteContent.contactFoot}</Text>
          </View>
          <View style={[styles.formCard, surfaceThemeStyle]}>
            <Text style={styles.formTitle}>{siteContent.contactFormTitle}</Text>
            <Text style={styles.formHint}>{siteContent.contactFormHint}</Text>
            <TextInput
              style={[styles.input, surfaceThemeStyle, { backgroundColor: theme.backgroundColor, color: theme.textColor }]}
              placeholder="Your name"
              placeholderTextColor="#8899AA"
              value={name}
              onChangeText={setName}
              accessibilityLabel="Your name"
              autoComplete="name"
            />
            <TextInput
              style={[styles.input, surfaceThemeStyle, { backgroundColor: theme.backgroundColor, color: theme.textColor }]}
              placeholder="Your email"
              placeholderTextColor="#8899AA"
              value={email}
              onChangeText={setEmail}
              accessibilityLabel="Your email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <TextInput
              style={[styles.input, styles.messageInput, surfaceThemeStyle, { backgroundColor: theme.backgroundColor, color: theme.textColor }]}
              placeholder="How can we help?"
              placeholderTextColor="#8899AA"
              value={message}
              onChangeText={setMessage}
              accessibilityLabel="Your message"
              multiline
              textAlignVertical="top"
            />
            {formStatus ? <Text accessibilityLiveRegion="polite" style={styles.formStatus}>{formStatus}</Text> : null}
            <TouchableOpacity style={[styles.formButton, accentThemeStyle]} onPress={sendMessage}>
              <Text style={styles.formButtonText}>{siteContent.contactFormButton} <Text>→</Text></Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={[styles.footer, { backgroundColor: theme.backgroundColor, borderTopColor: theme.borderColor }]}>
        <View style={[styles.footerInner, { maxWidth: 1120 }, wide ? styles.footerInnerWide : null]}>
          <View style={styles.footerBrand}>
            <View style={styles.brandMarkSmall}><Text style={styles.brandMarkText}>P</Text></View>
            <View>
              <Text style={styles.footerName}>POINTBREAK FIJI RIDES</Text>
              <Text style={styles.footerTagline}>{siteContent.footerTagline}</Text>
            </View>
          </View>
          <Text style={styles.footerCopy}>© Pointbreak Fiji Rides</Text>
          <TouchableOpacity onPress={() => Linking.openURL(`mailto:${siteContent.contactEmail}`)}>
            <Text style={styles.footerEmail}>{siteContent.contactEmail}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="link" onPress={() => Linking.openURL(`${getApiUrl()}/website-admin/`)}>
            <Text style={styles.footerAdminLink}>Admin sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
      <PlacePicker
        places={places.filter((place) => place.name !== guestDropoff)}
        label="Choose pickup location"
        open={placePickerOpen === "pickup"}
        onClose={() => setPlacePickerOpen(null)}
        onSelect={(place) => setGuestPickup(place.name)}
      />
      <PlacePicker
        places={places.filter((place) => place.name !== guestPickup)}
        label="Choose destination"
        open={placePickerOpen === "dropoff"}
        onClose={() => setPlacePickerOpen(null)}
        onSelect={(place) => setGuestDropoff(place.name)}
      />
      </ScrollView>
    </View>
  );
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const styles = StyleSheet.create({
  pageShell: { flex: 1, position: "relative", overflow: "hidden" },
  pageBackgroundImage: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%", opacity: 0.18 },
  page: { flex: 1, backgroundColor: "#0A1628" },
  pageContent: { alignItems: "center", paddingBottom: 0 },
  header: {
    width: "100%",
    alignSelf: "center",
    minHeight: 82,
    paddingHorizontal: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#0066CC", alignItems: "center", justifyContent: "center" },
  brandMarkSmall: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#33AADD", alignItems: "center", justifyContent: "center" },
  brandMarkText: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", fontStyle: "italic" },
  brandName: { color: "#F5E6C8", fontSize: 14, fontWeight: "900", letterSpacing: 1.7 },
  brandSub: { color: "#33AADD", fontSize: 9, fontWeight: "800", letterSpacing: 3.2, marginTop: 2 },
  nav: { flexDirection: "row", alignItems: "center", gap: 30 },
  navText: { color: "#D6E0EA", fontSize: 13, fontWeight: "600" },
  headerButton: { backgroundColor: "#0066CC", borderRadius: 24, paddingVertical: 11, paddingHorizontal: 17 },
  headerButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  heroOuter: { width: "100%", alignSelf: "center", paddingHorizontal: 18, paddingBottom: 20 },
  hero: { flex: 1, minHeight: 610, borderRadius: 26, overflow: "hidden", justifyContent: "center", backgroundColor: "#0A2A63" },
  heroArtworkLayer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  heroImage: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%", borderRadius: 26, opacity: 0.88 },
  heroShade: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(4, 17, 37, 0.32)" },
  heroInner: { flex: 1, paddingHorizontal: 30, paddingVertical: 48, justifyContent: "center" },
  heroInnerWide: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 74, paddingVertical: 64 },
  heroCopy: { maxWidth: 620 },
  eyebrow: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: "rgba(255,255,255,0.42)", borderRadius: 22, paddingHorizontal: 13, paddingVertical: 8, marginBottom: 20 },
  eyebrowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#33AADD" },
  eyebrowText: { color: "#F5E6C8", fontSize: 10, fontWeight: "800", letterSpacing: 1.8 },
  heroTitle: { color: "#FFFFFF", fontWeight: "700", letterSpacing: -1 },
  heroEmphasis: { color: "#33AADD", fontStyle: "italic" },
  heroBody: { color: "#F2F5F9", fontSize: 16, lineHeight: 25, maxWidth: 470, marginTop: 18 },
  heroActions: { flexDirection: "row", alignItems: "center", gap: 13, marginTop: 28, flexWrap: "wrap" },
  heroActionsMobile: { alignItems: "flex-start" },
  primaryButton: { backgroundColor: "#0066CC", borderRadius: 25, paddingVertical: 15, paddingHorizontal: 23 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  buttonArrow: { fontSize: 18 },
  secondaryButton: { borderWidth: 1, borderColor: "rgba(255,255,255,0.7)", borderRadius: 25, paddingVertical: 14, paddingHorizontal: 21 },
  secondaryButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  heroNote: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 38 },
  heroNoteLine: { color: "#33AADD", fontSize: 12, letterSpacing: 1 },
  heroNoteText: { color: "#F5E6C8", fontSize: 9, fontWeight: "800", letterSpacing: 2 },
  heroCard: { width: 300, backgroundColor: "#1A2B3D", borderWidth: 1, borderColor: "#2A3B4D", borderRadius: 18, padding: 23, marginLeft: 24, boxShadow: "0 12px 30px rgba(0, 0, 0, 0.35)" },
  heroCardKicker: { color: "#33AADD", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  heroCardTitle: { color: "#F5E6C8", fontSize: 26, fontWeight: "800", marginTop: 9 },
  routeRow: { flexDirection: "row", marginTop: 20, marginBottom: 20 },
  routeDots: { width: 20, alignItems: "center", paddingVertical: 4 },
  routeDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: "#33AADD" },
  routeLine: { width: 1, height: 28, backgroundColor: "#2A3B4D", marginVertical: 3 },
  routeDotEnd: { width: 9, height: 9, backgroundColor: "#0066CC", borderRadius: 2 },
  routeLabels: { flex: 1, marginLeft: 10 },
  routeLabel: { color: "#FFFFFF", fontSize: 12, fontWeight: "600", paddingVertical: 1 },
  routeDivider: { height: 1, backgroundColor: "#2A3B4D", marginVertical: 14 },
  heroCardButton: { backgroundColor: "#0066CC", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  heroCardButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  heroCardFoot: { color: "#A6B3C2", fontSize: 10, textAlign: "center", marginTop: 12 },
  heroStamp: { position: "absolute", bottom: 24, right: 28, borderWidth: 1, borderColor: "rgba(255,255,255,0.52)", borderRadius: 30, paddingVertical: 9, paddingHorizontal: 15, alignItems: "center" },
  heroStampTop: { color: "#FFFFFF", fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  heroStampBottom: { color: "#33AADD", fontSize: 8, fontWeight: "700", letterSpacing: 1, marginTop: 2 },
  heroLicensePlate: {
    position: "absolute",
    left: "57%",
    top: "68%",
    width: 36,
    height: 13,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: "#0A1628",
    backgroundColor: "#F5E6C8",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "7deg" }],
  },
  heroLicenseText: { color: "#0A1628", fontSize: 7, lineHeight: 8, fontWeight: "900", letterSpacing: 0.6 },
  introBand: { width: "100%", backgroundColor: "#10243B", paddingHorizontal: 26, paddingVertical: 38 },
  introInner: { width: "100%", alignSelf: "center" },
  introInnerWide: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 24 },
  introLabel: { color: "#33AADD", fontSize: 9, fontWeight: "900", letterSpacing: 2 },
  introText: { color: "#FFFFFF", fontSize: 22, fontWeight: "700", lineHeight: 31, marginTop: 9 },
  introOrnament: { color: "#F5E6C8", fontSize: 13, letterSpacing: 3, marginTop: 16 },
  section: { width: "100%", paddingHorizontal: 26, paddingVertical: 74 },
  sectionInner: { width: "100%", alignSelf: "center" },
  sectionHeading: { marginBottom: 30 },
  sectionHeadingWide: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 30 },
  headingCopy: { maxWidth: 590 },
  kicker: { color: "#33AADD", fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  kickerLight: { color: "#33AADD", fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  sectionTitle: { color: "#F5E6C8", fontSize: 34, fontWeight: "700", lineHeight: 40, letterSpacing: -0.5, marginTop: 10 },
  sectionLead: { color: "#A6B3C2", fontSize: 14, lineHeight: 22, maxWidth: 350, marginTop: 15 },
  featureGrid: { gap: 13 },
  cardRowWide: { flexDirection: "row" },
  featureCard: { flex: 1, backgroundColor: "#1A2B3D", borderWidth: 1, borderColor: "#2A3B4D", borderRadius: 16, padding: 21, minHeight: 180 },
  featureCardWide: { marginRight: 13 },
  featureTop: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 25 },
  featureNumber: { color: "#33AADD", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  featureRule: { flex: 1, height: 1, backgroundColor: "#2A3B4D" },
  featureGlyph: { color: "#33AADD", fontSize: 18, fontWeight: "700" },
  featureTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  featureBody: { color: "#A6B3C2", fontSize: 13, lineHeight: 21, marginTop: 9 },
  shopSection: { width: "100%", backgroundColor: "#071326", paddingHorizontal: 26, paddingVertical: 74 },
  newsSection: { width: "100%", backgroundColor: "#10243B", paddingHorizontal: 26, paddingVertical: 70 },
  newsTitle: { color: "#F5E6C8", fontSize: 32, lineHeight: 39, fontWeight: "700", marginTop: 10, marginBottom: 24 },
  newsGrid: { gap: 14 },
  newsGridWide: { flexDirection: "row", flexWrap: "wrap" },
  newsCard: { flex: 1, minWidth: 250, overflow: "hidden", backgroundColor: "#1A2B3D", borderWidth: 1, borderColor: "#2A3B4D", borderRadius: 16 },
  newsCardWide: { maxWidth: "49%" },
  newsImage: { width: "100%", height: 210, backgroundColor: "#0A1628" },
  newsCardCopy: { padding: 20 },
  newsDate: { color: "#33AADD", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  newsCardTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "800", lineHeight: 26, marginTop: 8 },
  newsSummary: { color: "#F5E6C8", fontSize: 14, fontWeight: "700", lineHeight: 21, marginTop: 9 },
  newsBody: { color: "#A6B3C2", fontSize: 13, lineHeight: 21, marginTop: 8 },
  shopHeading: { marginBottom: 29 },
  shopTitle: { color: "#F5E6C8", fontSize: 34, lineHeight: 40, fontWeight: "700", marginTop: 10 },
  shopLead: { color: "#C7D6E4", fontSize: 14, lineHeight: 22, maxWidth: 350, marginTop: 15 },
  rideGrid: { gap: 14 },
  rideCard: { flex: 1, backgroundColor: "#1A2B3D", borderRadius: 16, borderWidth: 1, borderColor: "#2A3B4D", padding: 22, minHeight: 224 },
  rideCardWide: { marginRight: 14 },
  rideCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  rideIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#33AADD", alignItems: "center", justifyContent: "center" },
  rideIconText: { color: "#0A1628", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  rideArrow: { color: "#F5E6C8", fontSize: 18 },
  rideTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "800" },
  rideBody: { color: "#C7D6E4", fontSize: 13, lineHeight: 21, marginTop: 8, maxWidth: 380 },
  rideLink: { color: "#33AADD", fontSize: 10, fontWeight: "900", letterSpacing: 1.1, marginTop: 19 },
  driverBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 20, backgroundColor: "#1A2B3D", borderWidth: 1, borderColor: "#2A3B4D", borderRadius: 16, padding: 22, marginTop: 22 },
  driverBannerCopy: { flex: 1, minWidth: 220 },
  driverBannerKicker: { color: "#33AADD", fontSize: 9, fontWeight: "900", letterSpacing: 1.7 },
  driverBannerTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "800", marginTop: 6 },
  driverBannerBody: { color: "#A6B3C2", fontSize: 12, lineHeight: 19, maxWidth: 450, marginTop: 5 },
  driverBannerButton: { backgroundColor: "#0066CC", borderRadius: 24, paddingHorizontal: 18, paddingVertical: 13 },
  driverBannerButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  bookingSection: { width: "100%", backgroundColor: "#10243B", paddingHorizontal: 26, paddingVertical: 74 },
  bookingInner: { width: "100%", alignSelf: "center", gap: 30 },
  bookingInnerWide: { flexDirection: "row", alignItems: "flex-start", gap: 55 },
  bookingCopy: { flex: 1, maxWidth: 420 },
  bookingTitle: { color: "#FFFFFF", fontSize: 34, lineHeight: 41, fontWeight: "700", marginTop: 11 },
  bookingLead: { color: "#C7D6E4", fontSize: 14, lineHeight: 22, marginTop: 14 },
  bookingNote: { color: "#A6B3C2", fontSize: 12, lineHeight: 19, marginTop: 13 },
  bookingForm: { flex: 1, maxWidth: 570, backgroundColor: "#1A2B3D", borderWidth: 1, borderColor: "#2A3B4D", borderRadius: 17, padding: 23 },
  bookingRow: { flexDirection: "row", gap: 10 },
  bookingHalf: { flex: 1, minWidth: 0 },
  bookingFieldHint: { color: "#A6B3C2", fontSize: 11, marginTop: -4, marginBottom: 8 },
  locationSelect: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  locationSelected: { color: "#FFFFFF", fontSize: 13, flex: 1 },
  locationPlaceholder: { color: "#8899AA", fontSize: 13, flex: 1 },
  locationChevron: { color: "#33AADD", fontSize: 18, fontWeight: "800", marginLeft: 8 },
  aboutSection: { width: "100%", paddingHorizontal: 26, paddingVertical: 78 },
  aboutInner: { width: "100%", alignSelf: "center", gap: 36 },
  aboutInnerWide: { flexDirection: "row", alignItems: "center", gap: 68 },
  aboutArt: { flex: 1, minHeight: 300, maxWidth: 490, backgroundColor: "#0066CC", borderRadius: 19, overflow: "hidden", justifyContent: "center", alignItems: "center" },
  aboutArtImage: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" },
  artCircle: { position: "absolute", width: 205, height: 205, borderRadius: 103, backgroundColor: "#33AADD", right: -24, top: -35, alignItems: "center", justifyContent: "center" },
  artSun: { color: "#F5E6C8", fontSize: 110, lineHeight: 120 },
  artPalm: { width: 150, height: 150, borderRadius: 75, backgroundColor: "#0A1628", alignItems: "center", justifyContent: "center", borderWidth: 8, borderColor: "#F5E6C8" },
  artPalmText: { color: "#FFFFFF", fontSize: 56, fontWeight: "900", fontStyle: "italic", letterSpacing: -4 },
  artCaption: { position: "absolute", left: 20, bottom: 20, backgroundColor: "#0A1628", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9 },
  artCaptionText: { color: "#FFFFFF", fontSize: 9, lineHeight: 14, fontWeight: "900", letterSpacing: 1.2 },
  artPattern: { position: "absolute", right: 16, bottom: 19 },
  artPatternText: { color: "#F5E6C8", fontSize: 12, letterSpacing: 2 },
  aboutCopy: { flex: 1, maxWidth: 500 },
  aboutTitle: { color: "#F5E6C8", fontSize: 36, lineHeight: 42, fontWeight: "700", marginTop: 11 },
  aboutBody: { color: "#A6B3C2", fontSize: 14, lineHeight: 23, marginTop: 15 },
  textLink: { alignSelf: "flex-start", borderBottomWidth: 1, borderBottomColor: "#33AADD", paddingBottom: 4, marginTop: 23 },
  textLinkText: { color: "#33AADD", fontSize: 13, fontWeight: "800" },
  contactSection: { width: "100%", backgroundColor: "#10243B", paddingHorizontal: 26, paddingVertical: 70 },
  contactInner: { width: "100%", alignSelf: "center", gap: 32 },
  contactInnerWide: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 60 },
  contactCopy: { flex: 1, maxWidth: 450 },
  contactTitle: { color: "#FFFFFF", fontSize: 37, lineHeight: 44, fontWeight: "700", marginTop: 11 },
  contactLead: { color: "#C7D6E4", fontSize: 14, lineHeight: 22, marginTop: 13 },
  contactLabel: { color: "#33AADD", fontSize: 9, fontWeight: "900", letterSpacing: 1.7, marginTop: 34 },
  contactEmail: { color: "#FFFFFF", fontSize: 18, fontWeight: "700", marginTop: 8 },
  contactFoot: { color: "#A6B3C2", fontSize: 12, marginTop: 8 },
  formCard: { flex: 1, maxWidth: 500, backgroundColor: "#1A2B3D", borderWidth: 1, borderColor: "#2A3B4D", borderRadius: 17, padding: 23 },
  formTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "800" },
  formHint: { color: "#A6B3C2", fontSize: 11, lineHeight: 17, marginTop: 5, marginBottom: 17 },
  input: { backgroundColor: "#0A1628", borderWidth: 1, borderColor: "#2A3B4D", borderRadius: 10, color: "#FFFFFF", paddingHorizontal: 13, paddingVertical: 12, fontSize: 13, marginBottom: 10 },
  messageInput: { minHeight: 98, paddingTop: 12 },
  formStatus: { color: "#33AADD", fontSize: 11, lineHeight: 17, marginBottom: 8 },
  formButton: { backgroundColor: "#0066CC", borderRadius: 11, alignItems: "center", paddingVertical: 14, marginTop: 2 },
  formButtonDisabled: { opacity: 0.6 },
  formButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  footer: { width: "100%", backgroundColor: "#071326", paddingHorizontal: 26, paddingVertical: 22 },
  footerInner: { width: "100%", alignSelf: "center", gap: 12 },
  footerInnerWide: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footerBrand: { flexDirection: "row", alignItems: "center", gap: 9 },
  footerName: { color: "#FFFFFF", fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  footerTagline: { color: "#A6B3C2", fontSize: 8, fontWeight: "700", letterSpacing: 1.5, marginTop: 3 },
  footerCopy: { color: "#A6B3C2", fontSize: 10 },
  footerEmail: { color: "#33AADD", fontSize: 11, fontWeight: "700" },
  footerAdminLink: { color: "#A6B3C2", fontSize: 11, textDecorationLine: "underline" },
});
