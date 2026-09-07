// shared/constants.js
// 서버와 클라이언트가 공통으로 사용하는 상수 정의.
// (서버에서는 require, 클라이언트에서는 <script> 태그로 그대로 로드해서 window.SHARED 에 붙인다)

const TICK_RATE = 30; // 서버 시뮬레이션 tick (Hz)
const TICK_MS = 1000 / TICK_RATE;

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O, 1/I 제외
const ROOM_CODE_LENGTH = 4;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

const PLAYER_COLORS = [
  { id: "red", hex: "#ff5c5c" },
  { id: "orange", hex: "#ff9f43" },
  { id: "yellow", hex: "#ffd23f" },
  { id: "lime", hex: "#a8e063" },
  { id: "green", hex: "#3fd97f" },
  { id: "mint", hex: "#3fe0c5" },
  { id: "sky", hex: "#4dc9ff" },
  { id: "blue", hex: "#4d9dff" },
  { id: "lavender", hex: "#b39ddb" },
  { id: "purple", hex: "#9b59b6" },
  { id: "black", hex: "#2b2d33" },
];

// ---- 캐릭터 장신구(로비에서 선택, none=없음) ----
const ACCESSORIES = [
  { id: "none", label: "없음", emoji: "" },
  { id: "hat", label: "모자", emoji: "🎩" },
  { id: "sprout", label: "새싹", emoji: "🌱" },
  { id: "comb", label: "닭 벼슬", emoji: "🐔" },
  { id: "glasses", label: "안경", emoji: "👓" },
];

// ---- 입력 키 (중앙 입력 시스템에서 참조) ----
const KEYS = {
  UP: "KeyW",
  LEFT: "KeyA",
  DOWN: "KeyS",
  RIGHT: "KeyD",
  ACTION: "Space", // 공격 / 기본 액션
  INTERACT: "KeyE", // 상호작용
  DASH: "ShiftLeft", // 대시 / 보조 액션
  JUMP: "KeyQ", // 점프/회피 (경쟁모드 일부 게임)
};

// ---- 메시지 타입 (클라이언트 <-> 서버) ----
const MSG = {
  // room / lobby
  CREATE_ROOM: "create_room",
  JOIN_ROOM: "join_room",
  ROOM_STATE: "room_state",
  ROOM_ERROR: "room_error",
  SET_MODE: "set_mode",
  SET_STAGE: "set_stage", // 로비에서 여러 맵 중 하나를 골라서 시작(null이면 전체 순서대로)
  PING: "ping", // 화면 클릭 위치에 이름+색으로 퍼지는 신호 표시 (피코파크 스타일)
  SET_ROUNDS: "set_rounds",
  SET_READY: "set_ready",
  SET_APPEARANCE: "set_appearance", // 색상/장신구/칼 스킨 변경
  START_GAME: "start_game",
  LEAVE_ROOM: "leave_room",

  // gameplay
  INPUT: "input", // 클라이언트가 보내는 입력 상태
  GAME_STATE: "game_state", // 서버가 매 tick 브로드캐스트하는 전체 상태
  GAME_EVENT: "game_event", // 1회성 이벤트(효과음/이펙트 트리거용)
  RETRY_STAGE: "retry_stage",
  RETURN_TO_LOBBY: "return_to_lobby",
  ENHANCE_ATTEMPT: "enhance_attempt", // 강화 버튼을 눌렀을 때 클라이언트->서버
  GIVE_UP: "give_up", // 경주에서 기권 버튼
  MINE_CLICK: "mine_click", // 보물찾기 - 특정 칸을 곡괭이로 클릭
  MINE_RELEASE: "mine_release", // 보물찾기 - 클릭을 뗌(채굴 중단)
  ADMIN_START_GAME: "admin_start_game", // 관리자 패널 - 특정 미니게임으로 바로 시작
  ADMIN_FORCE_ENHANCE: "admin_force_enhance", // 관리자 패널 - 내 강화를 즉시 만렙으로
  ADMIN_SPAWN_TREASURE: "admin_spawn_treasure", // 관리자 패널 - 보물찾기에서 원하는 광물 강제 생성

  PING: "ping",
  PONG: "pong",
};

// ---- 상위 게임 모드 ----
const MODE = {
  COOP: "coop",
  COMPETITION: "competition",
};

// ---- 방/로비 상태 ----
const ROOM_PHASE = {
  LOBBY: "lobby",
  IN_GAME: "in_game",
};

// ---- 협동 스테이지 상태 머신 ----
const COOP_STATE = {
  STAGE_INTRO: "stage_intro",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  CLEAR: "clear",
  FAILED: "failed",
  RESULT: "result",
};

// ---- 경쟁 라운드 상태 머신 ----
const COMP_STATE = {
  GAME_INTRO: "game_intro",
  ENHANCEMENT: "enhancement",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  GAME_END: "game_end",
  RESULT: "result",
  FINAL_RESULT: "final_result",
};

// ---- 물리 상수 (월드 단위, 픽셀 기준) ----
const PHYSICS = {
  MOVE_SPEED: 220, // px/s
  DASH_SPEED: 480,
  DASH_DURATION: 0.18, // 초
  DASH_COOLDOWN: 0.8,
  PLAYER_RADIUS: 22,
  GRAVITY: 1400,
  JUMP_UNUSED: false, // 탑다운 시점이라 별도 점프 없음 (이동발판/구멍으로 낙하 표현)
};

const COUNTDOWN_SECONDS = 3;

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TICK_RATE,
    TICK_MS,
    ROOM_CODE_CHARS,
    ROOM_CODE_LENGTH,
    MIN_PLAYERS,
    MAX_PLAYERS,
    PLAYER_COLORS,
    ACCESSORIES,
    KEYS,
    MSG,
    MODE,
    ROOM_PHASE,
    COOP_STATE,
    COMP_STATE,
    PHYSICS,
    COUNTDOWN_SECONDS,
  };
}
