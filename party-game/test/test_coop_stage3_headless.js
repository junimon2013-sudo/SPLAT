// test/test_coop_stage3_headless.js
// 네트워크 없이 CoopEngine을 직접 구동해서 스테이지3(구멍 건너기+벽 우회+전원압력판+2열쇠)이
// 실제로 클리어 가능한지 검증한다.
const Player = require("../server/Player");
const CoopEngine = require("../server/games/coop/CoopEngine");
const { COOP_STATE } = require("../shared/constants");
const { setInput, crossPlatform } = require("./coop_ai_helpers");

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

const DT = 1 / 30;
const MAX_SECONDS = 90;

(async () => {
  console.log("=== 협동 스테이지 3 헤드리스 클리어 테스트 (2인) ===");
  const room = makeFakeRoom(2);
  const engine = new CoopEngine(room);
  engine.stageIndex = 2;
  engine._loadStage();

  const players = room.getAlivePlayers();
  const [me1, me2] = players;
  const ctx = { satisfied: {} };
  let cleared = false;
  let failed = false;

  for (let tick = 0; tick < MAX_SECONDS * 30; tick++) {
    const s = engine.getStateJSON();

    if (s.state === "playing") {
      s.plates.forEach((p) => {
        if (p.active) ctx.satisfied[p.group] = true;
      });

      [me1, me2].forEach((pl, i) => {
        if (!crossPlatform(pl, s.platforms[0], 605, 280)) return;
        if (pl.x < 850) {
          setInput(pl, 900, 650); // 벽(x800, y0~550) 아래로 돌아간다
          return;
        }
        if (!ctx.satisfied.gAll) {
          const target = i === 0 ? { x: 870, y: 180 } : { x: 870, y: 620 };
          setInput(pl, target.x, target.y);
          return;
        }
        if (pl.x < 1010) {
          setInput(pl, 1040, 150); // 문 통로(y 40~260)를 지나 넘어간다
          return;
        }
        if (s.collectedKeys < s.totalKeys) {
          setInput(pl, 1150, 120);
        } else {
          setInput(pl, s.goal.x + s.goal.w / 2, s.goal.y + s.goal.h / 2);
        }
      });
    }

    engine.update(DT);

    if (tick % 90 === 0) {
      console.log(
        `t=${(tick * DT).toFixed(1)}s state=${s.state} keys=${s.collectedKeys}/${s.totalKeys} p1=(${Math.round(
          me1.x
        )},${Math.round(me1.y)}) p2=(${Math.round(me2.x)},${Math.round(me2.y)})`
      );
    }

    if (engine.state === COOP_STATE.CLEAR || engine.state === COOP_STATE.RESULT) {
      cleared = true;
      break;
    }
    if (engine.state === COOP_STATE.FAILED) {
      failed = true;
      console.log("실패 사유:", engine.failReason);
      break;
    }
  }

  if (failed) {
    console.error("❌ 스테이지3 실패:", engine.failReason);
    process.exit(1);
  }
  if (!cleared) {
    console.error("❌ 스테이지3 제한 시간(테스트 90초) 내에 클리어하지 못함.");
    process.exit(1);
  }
  console.log("✅ 스테이지3 CLEAR 확인됨");
  console.log("=== 협동 스테이지 3 테스트 통과 ===");
  process.exit(0);
})();
