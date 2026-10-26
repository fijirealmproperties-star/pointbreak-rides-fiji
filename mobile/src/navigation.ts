export type Screen =
  | { name: "login" }
  | { name: "rider-home" }
  | { name: "rider-active-ride"; rideId: string }
  | { name: "rider-trips" }
  | { name: "driver-home" }
  | { name: "driver-active-ride"; rideId: string }
  | { name: "driver-trips" }
  | { name: "profile" };