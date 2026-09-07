// test/test_competition_full.js
const WebSocket = require("ws");
const { MSG } = require("../shared/constants");
const URL = "ws://localhost:3000";

function connect(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const c = { ws, name, playerId: null, roomState: null, gameState: null, code: null, seenGames: new Set() };
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
        if (msg.payload.gameId) c.seenGames.add(msg.payload.gameId);
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
  console.log("=== 경쟁 모드 전체 라운드(4라운드, 랜덤 로테이션) 실서버 통합 테스트 ===");
  const clients = await Promise.all([connect("A"), connect("B"), connect("C")]);
  const [p1, p2, p3] = clients;

  send(p1, MSG.CREATE_ROOM, { name: "A" });
  await sleep(200);
  send(p2, MSG.JOIN_ROOM, { code: p1.code, name: "B" });
  send(p3, MSG.JOIN_ROOM, { code: p1.code, name: "C" });
  await sleep(300);

  send(p1, MSG.SET_MODE, { mode: "competition" });
  await sleep(100);
  send(p1, MSG.SET_ROUNDS, { rounds: 4 });
  await sleep(100);
  send(p1, MSG.START_GAME, {});
  await sleep(300);
  if (p1.roomState.phase !== "in_game") throw new Error("게임 시작 실패");
  console.log("✅ 4라운드 경쟁 게임 시작");

  // 모든 라운드에 대해 범용 랜덤 입력을 지속적으로 전송 (특정 게임에 맞춘 전략 없이 무작위 플레이)
  let running = true;
  const inputTimer = setInterval(() => {
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
  const MAX_WAIT = 5 * 60 * 1000; // 라운드당 넉넉히 최대 5분, 전체는 상황 따라 다름 -> 아래서 final_result만 대기
  while (Date.now() - start < MAX_WAIT) {
    await sleep(500);
    if (p1.gameState && p1.gameState.state === "final_result") break;
  }
  running = false;
  clearInterval(inputTimer);

  console.log("최종 상태:", p1.gameState && p1.gameState.state);
  console.log("플레이된 미니게임 종류:", Array.from(p1.seenGames).join(", "));
  if (!p1.gameState || p1.gameState.state !== "final_result") {
    throw new Error("FINAL_RESULT 도달 실패 (타임아웃)");
  }
  console.log("✅ FINAL_RESULT 도달");
  console.log("최종 순위:", JSON.stringify(p1.gameState.finalRanking));
  if (!p1.gameState.finalRanking || p1.gameState.finalRanking.length !== 3) {
    throw new Error("최종 순위 계산 이상");
  }
  console.log("=== 경쟁 모드 전체 라운드 테스트 통과 ===");
  process.exit(0);
})().catch((e) => {
  console.error("❌ 테스트 실패:", e.message);
  process.exit(1);
});
