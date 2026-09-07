// test/test_coop_stage2.js
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
      } else if (msg.type === MSG.GAME_EVENT) {
        console.log(`[${name}] EVENT:`, msg.payload.event, JSON.stringify(msg.payload.data));
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
  console.log("=== 협동 스테이지 2 클리어 테스트 (스테이지1은 즉시 통과 처리) ===");
  const p1 = await connect("P1");
  const p2 = await connect("P2");

  send(p1, MSG.CREATE_ROOM, { name: "H" });
  await sleep(200);
  send(p2, MSG.JOIN_ROOM, { code: p1.code, name: "G" });
  await sleep(300);
  send(p1, MSG.SET_MODE, { mode: "coop" });
  await sleep(100);
  send(p2, MSG.SET_READY, { ready: true });
  await sleep(100);
  send(p1, MSG.START_GAME, {});
  await sleep(300);
  console.log("게임 시작, phase =", p1.roomState.phase);

  // 스테이지1 통과: 열쇠(700,680) -> 골(1230~1330,320~480)
  await sleep(6200); // intro+countdown
  const s1Timer = setInterval(() => {
    const s = p1.gameState;
    if (!s || s.stageIndex !== 0 || s.state !== "playing") return;
    const target = s.collectedKeys < s.totalKeys ? { x: 700, y: 680 } : { x: s.goal.x + s.goal.w / 2, y: s.goal.y + s.goal.h / 2 };
    moveToward(p1, target.x, target.y);
    moveToward(p2, target.x, target.y);
  }, 50);

  const t1start = Date.now();
  while (Date.now() - t1start < 15000) {
    await sleep(200);
    if (p1.gameState && p1.gameState.stageIndex >= 1) break;
  }
  clearInterval(s1Timer);
  if (!p1.gameState || p1.gameState.stageIndex < 1) throw new Error("스테이지1 통과 실패");
  console.log("✅ 스테이지1 통과, 스테이지2 진입 대기 중...");

  // 스테이지2: intro(2.5s) + countdown(3s) 대기
  await sleep(6200);
  if (!p1.gameState || p1.gameState.state !== "playing" || p1.gameState.stageIndex !== 1) {
    throw new Error("스테이지2 PLAYING 진입 실패: " + (p1.gameState && p1.gameState.state));
  }
  console.log("✅ 스테이지2 PLAYING 진입:", p1.gameState.stageName);

  // 단계적 AI: 1) 구멍 앞에서 발판 타고 건너기 2) 압력판(각자 하나씩) 동시에 밟기 3) 문 통과 후 열쇠 4) 골인
  let phase = "cross";
  const s2Timer = setInterval(() => {
    const s = p1.gameState;
    if (!s || s.stageIndex !== 1 || s.state !== "playing") return;
    const me1 = (s.players || []).find((pl) => pl.id === p1.playerId);
    const me2 = (s.players || []).find((pl) => pl.id === p2.playerId);
    if (!me1 || !me2) return;

    if (phase === "cross") {
      // 이동 발판이 느리게 왕복하므로 현재 위치를 계속 쫓아가면 자연스럽게 올라탄다
      const plat = s.platforms && s.platforms[0];
      if (plat) {
        const cx = plat.x + plat.w / 2;
        const cy = plat.y + plat.h / 2;
        moveToward(p1, cx, cy);
        moveToward(p2, cx, cy);
      }
      if (me1.x > 555 && me2.x > 555) phase = "plates";
    } else if (phase === "plates") {
      moveToward(p1, 700, 220);
      moveToward(p2, 700, 580);
      const plateGroup = s.plates.find((pl) => pl.group === "g1");
      if (plateGroup && plateGroup.active) phase = "key";
    } else if (phase === "key") {
      if (s.collectedKeys < s.totalKeys) {
        moveToward(p1, 1250, 400);
        moveToward(p2, 1250, 400);
      } else {
        phase = "goal";
      }
    } else if (phase === "goal") {
      const tx = s.goal.x + s.goal.w / 2;
      const ty = s.goal.y + s.goal.h / 2;
      moveToward(p1, tx, ty);
      moveToward(p2, tx, ty);
    }
  }, 50);

  const t2start = Date.now();
  while (Date.now() - t2start < 40000) {
    await sleep(300);
    if (p1.gameState && (p1.gameState.state === "clear" || p1.gameState.stageIndex >= 2)) break;
    if (p1.gameState && p1.gameState.state === "failed") break;
  }
  clearInterval(s2Timer);

  console.log(
    "스테이지2 결과 - 상태:",
    p1.gameState.state,
    "stageIndex:",
    p1.gameState.stageIndex,
    "phase(AI):",
    phase,
    "collectedKeys:",
    p1.gameState.collectedKeys
  );

  if (p1.gameState.state === "failed") {
    throw new Error("스테이지2 실패: " + p1.gameState.failReason);
  }
  if (!(p1.gameState.state === "clear" || p1.gameState.stageIndex >= 2)) {
    throw new Error("스테이지2 시간 내 클리어 실패");
  }
  console.log("✅ 스테이지2 CLEAR 확인됨");
  console.log("=== 협동 스테이지 2 테스트 통과 ===");
  process.exit(0);
})().catch((e) => {
  console.error("❌ 테스트 실패:", e.message);
  process.exit(1);
});
