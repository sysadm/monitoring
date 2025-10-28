export const LS_KEYS = {
  cameras: 'nvr.cameras',
  mainId:  'nvr.mainId',
  thumbH:  'nvr.thumbH',
  layout:  'nvr.layout',
  page:    'nvr.page'
};

// Wyłącznie WebRTC (WHEP). Podaj ścieżki /whep.
export const DEFAULT_CAMERAS = [
  { id: "front_cam", name: "Front", webrtc: "http://localhost:8889/front_cam/whep" },
  { id: "door_cam",  name: "Door",  webrtc: "http://localhost:8889/door_cam/whep"  },
  { id: "rear_cam",  name: "Rear",  webrtc: "http://localhost:8889/rear_cam/whep"  },
  // Dodawaj kolejne:
  // { id: "garage",  name: "Garage", webrtc: "http://localhost:8889/garage/whep" },
  // { id: "garden",  name: "Garden", webrtc: "http://localhost:8889/garden/whep" },
  // { id: "hall",    name: "Hall",   webrtc: "http://localhost:8889/hall/whep"   },
];

export const UI_DEFAULTS = {
  layout: 'sidebar',  // 'sidebar' | 'grid2' | 'grid3'
  thumbH: 180,        // px
  gridPageSize: 6     // ile kafli naraz w siatce (paginacja)
};
