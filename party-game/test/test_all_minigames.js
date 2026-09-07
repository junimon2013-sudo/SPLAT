// test/test_all_minigames.js
// 실제 WebSocket 없이 서버 게임 로직만 직접 구동해서 크래시 여부와 종료/순위 계산을 검증한다.
const Player = require("../server/Player");
const { GAME_POOL } = require("../server/games/competition/CompetitionManager");

function makeFakeRoom(playerCount) {
  const players = new Map();
  for (let i = 0; i < playerCount; i++) {
    const p = new Player(null, "P" + i);
    p.assignColor(["red", "blue", "yellow", "green"][i]);
    players.set(p.id, p);
  }
  const events = [];
  return {
    players,
    getAlivePlayers: () => Array.from(players.values()),
    broadcastEvent: (name, data) => events.push({ name, data }),
    _events: events,
  };
}

function randomizeInput(pl, rng) {
  pl.input.up = rng() < 0.3;
  pl.input.down = rng() < 0.3;
  pl.input.left = rng() < 0.3;
  pl.input.right = rng() < 0.3;
  pl.input.action = rng() < 0.35; // 자연스러운 edge trigger 발생 위해 매 틱 변경
  pl.input.interact = rng() < 0.35;
  pl.input.dash = rng() < 0.05;
}

// 간단한 시드 가능한 랜덤 (재현성)
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 30;
const MAX_TICKS = 60 * 30 * 3; // 최대 3분(시뮬레이션 시간) 안에는 끝나야 함

async function testGame(GameClass, playerCount, seed) {
  const room = makeFakeRoom(playerCount);
  const rng = mulberry32(seed);
  const game = new GameClass(room);
  let ticks = 0;
  let done = false;
  while (ticks < MAX_TICKS) {
    room.getAlivePlayers().forEach((pl) => randomizeInput(pl, rng));
    done = game.update(DT);
    // getStateJSON이 매 틱 예외 없이 동작하는지도 확인
    const state = game.getStateJSON();
    if (!state || typeof state !== "object") throw new Error("getStateJSON 비정상 반환");
    ticks++;
    if (done) break;
  }
  if (!done) throw new Error(`제한 시간(${MAX_TICKS}틱) 내에 라운드가 끝나지 않음`);

  const ranking = game.getRanking();
  const alivePlayerIds = room.getAlivePlayers().map((p) => p.id);
  if (!Array.isArray(ranking)) throw new Error("getRanking()이 배열이 아님");
  if (ranking.length !== alivePlayerIds.length)
    throw new Error(`순위 인원 불일치: ranking=${ranking.length}, players=${alivePlayerIds.length}`);
  const rankSet = new Set(ranking);
  for (const id of alivePlayerIds) {
    if (!rankSet.has(id)) throw new Error(`순위에 누락된 플레이어: ${id}`);
  }
  return { ticks, seconds: (ticks * DT).toFixed(1), ranking };
}

(async () => {
  console.log("=== 경쟁 미니게임 10종 헤드리스 스모크 테스트 ===\n");
  let failCount = 0;
  for (const GameClass of GAME_POOL) {
    for (const playerCount of [2, 3, 4]) {
      const seed = playerCount * 1000 + GameClass.id.length;
      try {
        const result = await testGame(GameClass, playerCount, seed);
        console.log(
          `✅ [${GameClass.displayName}] ${playerCount}인 - ${result.seconds}s 만에 종료, 순위: ${result.ranking.join(">")}`
        );
      } catch (e) {
        failCount++;
        console.error(`❌ [${GameClass.displayName}] ${playerCount}인 실패:`, e.message);
      }
    }
  }
  console.log("\n=== 결과:", failCount === 0 ? "전체 통과" : `${failCount}건 실패`, "===");
  process.exit(failCount === 0 ? 0 : 1);
})();
