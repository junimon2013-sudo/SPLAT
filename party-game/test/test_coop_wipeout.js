// test/test_coop_wipeout.js
// 협동 스테이지의 의도된 규칙: 한 명이라도 탈락하면 그 즉시 전원 실패(FAILED) 처리되어야 한다.
const Player = require("../server/Player");
const CoopEngine = require("../server/games/coop/CoopEngine");
const { COOP_STATE } = require("../shared/constants");

function makeFakeRoom(playerCount) {
  const players = new Map();
  for (let i = 0; i < playerCount; i++) {
    const p = new Player(null, "P" + i);
    p.assignColor(["red", "blue", "yellow", "green"][i]);
    players.set(p.id, p);
  }
  return {
    players,
    getAlivePlayers: () => Array.from(players.values()),
    broadcastEvent: (name, data) => console.log("EVENT", name, JSON.stringify(data)),
  };
}

function setInput(pl, tx, ty) {
  const dx = tx - pl.x;
  const dy = ty - pl.y;
  pl.input.up = dy < -6;
  pl.input.down = dy > 6;
  pl.input.left = dx < -6;
  pl.input.right = dx > 6;
  pl.input.action = false;
  pl.input.interact = false;
  pl.input.dash = false;
}
function stop(pl) {
  pl.input.up = pl.input.down = pl.input.left = pl.input.right = false;
}

const DT = 1 / 30;
const MAX_SECONDS = 30;

(async () => {
  console.log("=== 협동 스테이지2: 1명만 탈락해도 즉시 전원 실패(FAILED) 확인 ===");
  const room = makeFakeRoom(3);
  const engine = new CoopEngine(room);
  engine.stageIndex = 1; // stage2
  engine._loadStage();

  const players = room.getAlivePlayers();
  const [p1, p2, p3] = players;
  let t = 0;
  let failed = false;
  let failReason = null;
  let othersWereFine = true;

  for (let tick = 0; tick < MAX_SECONDS * 30; tick++) {
    t += DT;
    const s = engine.getStateJSON();

    if (s.state === "playing") {
      setInput(p1, 400, 400);
      stop(p2);
      stop(p3);
    }

    engine.update(DT);

    if (engine.state === COOP_STATE.FAILED) {
      failed = true;
      failReason = engine.failReason;
      othersWereFine = p2.status !== "eliminated" && p3.status !== "eliminated";
      break;
    }
  }

  if (!failed) {
    console.error("❌ 1명이 탈락했는데도 전원 실패 처리가 되지 않음");
    process.exit(1);
  }
  console.log(`✅ 1명(p1) 탈락 -> 즉시 전원 실패 처리됨 (사유: "${failReason}")`);
  if (!othersWereFine) {
    console.error("❌ p2/p3도 함께 탈락 처리되어 있음");
    process.exit(1);
  }
  console.log("✅ p2, p3는 직접 탈락하지 않았음에도 동료(p1)의 탈락으로 스테이지가 실패 처리됨 - 의도된 규칙과 일치");
  console.log("=== 테스트 통과 ===");
  process.exit(0);
})();
