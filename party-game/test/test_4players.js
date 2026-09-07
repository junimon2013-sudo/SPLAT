// test/test_4players.js
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
      } else if (msg.type === MSG.ROOM_ERROR) {
        console.log(`[${name}] ERROR:`, msg.payload.message);
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
function moveToward(c, tx, ty) {
  const s = c.gameState;
  const me = (s.players || []).find((pl) => pl.id === c.playerId);
  if (!me) return;
  const dx = tx - me.x;
  const dy = ty - me.y;
  send(c, MSG.INPUT, {
    up: dy < -6,
    down: dy > 6,
    left: dx < -6,
    right: dx > 6,
    action: false,
    interact: false,
    dash: false,
  });
}

(async () => {
  console.log("=== 4인 동시 접속 + 협동 스테이지1 클리어 테스트 ===");
  const clients = await Promise.all([connect("A"), connect("B"), connect("C"), connect("D")]);
  const [p1, p2, p3, p4] = clients;

  send(p1, MSG.CREATE_ROOM, { name: "A" });
  await sleep(200);
  send(p2, MSG.JOIN_ROOM, { code: p1.code, name: "B" });
  send(p3, MSG.JOIN_ROOM, { code: p1.code, name: "C" });
  send(p4, MSG.JOIN_ROOM, { code: p1.code, name: "D" });
  await sleep(400);

  if (!p1.roomState || p1.roomState.players.length !== 4) {
    throw new Error("4명 참가 실패: " + (p1.roomState && p1.roomState.players.length));
  }
  console.log("✅ 4명 참가 성공:", p1.roomState.players.map((p) => `${p.name}(${p.color})`).join(", "));

  const colors = new Set(p1.roomState.players.map((p) => p.color));
  if (colors.size !== 4) throw new Error("플레이어 색상 중복 발생: " + JSON.stringify([...colors]));
  console.log("✅ 4명 모두 고유한 색상 배정됨");

  // 5번째 플레이어는 참가 거부되어야 함 (방 가득 참)
  const p5 = await connect("E");
  send(p5, MSG.JOIN_ROOM, { code: p1.code, name: "E" });
  await sleep(300);
  console.log("✅ 5번째 플레이어 참가 시도 완료 (거부 메시지는 위 ERROR 로그 참고)");

  send(p1, MSG.SET_MODE, { mode: "coop" });
  await sleep(100);
  send(p2, MSG.SET_READY, { ready: true });
  send(p3, MSG.SET_READY, { ready: true });
  send(p4, MSG.SET_READY, { ready: true });
  await sleep(150);
  send(p1, MSG.START_GAME, {});
  await sleep(300);
  if (p1.roomState.phase !== "in_game") throw new Error("4인 게임 시작 실패");
  console.log("✅ 4인 협동 게임 시작됨");

  await sleep(6200);
  const timer = setInterval(() => {
    const s = p1.gameState;
    if (!s || s.state !== "playing") return;
    const target = s.collectedKeys < s.totalKeys ? { x: 700, y: 680 } : { x: s.goal.x + s.goal.w / 2, y: s.goal.y + s.goal.h / 2 };
    clients.forEach((c) => moveToward(c, target.x, target.y));
  }, 50);

  const start = Date.now();
  while (Date.now() - start < 20000) {
    await sleep(300);
    if (p1.gameState && (p1.gameState.state === "clear" || p1.gameState.state === "result")) break;
  }
  clearInterval(timer);

  if (!p1.gameState || (p1.gameState.state !== "clear" && p1.gameState.state !== "result")) {
    throw new Error("4인 스테이지1 클리어 실패: " + (p1.gameState && p1.gameState.state));
  }
  console.log("✅ 4인 스테이지1 CLEAR 확인됨");
  console.log("=== 4인 테스트 통과 ===");
  process.exit(0);
})().catch((e) => {
  console.error("❌ 테스트 실패:", e.message);
  process.exit(1);
});
