// test/test_4players_competition.js
const WebSocket = require("ws");
const { MSG } = require("../shared/constants");
const URL = "ws://localhost:3000";

function connect(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const c = { ws, name, playerId: null, roomState: null, gameState: null, code: null };
    ws.on("open", () => resolve(c));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === MSG.ROOM_STATE) {
        if (msg.payload.joined) {
          c.playerId = msg.payload.playerId;
          c.code = msg.payload.code;
        } else c.roomState = msg.payload;
      } else if (msg.type === MSG.GAME_STATE) {
        c.gameState = msg.payload;
      }
    });
  });
}
function send(c, type, payload) {
  c.ws.send(JSON.stringify({ type, payload }));
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log("=== 4인 경쟁 모드 스모크 테스트 ===");
  const clients = await Promise.all([connect("A"), connect("B"), connect("C"), connect("D")]);
  const [p1, p2, p3, p4] = clients;

  send(p1, MSG.CREATE_ROOM, { name: "A" });
  await sleep(200);
  send(p2, MSG.JOIN_ROOM, { code: p1.code, name: "B" });
  send(p3, MSG.JOIN_ROOM, { code: p1.code, name: "C" });
  send(p4, MSG.JOIN_ROOM, { code: p1.code, name: "D" });
  await sleep(400);
  if (p1.roomState.players.length !== 4) throw new Error("4명 참가 실패");
  console.log("✅ 4명 참가 성공");

  send(p1, MSG.SET_MODE, { mode: "competition" });
  await sleep(100);
  send(p1, MSG.SET_ROUNDS, { rounds: 3 });
  await sleep(100);
  send(p1, MSG.START_GAME, {});
  await sleep(300);
  if (p1.roomState.phase !== "in_game") throw new Error("4인 경쟁 시작 실패");
  console.log("✅ 4인 경쟁 게임 시작:", p1.roomState.rounds, "라운드");

  await sleep(5600);
  if (!p1.gameState || p1.gameState.state !== "playing") throw new Error("4인 경쟁 PLAYING 진입 실패");
  const syncOk = p1.gameState.players.length === 4 && p1.gameState.players.every((p) => typeof p.x === "number");
  if (!syncOk) throw new Error("4인 위치 동기화 이상");
  console.log("✅ 4인 PLAYING 진입, 미니게임:", p1.gameState.gameName, "- 위치 동기화 확인");

  let running = true;
  const timer = setInterval(() => {
    if (!running) return;
    clients.forEach((c) => {
      send(c, MSG.INPUT, {
        up: Math.random() < 0.3,
        down: Math.random() < 0.3,
        left: Math.random() < 0.3,
        right: Math.random() < 0.3,
        action: Math.random() < 0.35,
        interact: Math.random() < 0.35,
        dash: Math.random() < 0.05,
      });
    });
  }, 50);

  const start = Date.now();
  while (Date.now() - start < 60000) {
    await sleep(300);
    if (p1.gameState && (p1.gameState.state === "game_end" || p1.gameState.state === "result")) break;
  }
  running = false;
  clearInterval(timer);

  if (!p1.gameState || (p1.gameState.state !== "game_end" && p1.gameState.state !== "result")) {
    throw new Error("4인 라운드1 종료 실패 (타임아웃): " + (p1.gameState && p1.gameState.state));
  }
  console.log("✅ 4인 라운드1 종료 확인, 점수:", JSON.stringify(p1.gameState.scores));
  console.log("=== 4인 경쟁 모드 테스트 통과 ===");
  process.exit(0);
})().catch((e) => {
  console.error("❌ 테스트 실패:", e.message);
  process.exit(1);
});
