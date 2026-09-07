// test/test_new_stages.js
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
    broadcastEvent: () => {},
  };
}

const DT = 1 / 30;

function runStage(stageIndex, playerCount, maxSeconds, scriptFn) {
  const room = makeFakeRoom(playerCount);
  const engine = new CoopEngine(room);
  engine.stageIndex = stageIndex;
  engine._loadStage();
  const players = room.getAlivePlayers();
  const ctx = { satisfied: {} }; // 압력판 그룹이 한 번이라도 충족되면 계속 true로 유지 (서버 문 상태는 sticky하므로)

  for (let tick = 0; tick < maxSeconds * 30; tick++) {
    const s = engine.getStateJSON();
    if (s.state === "playing") {
      s.plates.forEach((p) => {
        if (p.active) ctx.satisfied[p.group] = true;
      });
      scriptFn(players, s, ctx);
    }
    engine.update(DT);
    if (engine.state === COOP_STATE.CLEAR || engine.state === COOP_STATE.RESULT) {
      return { ok: true, seconds: (tick * DT).toFixed(1) };
    }
    if (engine.state === COOP_STATE.FAILED) {
      return { ok: false, reason: engine.failReason, seconds: (tick * DT).toFixed(1) };
    }
  }
  return { ok: false, reason: "타임아웃(스크립트가 끝까지 진행 못함)" };
}

function goalCenter(s) {
  return { x: s.goal.x + s.goal.w / 2, y: s.goal.y + s.goal.h / 2 };
}

function stage4Script(players, s, ctx) {
  players.forEach((pl) => {
    if (!crossPlatform(pl, s.platforms[0], 560, 280)) return;
    if (!crossPlatform(pl, s.platforms[1], 1160, 880)) return;
    if (s.collectedKeys < s.totalKeys) {
      setInput(pl, 1550, 400);
    } else {
      const g = goalCenter(s);
      setInput(pl, g.x, g.y);
    }
  });
}

function stage5Script(players, s, ctx) {
  players.forEach((pl, i) => {
    if (!crossPlatform(pl, s.platforms[0], 560, 280)) return;
    if (!ctx.satisfied.gAll) {
      const groupPlates = s.plates.filter((p) => p.group === "gAll");
      const plate = groupPlates[i % groupPlates.length];
      setInput(pl, plate.x, plate.y);
      return;
    }
    if (s.collectedKeys < s.totalKeys) {
      setInput(pl, 1350, 400);
    } else {
      const g = goalCenter(s);
      setInput(pl, g.x, g.y);
    }
  });
}

function stage6Script(players, s, ctx) {
  players.forEach((pl, i) => {
    if (!crossPlatform(pl, s.platforms[0], 610, 280)) return;
    const myKeyId = i === 0 ? "k1" : "k2";
    const myKey = s.keys.find((k) => k.id === myKeyId);
    if (myKey && !myKey.collected) {
      setInput(pl, myKey.x, myKey.y);
    } else {
      const g = goalCenter(s);
      setInput(pl, g.x, g.y);
    }
  });
}

function stage7Script(players, s, ctx) {
  players.forEach((pl, i) => {
    if (!ctx.satisfied.g1) {
      const gp = s.plates.filter((p) => p.group === "g1");
      const plate = gp[i % gp.length];
      setInput(pl, plate.x, plate.y);
      return;
    }
    if (pl.x < 745) {
      setInput(pl, 760, 400); // 첫 번째 문 통로(y 250~550)를 지나 온전히 오른쪽으로 넘어간다
      return;
    }
    if (!ctx.satisfied.gAll) {
      const gp = s.plates.filter((p) => p.group === "gAll");
      const plate = gp[i % gp.length];
      setInput(pl, plate.x, plate.y);
      return;
    }
    if (pl.x < 1195) {
      setInput(pl, 1210, 400); // 두 번째 문 통로도 y=400 라인을 지나 넘어간다
      return;
    }
    if (s.collectedKeys < s.totalKeys) {
      setInput(pl, 1500, 400);
    } else {
      const g = goalCenter(s);
      setInput(pl, g.x, g.y);
    }
  });
}

function stage8Script(players, s, ctx) {
  players.forEach((pl, i) => {
    if (!crossPlatform(pl, s.platforms[0], 560, 280)) return;
    if (!crossPlatform(pl, s.platforms[1], 960, 680)) return;
    if (!crossPlatform(pl, s.platforms[2], 1210, 1030)) return;
    if (!ctx.satisfied.g1) {
      const gp = s.plates.filter((p) => p.group === "g1");
      const plate = gp[i % gp.length];
      setInput(pl, plate.x, plate.y);
      return;
    }
    if (s.collectedKeys < s.totalKeys) {
      setInput(pl, 1750, 400);
    } else {
      const g = goalCenter(s);
      setInput(pl, g.x, g.y);
    }
  });
}

function stage9Script(players, s, ctx) {
  players.forEach((pl, i) => {
    if (!crossPlatform(pl, s.platforms[0], 610, 280)) return;
    if (pl.x < 1030) {
      setInput(pl, 1070, 650); // 벽(x1000, y0~550) 아래로 돌아서 넘어간다
      return;
    }
    if (!ctx.satisfied.gAll) {
      const gp = s.plates.filter((p) => p.group === "gAll");
      const plate = gp[i % gp.length];
      setInput(pl, plate.x, plate.y);
      return;
    }
    if (pl.x < 1210) {
      setInput(pl, 1240, 150); // 문 통로(y 40~260)를 지나 넘어간다
      return;
    }
    if (s.collectedKeys < s.totalKeys) {
      setInput(pl, 1350, 120);
    } else {
      const g = goalCenter(s);
      setInput(pl, g.x, g.y);
    }
  });
}

function stage10Script(players, s, ctx) {
  players.forEach((pl, i) => {
    const platformIdx = i % 2 === 0 ? 0 : 1;
    const myKeyId = i % 2 === 0 ? "k1" : "k2";
    if (!crossPlatform(pl, s.platforms[platformIdx], 580, 280)) return;
    const myKey = s.keys.find((k) => k.id === myKeyId);
    if (myKey && !myKey.collected) {
      setInput(pl, myKey.x, myKey.y);
    } else if (s.collectedKeys < s.totalKeys) {
      const g = goalCenter(s);
      setInput(pl, g.x - 100, g.y);
    } else {
      const g = goalCenter(s);
      setInput(pl, g.x, g.y);
    }
  });
}

function stage11Script(players, s, ctx) {
  players.forEach((pl) => {
    if (!crossPlatform(pl, s.platforms[0], 560, 280)) return;
    if (s.collectedKeys < s.totalKeys) {
      setInput(pl, 1350, 400);
    } else {
      const g = goalCenter(s);
      setInput(pl, g.x, g.y);
    }
  });
}

function stage12Script(players, s, ctx) {
  players.forEach((pl, i) => {
    if (!crossPlatform(pl, s.platforms[0], 610, 280)) return;
    if (!ctx.satisfied.g1) {
      const gp = s.plates.filter((p) => p.group === "g1");
      const plate = gp[i % gp.length];
      setInput(pl, plate.x, plate.y);
      return;
    }
    if (pl.x < 735) {
      setInput(pl, 750, 425); // 첫 번째 문 통로(y 275~575)를 지나 넘어간다
      return;
    }
    if (!ctx.satisfied.gAll) {
      const gp = s.plates.filter((p) => p.group === "gAll");
      const plate = gp[i % gp.length];
      setInput(pl, plate.x, plate.y);
      return;
    }
    if (pl.x < 1165) {
      setInput(pl, 1180, 150); // 두 번째 문 통로(y 40~260)를 지나 넘어간다
      return;
    }
    if (s.collectedKeys < s.totalKeys) {
      const remaining = s.keys.find((k) => !k.collected);
      if (remaining) setInput(pl, remaining.x, remaining.y);
    } else {
      const g = goalCenter(s);
      setInput(pl, g.x, g.y);
    }
  });
}

function stage13Script(players, s, ctx) {
  players.forEach((pl, i) => {
    const platformIdx = i % 2 === 0 ? 0 : 1;
    const myKeyId = i % 2 === 0 ? "k1" : "k2";
    if (!crossPlatform(pl, s.platforms[platformIdx], 580, 280)) return;
    const myKey = s.keys.find((k) => k.id === myKeyId);
    if (myKey && !myKey.collected) {
      setInput(pl, myKey.x, myKey.y);
      return;
    }
    if (pl.x < 1330) {
      setInput(pl, 1370, 700); // 벽(x1300, y0~580) 아래로 돌아간다
      return;
    }
    if (!ctx.satisfied.gAll) {
      const gp = s.plates.filter((p) => p.group === "gAll");
      const plate = gp[i % gp.length];
      setInput(pl, plate.x, plate.y);
      return;
    }
    if (pl.x < 1510) {
      setInput(pl, 1540, 150); // 전원 압력판 문 통로(y 40~260)를 지나 넘어간다
      return;
    }
    if (s.collectedKeys < s.totalKeys) {
      setInput(pl, 1650, 150);
    } else {
      const g = goalCenter(s);
      setInput(pl, g.x, g.y);
    }
  });
}

const CASES = [
  { idx: 3, name: "stage4 두 번의 도약", players: 2, max: 40, script: stage4Script },
  { idx: 4, name: "stage5 네 명의 발판", players: 2, max: 40, script: stage5Script },
  { idx: 5, name: "stage6 갈림길", players: 2, max: 40, script: stage6Script },
  { idx: 6, name: "stage7 이중 관문", players: 2, max: 40, script: stage7Script },
  { idx: 7, name: "stage8 삼중 도약", players: 2, max: 50, script: stage8Script },
  { idx: 8, name: "stage9 협동의 정석", players: 2, max: 40, script: stage9Script },
  { idx: 9, name: "stage10 엇갈린 리듬", players: 2, max: 40, script: stage10Script },
  { idx: 10, name: "stage11 빠른 발판", players: 2, max: 30, script: stage11Script },
  { idx: 11, name: "stage12 총력전", players: 2, max: 50, script: stage12Script },
  { idx: 12, name: "stage13 그랜드 피날레", players: 2, max: 60, script: stage13Script },
];

(async () => {
  console.log("=== 신규 협동 스테이지4~13 자동 클리어 검증 ===\n");
  let failCount = 0;
  for (const c of CASES) {
    const result = runStage(c.idx, c.players, c.max, c.script);
    if (result.ok) {
      console.log(`✅ [${c.name}] ${result.seconds}s 만에 클리어`);
    } else {
      failCount++;
      console.error(`❌ [${c.name}] 실패: ${result.reason}`);
    }
  }
  console.log("\n=== 결과:", failCount === 0 ? "전체 통과" : `${failCount}건 실패`, "===");
  process.exit(failCount === 0 ? 0 : 1);
})();
