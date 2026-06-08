/* Mock Home Assistant entity state for the Glasshouse dashboard.
   Shape matches what subscribeEntities() would deliver, simplified.
   Swap for a real HA websocket subscription when wiring up. */

export const GH_DATA = {
  presence: {
    "person.samuel_lawrence": { state: "home", attributes: { friendly_name: "Samuel" } },
    "device_tracker.sams_iphone": {
      state: "home",
      attributes: { latitude: 51.5074, longitude: -0.1278, accuracy: 18, source_type: "gps", battery_level: 78 },
    },
  },
  weather: {
    "weather.forecast_home": {
      state: "partlycloudy",
      attributes: {
        temperature: 11,
        apparent_temperature: 9,
        humidity: 62,
        wind_speed: 14,
        pressure: 1016,
        forecast: [
          { datetime: "tomorrow", condition: "sunny", temperature: 14, templow: 7 },
          { datetime: "+2", condition: "partlycloudy", temperature: 15, templow: 8 },
          { datetime: "+3", condition: "rainy", temperature: 12, templow: 9 },
          { datetime: "+4", condition: "cloudy", temperature: 10, templow: 6 },
          { datetime: "+5", condition: "sunny", temperature: 16, templow: 8 },
        ],
      },
    },
  },
  sun: {
    "sun.sun": { state: "above_horizon" },
    "sensor.sun_next_dawn": { state: "06:04" },
    "sensor.sun_next_rising": { state: "06:38" },
    "sensor.sun_next_setting": { state: "20:48" },
    "sensor.sun_next_dusk": { state: "21:22" },
  },
  vacuum: {
    "vacuum.roborock_s8": { state: "docked", attributes: { friendly_name: "Gregory" } },
    "sensor.roborock_s8_battery": { state: 100 },
    "sensor.roborock_s8_cleaning_progress": { state: 0 },
    "sensor.roborock_s8_status": { state: "charging" },
    "sensor.roborock_s8_last_clean_end": { state: "2h ago" },
  },
  printer: {
    "binary_sensor.x1c_00m09d522400385_online": { state: "on" },
    "sensor.x1c_00m09d522400385_current_stage": { state: "printing" },
    "sensor.x1c_00m09d522400385_print_progress": { state: 47 },
    "sensor.x1c_00m09d522400385_remaining_time": { state: 24 },
    "sensor.x1c_00m09d522400385_bed_temperature": { state: 60 },
    "sensor.x1c_00m09d522400385_nozzle_temperature": { state: 215 },
    "sensor.x1c_00m09d522400385_chamber_temperature": { state: 28 },
    "sensor.x1c_00m09d522400385_print_status": { state: "printing" },
    "sensor.x1c_00m09d522400385_active_tray": { state: "eSUN PLA+ · A1" },
    "sensor.x1c_00m09d522400385_ams_1_humidity": { state: 42 },
    "light.x1c_00m09d522400385_chamber_light": { state: "on" },
    file: "benchy_v3.gcode.3mf",
  },
  air: {
    "fan.core_300s_series": { state: "on", attributes: { preset_mode: "auto" } },
    "sensor.core_300s_series_air_quality": { state: "excellent" },
    "sensor.core_300s_series_pm2_5": { state: 5 },
    "sensor.core_300s_series_filter_lifetime": { state: 96 },
    "switch.core_300s_series_display": { state: "on" },
    history: [6, 5, 7, 6, 4, 5, 5, 6, 5, 5, 4, 5, 5, 6, 5],
  },
  climate: {
    "input_number.govee_heater_temperature": { state: 20 },
    on: false,
  },
  adguard: {
    "switch.adguard_home_protection": { state: "on" },
    "switch.adguard_home_filtering": { state: "on" },
    "sensor.adguard_home_dns_queries": { state: 1216 },
    "sensor.adguard_home_dns_queries_blocked": { state: 417 },
    "sensor.adguard_home_dns_queries_blocked_ratio": { state: 34.29 },
    top_blocked: [
      { name: "doubleclick.net", count: 84 },
      { name: "googlesyndication.com", count: 61 },
      { name: "facebook.com", count: 47 },
      { name: "scorecardresearch.com", count: 38 },
      { name: "adsystem.amazon.com", count: 29 },
    ],
  },
  system: {
    "sensor.system_monitor_processor_use": { state: 7 },
    "sensor.system_monitor_memory_use": { state: 2294.7 },
    "sensor.system_monitor_processor_temperature": { state: 28.2 },
    "sensor.system_monitor_disk_use_config": { state: 11.4 },
    "sensor.uptime": { state: "2026-04-23T08:14:00" },
    "binary_sensor.rpi_power_status": { state: "off" },
    "sensor.available_entities_count": { state: 212 },
    "sensor.unavailable_entities_count": { state: 79 },
  },
  backup: {
    "sensor.backup_last_successful_automatic_backup": { state: "yesterday · 04:00" },
    "sensor.backup_next_scheduled_automatic_backup": { state: "tonight · 04:00" },
    last_size: "1.42 GB",
    retention_days: 14,
    method: "Local + offsite",
  },
  addons: {
    pending_updates: 3,
    list: [
      { name: "AdGuard Home", slug: "adguard", current: "5.0.3", next: "5.0.5", severity: "minor" },
      { name: "Mosquitto broker", slug: "mosquitto", current: "6.4.2", next: "6.4.3", severity: "patch" },
      { name: "Studio Code Server", slug: "vscode", current: "5.18.0", next: "5.19.1", severity: "minor" },
    ],
    all_addons: 14,
  },
  media: {
    "media_player.spotify_samuel_lawrence": {
      state: "playing",
      attributes: {
        media_title: "Stratus",
        media_artist: "Billy Cobham",
        media_album_name: "Spectrum",
        media_duration: 595,
        media_position: 224,
        source: "Spotify",
        volume_level: 0.62,
      },
    },
    "media_player.living_room_tv_5": {
      state: "off",
      attributes: {
        friendly_name: "Living room TV",
        source_list: ["Apple TV", "PlayStation 5", "Plex", "Netflix", "Disney+", "YouTube"],
        source: null,
        volume_level: 0.38,
      },
    },
    "media_player.divoom_pixoo_64": {
      state: "on",
      attributes: {
        friendly_name: "Pixoo 64 · bedroom",
        media_title: "Clock · 24h",
        source: "Channel",
      },
    },
    cast_targets: [
      { id: "media_player.living_room_speakers", name: "Living room speakers", state: "playing", room: "living room" },
      { id: "media_player.bedroom_speaker", name: "Bedroom speaker", state: "idle", room: "bedroom" },
      { id: "media_player.kitchen_homepod", name: "Kitchen HomePod", state: "idle", room: "kitchen" },
    ],
    queue: [
      { title: "Stratus", artist: "Billy Cobham", dur: "9:55", now: true },
      { title: "Red Baron", artist: "Billy Cobham", dur: "6:35" },
      { title: "Birds of Fire", artist: "Mahavishnu Orchestra", dur: "5:48" },
      { title: "Black Market", artist: "Weather Report", dur: "6:32" },
      { title: "Spain", artist: "Chick Corea", dur: "9:53" },
      { title: "500 Miles High", artist: "Return to Forever", dur: "8:50" },
    ],
    recent: [
      { title: "Mountain Dance", artist: "Dave Grusin", played: "20 min ago" },
      { title: "Steppin'", artist: "Lenny White", played: "1 h ago" },
      { title: "Maiden Voyage", artist: "Herbie Hancock", played: "yesterday" },
    ],
  },
  todo: {
    "todo.shopping_list": { count: 7, items: ["sourdough", "oat milk", "coffee filters", "olive oil", "tomatoes", "garlic", "lemons"] },
  },

  schedule: {
    today_iso: "2026-05-21",
    week_start_iso: "2026-05-18",
    calendars: {
      "calendar.work": { color: "var(--cal-work)", label: "Work" },
      "calendar.personal": { color: "var(--cal-personal)", label: "Personal" },
      "calendar.home": { color: "var(--cal-home)", label: "Home" },
      "calendar.family": { color: "var(--cal-family)", label: "Family" },
    },
    events: [
      { id: "e1", cal: "calendar.work", day: 0, start: 9.0, end: 9.5, title: "Standup", where: "Zoom" },
      { id: "e2", cal: "calendar.work", day: 0, start: 14.0, end: 15.0, title: "Design review", where: "Meet · #design" },
      { id: "e3", cal: "calendar.personal", day: 0, start: 19.0, end: 20.0, title: "Yoga", where: "Studio · Hackney" },
      { id: "e4", cal: "calendar.work", day: 1, start: 9.0, end: 9.5, title: "Standup", where: "Zoom" },
      { id: "e5", cal: "calendar.work", day: 1, start: 10.0, end: 11.0, title: "1:1 · Alex", where: "Zoom" },
      { id: "e6", cal: "calendar.family", day: 1, start: 19.0, end: 20.5, title: "Dinner · parents", where: "Theirs" },
      { id: "e7", cal: "calendar.work", day: 2, start: 9.0, end: 9.5, title: "Standup", where: "Zoom" },
      { id: "e8", cal: "calendar.work", day: 2, start: 13.0, end: 14.5, title: "Roboquest playtest", where: "Studio" },
      { id: "e9", cal: "calendar.work", day: 3, start: 9.0, end: 9.5, title: "Standup", where: "Zoom" },
      { id: "e10", cal: "calendar.home", day: 3, start: 11.0, end: 12.0, title: "HA upgrade", where: "Pi · garage" },
      { id: "e11", cal: "calendar.personal", day: 3, start: 18.0, end: 19.0, title: "Gym", where: "Castle Climbing" },
      { id: "e12", cal: "calendar.work", day: 4, start: 9.0, end: 9.5, title: "Standup", where: "Zoom" },
      { id: "e13", cal: "calendar.work", day: 4, start: 16.0, end: 17.0, title: "Beer · team", where: "The Crown" },
      { id: "e14", cal: "calendar.home", day: 5, start: 10.0, end: 12.0, title: "Flood-light install", where: "Backyard" },
      { id: "e15", cal: "calendar.home", day: 5, start: 15.0, end: 16.5, title: "Bambu maintenance", where: "Workshop" },
      { id: "e16", cal: "calendar.personal", day: 6, start: 8.0, end: 9.0, title: "Long run", where: "Hackney Marshes" },
      { id: "e17", cal: "calendar.family", day: 6, start: 19.0, end: 20.5, title: "Movie night", where: "Living room" },
    ],
  },

  todo_lists: {
    "todo.backlog": {
      label: "Backlog",
      items: [
        { uid: "b1", summary: "Wire AdGuard live → React app", tag: "dev", due: null },
        { uid: "b2", summary: "Add Tailscale node for phone", tag: "network", due: null },
        { uid: "b3", summary: "Fix Pi 4 BLE for Govee temps", tag: "hardware", due: null },
        { uid: "b4", summary: "Buy 4 flood lights", tag: "home", due: "Sat" },
        { uid: "b5", summary: "Re-pair Apple Watch in Companion", tag: "integration", due: null },
        { uid: "b6", summary: "Set up Cloudflare tunnel", tag: "network", due: null },
        { uid: "b7", summary: "Add HomeKit bridge", tag: "integration", due: null },
      ],
    },
    "todo.today": {
      label: "Today",
      items: [
        { uid: "t1", summary: "Reauth Roborock orphans", tag: "integration", due: "today" },
        { uid: "t2", summary: "Reopen Companion on iPad", tag: "integration", due: "today" },
        { uid: "t3", summary: "Pixoo 64 channel rotation script", tag: "automation", due: "today" },
      ],
    },
    "todo.doing": {
      label: "Doing",
      items: [
        { uid: "d1", summary: "Glasshouse v2 dashboard", tag: "dev", due: null },
        { uid: "d2", summary: "Govee humidifier re-auth", tag: "integration", due: null },
      ],
    },
    "todo.done": {
      label: "Done",
      items: [
        { uid: "x1", summary: "Set up Spotify integration", tag: "integration", due: null },
        { uid: "x2", summary: "Mount Bambu X1C camera", tag: "hardware", due: null },
        { uid: "x3", summary: "Pebble dashboard prototype", tag: "dev", due: null },
      ],
    },
  },

  scenes: ["scene.morning", "scene.movie", "scene.goodnight", "scene.all_off"],

  lights: {
    "light.living_room": {
      state: "on",
      attributes: {
        friendly_name: "Living room",
        brightness: 180,
        color_mode: "color_temp",
        color_temp_kelvin: 2700,
        rgb_color: [255, 198, 130],
        supported_color_modes: ["color_temp", "rgb"],
      },
    },
    "light.smartbulb_5c_h": {
      state: "off",
      attributes: {
        friendly_name: "Bedroom bulb",
        brightness: 120,
        color_mode: "color_temp",
        color_temp_kelvin: 2200,
        rgb_color: [255, 170, 110],
        supported_color_modes: ["color_temp", "rgb"],
      },
    },
    "light.bathroom": {
      state: "on",
      attributes: {
        friendly_name: "Bathroom",
        brightness: 200,
        color_mode: "color_temp",
        color_temp_kelvin: 4000,
        rgb_color: [255, 235, 200],
        supported_color_modes: ["color_temp", "rgb"],
      },
    },
    "light.desk_strip": {
      state: "on",
      attributes: {
        friendly_name: "Desk LED strip",
        brightness: 220,
        color_mode: "rgb",
        rgb_color: [110, 180, 255],
        supported_color_modes: ["rgb"],
      },
    },
    "light.flood_1": { state: "unavailable", attributes: { friendly_name: "Flood · front porch", placeholder: true } },
    "light.flood_2": { state: "unavailable", attributes: { friendly_name: "Flood · driveway", placeholder: true } },
    "light.flood_3": { state: "unavailable", attributes: { friendly_name: "Flood · back yard", placeholder: true } },
    "light.flood_4": { state: "unavailable", attributes: { friendly_name: "Flood · side gate", placeholder: true } },

    "light.divoom_pixoo_64": {
      state: "on",
      attributes: {
        friendly_name: "Divoom Pixoo 64",
        location: "bedroom",
        brightness: 200,
        channel: "Clock",
        available_channels: ["Clock", "Weather", "Visualizer", "Animations", "Custom"],
      },
    },
  },

  fans: {
    "fan.ceiling": {
      state: "off",
      attributes: {
        friendly_name: "Ceiling fan",
        percentage: 0,
        preset_modes: ["sleep", "low", "medium", "high"],
        preset_mode: null,
      },
    },
  },

  health: {
    available: 212,
    unavailable: 79,
    groups: [
      { name: "iBeacon trackers (BACPL)", count: 10, note: "BLE beacons — need power + range" },
      { name: "Govee BLE temp", count: 7, note: "Pi 4 BLE not reaching it" },
      { name: "Tuya humidifier", count: 6, note: "Reauth in HA UI fixes" },
      { name: "Roborock orphans", count: 3, note: "Reauth or remove-and-readd would fix" },
      { name: "Pixoo (off)", count: 2, note: "Will turn green when powered" },
      { name: "AI conversations / TTS / STT", count: 5, note: "Populates on first voice interaction" },
      { name: "Scenes", count: 4, note: "Target Meross switches dead" },
      { name: "sam_pad device + sensors", count: 13, note: "Reopen Companion on the iPad" },
      { name: "iPhone watch + diffuser", count: 4, note: "Apple Watch unpaired; diffuser offline" },
      { name: "Smart bulb + Pixoo placeholder", count: 5, note: "Orphan + first-load notify entities" },
    ],
  },
  // Bedroom diffuser — Meross MOD150 ultrasonic diffuser + LED.
  // Mock fallback; live entities are humidifier.bedroom_diffuser +
  // light.bedroom_diffuser when the device comes online.
  diffuser: {
    "humidifier.bedroom_diffuser": {
      state: "on",
      attributes: {
        friendly_name: "Bedroom diffuser",
        device: "Meross MOD150",
        mode: "continuous",
        available_modes: ["off", "intermittent", "continuous"],
      },
    },
    "light.bedroom_diffuser": {
      state: "on",
      attributes: {
        friendly_name: "Diffuser light",
        brightness: 165, // 0–255
        rgb_color: [96, 170, 255],
        effect: "cycle", // fixed | cycle
        effect_list: ["fixed", "cycle"],
      },
    },
    water_pct: 64, // estimated reservoir
    runtime_left: "5h 20m", // at continuous, from a 300 ml fill
    ml_capacity: 300,
  },
  // SamBox360 — game console on a smart plug. Power-only control.
  gaming: {
    name: "SamBox360",
    output: "Living Room TV · 4K·60·HDR · controller",
    status: "off",                 // "off" | "turning_on" | "on"
    plug: "switch.sambox360_plug",
    status_entity: "sensor.sambox360_status",
  },
};
