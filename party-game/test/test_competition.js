// test/test_competition.js
const WebSocket = require("ws");
const { MSG } = require("../shared/constants");
const URL = "ws://localhost:3000";

function connect(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const client = { ws, name, playerId: null, roomState: null, gameState: null, code: null, events: [] };
    ws.on("open", () => resolve(client));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === MSG.ROOM_STATE) {
        if (msg.payload.joined) {
          client.playerId = msg.payload.playerId;
          client.code = msg.payload.code;
        } else client.roomState = msg.payload;
      } else if (msg.type === MSG.GAME_STATE) {
        client.gameState = msg.payload;
      } else if (msg.type === MSG.GAME_EVENT) {
        client.events.push(msg.payload.event);
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

(async () => {
  console.log("=== 경쟁 모드(밀어내기) 테스트 시작 ===");
  const p1 = await connect("P1");
  const p2 = await connect("P2");
  const p3 = await connect("P3");

  send(p1, MSG.CREATE_ROOM, { name: "A" });
  await sleep(200);
  send(p2, MSG.JOIN_ROOM, { code: p1.code, name: "B" });
  send(p3, MSG.JOIN_ROOM, { code: p1.code, name: "C" });
  await sleep(300);
  if (p1.roomState.players.length !== 3) throw new Error("3명 참가 실패");
  console.log("✅ 3명 참가:", p1.roomState.players.map((p) => p.name).join(","));

  send(p1, MSG.SET_MODE, { mode: "competition" });
  await sleep(150);
  send(p1, MSG.SET_ROUNDS, { rounds: 3 });
  await sleep(150);
  if (p1.roomState.mode !== "competition" || p1.roomState.rounds !== 3)
    throw new Error("경쟁 모드/라운드 설정 실패");
  console.log("✅ 경쟁 모드 설정, 라운드 3");

  send(p1, MSG.START_GAME, {});
  await sleep(300);
  if (p1.roomState.phase !== "in_game") throw new Error("경쟁 게임 시작 실패");
  console.log("✅ 경쟁 게임 시작됨");

  // GAME_INTRO(2.2s) + COUNTDOWN(3s)
  await sleep(5600);
  console.log("현재 상태:", p1.gameState && p1.gameState.state, "게임:", p1.gameState && p1.gameState.gameName);
  if (!p1.gameState || p1.gameState.state !== "playing") throw new Error("경쟁 PLAYING 진입 실패");
  console.log("✅ PLAYING 진입, 게임:", p1.gameState.gameName, "핵심요소:", p1.gameState.coreTraits);

  // p1이 계속 공격하며 중앙으로 이동, p2/p3는 가만히 있어서 p1이 밀어내도록 유도
  let tickCount = 0;
  const timer = setInterval(() => {
    const s = p1.gameState;
    if (!s || s.state !== "playing" || !s.game) return;
    const me = (s.players || []).find((pl) => pl.id === p1.playerId);
    if (!me || me.status === "eliminated") return;
    const others = (s.players || []).filter((pl) => pl.id !== p1.playerId && pl.status !== "eliminated");
    if (others.length === 0) return;
    let target = others[0];
    let bestDist = Infinity;
    others.forEach((o) => {
      const d = Math.hypot(o.x - me.x, o.y - me.y);
      if (d < bestDist) {
        bestDist = d;
        target = o;
      }
    });
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    tickCount++;
    const attackToggle = tickCount % 12 < 6; // 300ms 주기로 true/false 토글 -> edge trigger 발생
    send(p1, MSG.INPUT, {
      up: dy < -0.5,
      down: dy > 0.5,
      left: dx < -0.5,
      right: dx > 0.5,
      action: attackToggle,
      interact: false,
      dash: false,
    });
    send(p2, MSG.INPUT, { up: false, down: false, left: false, right: false, action: false, interact: false, dash: false });
    send(p3, MSG.INPUT, { up: false, down: false, left: false, right: false, action: false, interact: false, dash: false });
  }, 50);

  const start = Date.now();
  while (Date.now() - start < 40000) {
    await sleep(300);
    if (p1.gameState && (p1.gameState.state === "game_end" || p1.gameState.state === "result")) break;
  }
  clearInterval(timer);

  console.log("라운드1 종료 상태:", p1.gameState.state);
  if (p1.gameState.state !== "game_end" && p1.gameState.state !== "result") {
    throw new Error("라운드1이 시간 내 종료되지 않음 (테스트 타임아웃)");
  }
  console.log("✅ 라운드1 종료 감지, 이벤트 로그:", [...new Set(p1.events)].join(","));
  console.log("이번 라운드 결과:", JSON.stringify(p1.gameState.lastRoundResult));
  if (!p1.gameState.lastRoundResult) throw new Error("라운드 결과 없음");
  console.log("누적 점수:", JSON.stringify(p1.gameState.scores));

  console.log("=== 경쟁 모드 테스트 통과 (라운드1 검증 완료) ===");
  process.exit(0);
})().catch((e) => {
  console.error("❌ 테스트 실패:", e.message);
  process.exit(1);
});
