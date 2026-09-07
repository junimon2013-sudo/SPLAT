// test/test_coop.js
// 2명의 가짜 클라이언트로 방 생성->로비->협동 시작->이동하여 스테이지1 클리어까지 시뮬레이션
const WebSocket = require("ws");
const { MSG } = require("../shared/constants");

const URL = "ws://localhost:3000";

function connect(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const client = { ws, name, playerId: null, roomState: null, gameState: null, code: null };
    ws.on("open", () => resolve(client));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === MSG.ROOM_STATE) {
        if (msg.payload.joined) {
          client.playerId = msg.payload.playerId;
          client.code = msg.payload.code;
        } else {
          client.roomState = msg.payload;
        }
      } else if (msg.type === MSG.GAME_STATE) {
        client.gameState = msg.payload;
      } else if (msg.type === MSG.ROOM_ERROR) {
        console.log(`[${name}] ROOM_ERROR:`, msg.payload.message);
      } else if (msg.type === MSG.GAME_EVENT) {
        console.log(`[${name}] EVENT:`, msg.payload.event, JSON.stringify(msg.payload.data));
      }
    });
  });
}

function send(client, type, payload) {
  client.ws.send(JSON.stringify({ type, payload }));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log("=== 협동 모드 테스트 시작 ===");
  const p1 = await connect("P1-host");
  const p2 = await connect("P2");

  send(p1, MSG.CREATE_ROOM, { name: "호스트" });
  await sleep(200);
  console.log("방 코드:", p1.code);
  if (!p1.code) throw new Error("방 생성 실패");

  send(p2, MSG.JOIN_ROOM, { code: p1.code, name: "게스트" });
  await sleep(300);
  if (p2.roomState.players.length !== 2) throw new Error("2명 참가 실패: " + p2.roomState.players.length);
  console.log("✅ 방 참가 성공, 인원:", p2.roomState.players.length);
  console.log("✅ 방장:", p1.roomState.hostId === p1.playerId);

  send(p1, MSG.SET_MODE, { mode: "coop" });
  await sleep(150);
  if (p1.roomState.mode !== "coop") throw new Error("모드 설정 실패");
  console.log("✅ 모드 설정: coop");

  send(p2, MSG.SET_READY, { ready: true });
  await sleep(150);

  send(p1, MSG.START_GAME, {});
  await sleep(300);
  if (p1.roomState.phase !== "in_game") throw new Error("게임 시작 실패");
  console.log("✅ 게임 시작됨, phase =", p1.roomState.phase);

  // STAGE_INTRO(2.5s) + COUNTDOWN(3s) 대기
  await sleep(6200);
  console.log("현재 상태:", p1.gameState && p1.gameState.state);
  if (!p1.gameState || p1.gameState.state !== "playing") throw new Error("PLAYING 상태 진입 실패");
  console.log("✅ PLAYING 상태 진입, 스테이지:", p1.gameState.stageName);

  // 두 플레이어를 목표 지점(문 통과 후 goal)까지 이동시키는 입력을 지속 전송
  // stage1: 문(1100,300,40,260)까지 오른쪽 이동 -> 키(700,680) 먼저 획득 위해 아래로 이동
  let elapsed = 0;
  const tickMs = 50;
  const inputTimer = setInterval(() => {
    elapsed += tickMs;
    const s = p1.gameState;
    if (!s || s.state !== "playing") return;
    // 매우 단순한 휴리스틱 이동: 아직 키 미획득이면 키 방향, 이후 goal 방향으로 이동
    [p1, p2].forEach((c) => {
      const me = (s.players || []).find((pl) => pl.id === c.playerId);
      if (!me) return;
      let targetX, targetY;
      if (s.collectedKeys < s.totalKeys) {
        targetX = 700;
        targetY = 680;
      } else {
        targetX = s.goal.x + s.goal.w / 2;
        targetY = s.goal.y + s.goal.h / 2;
      }
      const dx = targetX - me.x;
      const dy = targetY - me.y;
      send(c, MSG.INPUT, {
        up: dy < -5,
        down: dy > 5,
        left: dx < -5,
        right: dx > 5,
        action: false,
        interact: false,
        dash: false,
      });
    });
  }, tickMs);

  // 최대 20초 동안 클리어 대기
  const start = Date.now();
  while (Date.now() - start < 20000) {
    await sleep(300);
    if (p1.gameState && (p1.gameState.state === "clear" || p1.gameState.state === "result")) break;
  }
  clearInterval(inputTimer);

  console.log("최종 상태:", p1.gameState && p1.gameState.state, "수집 키:", p1.gameState && p1.gameState.collectedKeys);
  if (!p1.gameState || (p1.gameState.state !== "clear" && p1.gameState.state !== "result")) {
    throw new Error("스테이지1 클리어 실패 - 현재 상태: " + (p1.gameState && p1.gameState.state));
  }
  console.log("✅ STAGE 1 CLEAR 확인됨");

  // 다음 스테이지로 자동 전환되는지 확인 (CLEAR 2.5s -> RESULT 3s 후 다음 스테이지)
  await sleep(7000);
  console.log("다음 진행 상태:", p1.gameState.state, "stageIndex:", p1.gameState.stageIndex);
  if (p1.gameState.stageIndex < 1) {
    throw new Error("다음 스테이지 자동 전환 실패 (stageIndex=" + p1.gameState.stageIndex + ")");
  }
  console.log("✅ 다음 스테이지 자동 전환 확인 (stageIndex=" + p1.gameState.stageIndex + ")");

  console.log("=== 협동 모드 테스트 통과 ===");
  process.exit(0);
})().catch((e) => {
  console.error("❌ 테스트 실패:", e.message);
  process.exit(1);
});
