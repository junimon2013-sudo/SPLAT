// server/games/competition/FishingGame.js
// 낚시 - 사이드모드, 이동 없음. 찌를 던지고 대기 -> "!" -> 스페이스로 2D 낚시 미니게임(WASD) -> 성공/실패.
const {
  FISH, TIER_NAME_COLOR, UNKNOWN_50_COLOR,
  WAIT_TIME_TABLE, CATCH_ZONE_TABLE, LUCK_TABLE, GAUGE_TABLE,
  GAUGE_START, GAUGE_WIN, GAUGE_FAIL_HOLD_MS, ROD_SIZE_MULT,
} = require("./FishingData.js");

const DURATION = 180;
const FISH_BY_ID = Object.fromEntries(FISH.map((f) => [f.id, f]));

// 확률표(운 레벨)로 물고기 하나를 뽑는다(1~50번, 51번은 별도 강제 등장이라 여기 포함 안 됨)
function rollFish(luckLv) {
  const roll = Math.random() * 100;
  let acc = 0;
  for (let id = 1; id <= 50; id++) {
    acc += LUCK_TABLE[id][luckLv];
    if (roll < acc) return FISH_BY_ID[id];
  }
  return FISH_BY_ID[50];
}

class FishingGame {
  static id = "fishing";
  static displayName = "낚시";
  static description = "찌를 던지고 기다리다 '!'가 뜨면 스페이스! 2D 낚시판에서 WASD로 물고기를 붙잡아라.";
  static enhancementItems = ["운", "낚싯대"];
  static rankPoints = [3, 2, 1];

  constructor(room, enhanceLevels) {
    this.room = room;
    this.enhanceLevels = enhanceLevels || {};
    this.t = 0;
    this.finished = false;
    const players = room.getAlivePlayers();
    players.forEach((pl, i) => {
      pl.status = "playing";
      pl.x = 150 + i * 160;
      pl.y = 500;
      pl.gameData.score = 0;
      pl.gameData.dex = {}; // fishId -> true(도감에 기록됨)
      pl.gameData.caughtGangodeungeo = false; // 40번을 잡았는지(51번 강제등장 트리거)
      pl.gameData.pendingForced51 = false;
      this._resetToIdle(pl);
    });
  }

  _getLevel(playerId, itemName) {
    const lv = this.enhanceLevels[playerId] && this.enhanceLevels[playerId][itemName];
    return lv || 0;
  }

  _resetToIdle(pl) {
    pl.gameData.phase = "idle"; // idle(안 던짐) -> waiting(대기) -> bite(!) -> minigame
    pl.gameData.waitT = 0;
    pl.gameData.waitFor = 0;
    pl.gameData.fish = null;
    // pendingForced51은 여기서 건드리지 않는다 - 성공 처리 직후 이 함수가 호출되므로,
    // 방금 세팅된 "다음 판은 51번 강제 등장" 예약이 여기서 지워지면 안 된다
  }

  _startCast(pl) {
    const luckLv = this._getLevel(pl.id, "운");
    const rodLv = this._getLevel(pl.id, "낚싯대");
    let fish;
    if (pl.gameData.debugForcedFishId) {
      fish = FISH_BY_ID[pl.gameData.debugForcedFishId];
      pl.gameData.debugForcedFishId = null;
    } else if (pl.gameData.pendingForced51) {
      fish = FISH_BY_ID[51];
      pl.gameData.pendingForced51 = false;
    } else {
      fish = rollFish(luckLv);
    }
    pl.gameData.fish = fish;
    pl.gameData.phase = "waiting";
    pl.gameData.waitT = 0;
    // 51번은 강제로 5초 캐스팅 고정, 그 외엔 등급별 대기시간표(낚싯대 강화 반영)
    pl.gameData.waitFor = fish.id === 51 ? 5 : WAIT_TIME_TABLE[fish.tier - 1][rodLv];
  }

  _startMinigame(pl) {
    const fish = pl.gameData.fish;
    const rodLv = this._getLevel(pl.id, "낚싯대");
    pl.gameData.phase = "minigame";
    pl.gameData.gauge = GAUGE_START;
    pl.gameData.failHoldT = 0;
    const zone = CATCH_ZONE_TABLE[fish.tier - 1][rodLv];
    pl.gameData.zoneW = zone[0];
    pl.gameData.zoneH = zone[1];
    pl.gameData.baseZoneW = zone[0];
    pl.gameData.baseZoneH = zone[1];
    pl.gameData.rodSizeMult = ROD_SIZE_MULT(rodLv);
    // 미니게임 내부 좌표계(판정범위 중심 기준 -zoneW/2 ~ +zoneW/2)
    pl.gameData.miniX = 0; pl.gameData.miniY = 0; // 미니 플레이어 위치
    pl.gameData.fishX = 0; pl.gameData.fishY = 0; // 물고기(목표) 위치
    pl.gameData.fishPatternT = 0;
    // 스킬(고대/우주 등급) 관련 상태
    pl.gameData.skillTimer = 0;
    pl.gameData.skillPhase = null; // 스킬별로 자유롭게 쓰는 상태 문자열
    pl.gameData.skillPhaseT = 0;
    pl.gameData.downMult = 1; // 스택 감소 속도 배율(스킬로 일시 증가 가능)
    pl.gameData.forceKnockX = 0; pl.gameData.forceKnockY = 0; // 플레이어 강제 이동력(중력장/해류 등)
    pl.gameData.hidden = false; // 물고기가 안 보이는 상태(공허/암흑 등)
    pl.gameData.decoys = []; // 가짜 목표 위치들(분열/성운 등)
    pl.gameData.frozen = false; // 시간정지 스킬로 전체가 멈춘 상태
    pl.gameData.forcedFailTimer = 0; // 50번 오류스킬 강제실패용
  }

  // 물고기 패턴에 따라 목표 위치를 갱신한다. 카테고리별 공용 패턴 + 개별 오프셋으로 다양성을 준다
  _updateFishPattern(pl, dt) {
    const fish = pl.gameData.fish;
    pl.gameData.fishPatternT += dt;
    const t = pl.gameData.fishPatternT;
    const hw = pl.gameData.zoneW / 2, hh = pl.gameData.zoneH / 2;
    const spd = Array.isArray(fish.speed) ? fish.speed[1] : fish.speed;
    const id = fish.id;
    const freq = spd / 60; // 속도가 빠를수록 왕복 주기가 짧아진다
    switch (true) {
      case id === 1 || id === 2: // 느린 좌우/상하 왕복
        pl.gameData.fishX = Math.sin(t * freq) * hw * 0.8;
        pl.gameData.fishY = id === 2 ? Math.sin(t * freq) * hh * 0.8 : 0;
        break;
      case id === 3: // 아래쪽 좌우 왕복
        pl.gameData.fishX = Math.sin(t * freq) * hw * 0.8;
        pl.gameData.fishY = hh * 0.5;
        break;
      case id === 4 || id === 12: // 짧은 지그재그 / 대각선 지그재그
        pl.gameData.fishX = Math.sin(t * freq * 2) * hw * 0.7;
        pl.gameData.fishY = Math.sin(t * freq * 3.3) * hh * 0.7;
        break;
      case id === 5 || id === 15 || id === 18 || id === 21 || id === 28: { // 느린이동->돌진 계열
        const cyc = t % 2.5;
        const dash = cyc > 1.8;
        pl.gameData.fishX = dash ? Math.sign(Math.sin(t)) * hw * 0.9 : Math.sin(t * 0.6) * hw * 0.3;
        pl.gameData.fishY = Math.sin(t * 0.5) * hh * 0.4;
        break;
      }
      case id === 6: // 대각선 왕복
        pl.gameData.fishX = Math.sin(t * freq) * hw * 0.8;
        pl.gameData.fishY = Math.sin(t * freq) * hh * 0.8;
        break;
      case id === 7: // 작은 원형 이동
        pl.gameData.fishX = Math.cos(t * freq) * hw * 0.4;
        pl.gameData.fishY = Math.sin(t * freq) * hh * 0.4;
        break;
      case id === 8 || id === 25: { // 짧게 튀었다 정지 / 짧은 순간이동
        const cyc2 = t % 0.6;
        if (cyc2 < 0.05 && !pl.gameData._jumped) {
          pl.gameData.fishX = (Math.random() * 2 - 1) * hw * 0.8;
          pl.gameData.fishY = (Math.random() * 2 - 1) * hh * 0.8;
          pl.gameData._jumped = true;
        } else if (cyc2 >= 0.05) pl.gameData._jumped = false;
        break;
      }
      case id === 9: // 바닥 좌우 이동
        pl.gameData.fishX = Math.sin(t * freq) * hw * 0.8;
        pl.gameData.fishY = hh * 0.6;
        break;
      case id === 10 || id === 23: // 느린 불규칙 / 거의 정지
        pl.gameData.fishX = Math.sin(t * 0.3) * hw * 0.3 + Math.sin(t * 0.7) * hw * 0.1;
        pl.gameData.fishY = Math.cos(t * 0.4) * hh * 0.3;
        break;
      case id === 11 || id === 17: // 빠른 좌우 왕복 / 불규칙 점프
        pl.gameData.fishX = Math.sin(t * freq) * hw * 0.85;
        pl.gameData.fishY = Math.sin(t * freq * 1.7) * hh * 0.5;
        break;
      case id === 13 || id === 24: { // 바닥->상승->바닥 / 대각선->돌진
        const cyc3 = (t % 3) / 3;
        pl.gameData.fishY = Math.sin(cyc3 * Math.PI) * -hh * 0.8 + hh * 0.4;
        pl.gameData.fishX = Math.sin(t * 0.4) * hw * 0.5;
        break;
      }
      case id === 14: // 상승->빠른 하강
        pl.gameData.fishY = ((t % 1.2) < 0.9 ? -1 + (t % 1.2) / 0.9 * 2 : 1 - ((t % 1.2) - 0.9) / 0.3 * 2) * hh * 0.8;
        pl.gameData.fishX = Math.sin(t * 0.5) * hw * 0.4;
        break;
      case id === 16: // 느린 이동 -> 방향 전환
        pl.gameData.fishX = Math.sin(t * 0.5) * hw * 0.7;
        pl.gameData.fishY = Math.sign(Math.sin(t * 0.5)) * hh * 0.3;
        break;
      case id === 19 || id === 26: // 느린 부유 / 벽 통과(느긋한 부유로 표현)
        pl.gameData.fishX = Math.sin(t * 0.3) * hw * 0.6;
        pl.gameData.fishY = Math.cos(t * 0.25) * hh * 0.6;
        break;
      case id === 20: // 큰 곡선 이동
        pl.gameData.fishX = Math.sin(t * 0.5) * hw * 0.85;
        pl.gameData.fishY = Math.sin(t * 0.25) * hh * 0.6;
        break;
      case id === 22: // 플레이어 주변 선회
        pl.gameData.fishX = Math.cos(t * freq) * hw * 0.6 + pl.gameData.miniX * 0.3;
        pl.gameData.fishY = Math.sin(t * freq) * hh * 0.6 + pl.gameData.miniY * 0.3;
        break;
      case id === 27 || id === 29: // 불규칙 다방향 / 출현->소멸
        pl.gameData.fishX = Math.sin(t * 0.7 + Math.sin(t * 0.3)) * hw * 0.8;
        pl.gameData.fishY = Math.cos(t * 0.6 + Math.cos(t * 0.4)) * hh * 0.8;
        break;
      case id === 30: { // 느림->고속 추적
        const dx = pl.gameData.miniX - pl.gameData.fishX, dy = pl.gameData.miniY - pl.gameData.fishY;
        const dd = Math.hypot(dx, dy) || 1;
        const chaseSpd = 60 * dt;
        pl.gameData.fishX += (dx / dd) * chaseSpd;
        pl.gameData.fishY += (dy / dd) * chaseSpd;
        pl.gameData.fishX = Math.max(-hw, Math.min(hw, pl.gameData.fishX));
        pl.gameData.fishY = Math.max(-hh, Math.min(hh, pl.gameData.fishY));
        break;
      }
      default: // 고대/우주 등급(31~51) - 기본 이동은 완만하게, 실제 개성은 스킬에서 나온다
        pl.gameData.fishX = Math.sin(t * 0.4) * hw * 0.5;
        pl.gameData.fishY = Math.cos(t * 0.35) * hh * 0.5;
    }
  }

  // 고대(31~40)/우주(41~51) 물고기의 특수 스킬을 처리한다
  _updateSkill(pl, dt) {
    const fish = pl.gameData.fish;
    if (fish.tier < 4) return;
    pl.gameData.skillTimer += dt;
    const hw = pl.gameData.zoneW / 2, hh = pl.gameData.zoneH / 2;
    const id = fish.id;

    switch (id) {
      case 31: // 태고의 잉어 - 시간 도약(주기적 순간이동)
        if (pl.gameData.skillTimer > 3) {
          pl.gameData.skillTimer = 0;
          pl.gameData.fishX = (Math.random() * 2 - 1) * hw * 0.8;
          pl.gameData.fishY = (Math.random() * 2 - 1) * hh * 0.8;
        }
        break;
      case 32: { // 석화거북 - 일정 시간 범위가 매우 작아짐
        const cyc = pl.gameData.skillTimer % 5;
        pl.gameData.zoneW = cyc > 3.5 ? pl.gameData.baseZoneW * 0.35 : pl.gameData.baseZoneW;
        pl.gameData.zoneH = cyc > 3.5 ? pl.gameData.baseZoneH * 0.35 : pl.gameData.baseZoneH;
        break;
      }
      case 33: // 고대해룡 - 해류(플레이어를 한쪽으로 밀어냄)
        if (pl.gameData.skillTimer > 4) {
          pl.gameData.skillTimer = 0;
          const ang = Math.random() * Math.PI * 2;
          pl.gameData.forceKnockX = Math.cos(ang) * 90;
          pl.gameData.forceKnockY = Math.sin(ang) * 90;
          pl.gameData.skillPhaseT = 0.6;
        }
        if (pl.gameData.skillPhaseT > 0) { pl.gameData.skillPhaseT -= dt; if (pl.gameData.skillPhaseT <= 0) { pl.gameData.forceKnockX = 0; pl.gameData.forceKnockY = 0; } }
        break;
      case 34: // 화석문어 - 분열(가짜 범위 하나)
        if (pl.gameData.skillTimer > 3.5) {
          pl.gameData.skillTimer = 0;
          pl.gameData.decoys = [{ x: (Math.random() * 2 - 1) * hw * 0.8, y: (Math.random() * 2 - 1) * hh * 0.8, life: 2.5 }];
        }
        pl.gameData.decoys.forEach((d) => (d.life -= dt));
        pl.gameData.decoys = pl.gameData.decoys.filter((d) => d.life > 0);
        break;
      case 35: // 거인의 메기 - 급상승
        if (pl.gameData.skillTimer > 3) {
          pl.gameData.skillTimer = 0;
          pl.gameData.fishY = -hh * 0.9;
        }
        break;
      case 36: // 태초의 거북 - 역행(경로를 거꾸로) - 단순화: 주기적으로 살짝 반대 방향 이동
        pl.gameData.fishX = -Math.sin(pl.gameData.fishPatternT * 0.4) * hw * 0.5;
        pl.gameData.fishY = -Math.cos(pl.gameData.fishPatternT * 0.35) * hh * 0.5;
        break;
      case 37: // 시간을 먹는 물고기 - 범위 밖 스택감소 가속
        pl.gameData.downMult = 2;
        break;
      case 38: // 멸망의 고래 - 대재앙(화면 전체 이동 후 복귀)
        if (pl.gameData.skillTimer > 4) {
          pl.gameData.skillTimer = 0;
          pl.gameData.skillPhase = "sweep";
          pl.gameData.skillPhaseT = 0;
        }
        if (pl.gameData.skillPhase === "sweep") {
          pl.gameData.skillPhaseT += dt;
          const p = Math.min(1, pl.gameData.skillPhaseT / 1.2);
          pl.gameData.fishX = Math.sin(p * Math.PI) * hw * (p < 0.5 ? 1 : -1);
          if (p >= 1) pl.gameData.skillPhase = null;
        }
        break;
      case 39: // 태고의 바다뱀 - 물결 모양 계속 이동
        pl.gameData.fishX = Math.sin(pl.gameData.fishPatternT * 0.8) * hw * 0.8;
        pl.gameData.fishY = Math.sin(pl.gameData.fishPatternT * 1.6) * hh * 0.5;
        break;
      case 40: // 간고등어 - 스킬 없음
        break;
      case 41: // 태초의 어신 - 창세(크기+위치 지속 변화, 변화시 스택가속)
        if (pl.gameData.skillTimer > 2) {
          pl.gameData.skillTimer = 0;
          pl.gameData.zoneW = pl.gameData.baseZoneW * (0.5 + Math.random());
          pl.gameData.zoneH = pl.gameData.baseZoneH * (0.5 + Math.random());
          pl.gameData.fishX = (Math.random() * 2 - 1) * hw * 0.7;
          pl.gameData.fishY = (Math.random() * 2 - 1) * hh * 0.7;
          pl.gameData.downMult = 2.5;
          pl.gameData.skillPhaseT = 0.5;
        }
        if (pl.gameData.skillPhaseT > 0) { pl.gameData.skillPhaseT -= dt; if (pl.gameData.skillPhaseT <= 0) pl.gameData.downMult = 1; }
        break;
      case 42: // 암흑해파리 - 암흑(클라이언트에 어둠 신호), 위치 주기적 랜덤화
        pl.gameData.darkActive = true;
        if (pl.gameData.skillTimer > 3) {
          pl.gameData.skillTimer = 0;
          pl.gameData.darkX = (Math.random() * 2 - 1) * hw;
          pl.gameData.darkY = (Math.random() * 2 - 1) * hh;
        }
        break;
      case 43: // 차원유영자 - 차원이동(연속 2회)
        if (pl.gameData.skillTimer > 3.5) {
          pl.gameData.skillTimer = 0;
          pl.gameData.hidden = true;
          pl.gameData.skillPhase = "jump1";
          pl.gameData.skillPhaseT = 0;
        }
        if (pl.gameData.skillPhase === "jump1") {
          pl.gameData.skillPhaseT += dt;
          if (pl.gameData.skillPhaseT > 0.3) {
            pl.gameData.fishX = (Math.random() * 2 - 1) * hw * 0.8;
            pl.gameData.fishY = (Math.random() * 2 - 1) * hh * 0.8;
            pl.gameData.skillPhase = "jump2"; pl.gameData.skillPhaseT = 0;
          }
        } else if (pl.gameData.skillPhase === "jump2") {
          pl.gameData.skillPhaseT += dt;
          if (pl.gameData.skillPhaseT > 0.25) {
            pl.gameData.fishX = (Math.random() * 2 - 1) * hw * 0.8;
            pl.gameData.fishY = (Math.random() * 2 - 1) * hh * 0.8;
            pl.gameData.hidden = false;
            pl.gameData.skillPhase = null;
          }
        }
        break;
      case 44: { // 은하초월룡 - 중력장(가까울수록 이동방향이 휨) - miniX/Y 업데이트 이후 보정치를 forceKnock로 제공
        const dx = pl.gameData.fishX - pl.gameData.miniX, dy = pl.gameData.fishY - pl.gameData.miniY;
        const dd = Math.hypot(dx, dy) || 1;
        const strength = Math.max(0, 1 - dd / (hw + hh)) * 40;
        pl.gameData.forceKnockX = (-dy / dd) * strength;
        pl.gameData.forceKnockY = (dx / dd) * strength;
        break;
      }
      case 45: { // 블랙홀피쉬 - 사건의 지평선(중심으로 끌어당김)
        const dx = pl.gameData.fishX - pl.gameData.miniX, dy = pl.gameData.fishY - pl.gameData.miniY;
        const dd = Math.hypot(dx, dy) || 1;
        const pull = Math.max(0, 1 - dd / (hw + hh)) * 70;
        pl.gameData.forceKnockX = (dx / dd) * pull;
        pl.gameData.forceKnockY = (dy / dd) * pull;
        break;
      }
      case 46: // 성운해파리 - 가짜 범위 여러개
        if (pl.gameData.decoys.length === 0 && pl.gameData.skillTimer > 1) {
          pl.gameData.skillTimer = 0;
          pl.gameData.decoys = [0, 1, 2].map(() => ({
            x: (Math.random() * 2 - 1) * hw * 0.8, y: (Math.random() * 2 - 1) * hh * 0.8, life: 4,
          }));
        }
        pl.gameData.decoys.forEach((d) => (d.life -= dt));
        pl.gameData.decoys = pl.gameData.decoys.filter((d) => d.life > 0);
        break;
      case 47: // 초신성고래 - 극소화->확장->소멸->재등장
        if (pl.gameData.skillTimer > 5 && pl.gameData.skillPhase == null) {
          pl.gameData.skillTimer = 0;
          pl.gameData.skillPhase = "shrink"; pl.gameData.skillPhaseT = 0;
        }
        if (pl.gameData.skillPhase === "shrink") {
          pl.gameData.skillPhaseT += dt;
          const p = Math.min(1, pl.gameData.skillPhaseT / 0.5);
          pl.gameData.zoneW = pl.gameData.baseZoneW * (1 - p * 0.9);
          pl.gameData.zoneH = pl.gameData.baseZoneH * (1 - p * 0.9);
          if (p >= 1) { pl.gameData.skillPhase = "hidden"; pl.gameData.skillPhaseT = 0; pl.gameData.hidden = true; pl.gameData.downMult = 3; }
        } else if (pl.gameData.skillPhase === "hidden") {
          pl.gameData.skillPhaseT += dt;
          if (pl.gameData.skillPhaseT > 0.6) {
            pl.gameData.hidden = false; pl.gameData.downMult = 1;
            pl.gameData.zoneW = pl.gameData.baseZoneW; pl.gameData.zoneH = pl.gameData.baseZoneH;
            pl.gameData.fishX = (Math.random() * 2 - 1) * hw * 0.7;
            pl.gameData.fishY = (Math.random() * 2 - 1) * hh * 0.7;
            pl.gameData.skillPhase = null;
          }
        }
        break;
      case 48: // 시간포식자 - 시간정지(전체 정지 후 위치 랜덤이동)
        if (pl.gameData.skillTimer > 5 && !pl.gameData.frozen) {
          pl.gameData.skillTimer = 0;
          pl.gameData.frozen = true;
          pl.gameData.skillPhaseT = 1.2;
        }
        if (pl.gameData.frozen) {
          pl.gameData.skillPhaseT -= dt;
          if (pl.gameData.skillPhaseT <= 0) {
            pl.gameData.frozen = false;
            pl.gameData.fishX = (Math.random() * 2 - 1) * hw * 0.8;
            pl.gameData.fishY = (Math.random() * 2 - 1) * hh * 0.8;
          }
        }
        break;
      case 49: // 공허문어 - 공허화(안 보임+스택가속+재등장)
        if (pl.gameData.skillTimer > 4 && !pl.gameData.hidden) {
          pl.gameData.skillTimer = 0;
          pl.gameData.hidden = true;
          pl.gameData.downMult = 3;
          pl.gameData.skillPhaseT = 1.5;
        }
        if (pl.gameData.hidden) {
          pl.gameData.skillPhaseT -= dt;
          if (pl.gameData.skillPhaseT <= 0) {
            pl.gameData.hidden = false;
            pl.gameData.downMult = 1;
            pl.gameData.fishX = (Math.random() * 2 - 1) * hw * 0.8;
            pl.gameData.fishY = (Math.random() * 2 - 1) * hh * 0.8;
          }
        }
        break;
      case 50: // ??? - 오류(전부 무작위 + 1/8 즉시강제실패)
        if (pl.gameData.skillTimer > 2.5) {
          pl.gameData.skillTimer = 0;
          pl.gameData.zoneW = pl.gameData.baseZoneW * (0.4 + Math.random() * 1.2);
          pl.gameData.zoneH = pl.gameData.baseZoneH * (0.4 + Math.random() * 1.2);
          pl.gameData.fishX = (Math.random() * 2 - 1) * hw * 0.8;
          pl.gameData.fishY = (Math.random() * 2 - 1) * hh * 0.8;
          pl.gameData.errorGlitch = true;
          if (Math.random() < 1 / 8) pl.gameData.forcedFailTimer = 0.1; // 다음 프레임에 강제 실패 처리
        }
        break;
    }
  }

  update(dt) {
    if (this.finished) return true;
    this.t += dt;
    const players = this.room.getAlivePlayers();

    players.forEach((pl) => {
      const phase = pl.gameData.phase;
      if (phase === "idle") {
        if (pl.actionPressed()) this._startCast(pl);
      } else if (phase === "waiting") {
        pl.gameData.waitT += dt;
        if (pl.gameData.waitT >= pl.gameData.waitFor) {
          pl.gameData.phase = "bite";
          this.room.broadcastEvent("fish_bite", { id: pl.id });
        }
      } else if (phase === "bite") {
        if (pl.actionPressed()) this._startMinigame(pl);
      } else if (phase === "minigame") {
        // 시간정지 스킬(48번)이면 아무것도 갱신하지 않고 그대로 멈춘다
        if (!pl.gameData.frozen) {
          this._updateFishPattern(pl, dt);
        }
        this._updateSkill(pl, dt);
        // 50번 오류 스킬의 1/8 강제실패가 예약되어 있으면 즉시 실패 처리
        if (pl.gameData.forcedFailTimer > 0) {
          pl.gameData.forcedFailTimer -= dt;
          if (pl.gameData.forcedFailTimer <= 0) {
            this.room.broadcastEvent("fish_missed", { id: pl.id, name: pl.gameData.fish.name, forced: true });
            this._resetToIdle(pl);
            pl.commitInputFrame();
            return;
          }
        }
        // WASD로 미니 플레이어 이동(+ 스킬로 인한 강제 이동력 - 해류/중력장/블랙홀 등)
        let mx = 0, my = 0;
        if (!pl.gameData.frozen) {
          if (pl.input.up) my -= 1;
          if (pl.input.down) my += 1;
          if (pl.input.left) mx -= 1;
          if (pl.input.right) mx += 1;
        }
        const len = Math.sqrt(mx * mx + my * my) || 1;
        mx /= len; my /= len;
        const MINI_SPEED = 140;
        const hw = pl.gameData.zoneW / 2, hh = pl.gameData.zoneH / 2;
        if (!pl.gameData.frozen) {
          pl.gameData.miniX = Math.max(-hw, Math.min(hw, pl.gameData.miniX + (mx * MINI_SPEED + (pl.gameData.forceKnockX || 0)) * dt));
          pl.gameData.miniY = Math.max(-hh, Math.min(hh, pl.gameData.miniY + (my * MINI_SPEED + (pl.gameData.forceKnockY || 0)) * dt));
        }

        // 겹침 판정 - 미니 플레이어와 물고기 사이 거리가 충분히 가까우면 "붙잡은" 상태. 물고기가 안 보이는(hidden) 상태면 못 잡음
        const fish = pl.gameData.fish;
        const catchRadius = 22 * pl.gameData.rodSizeMult;
        const distToFish = Math.hypot(pl.gameData.miniX - pl.gameData.fishX, pl.gameData.miniY - pl.gameData.fishY);
        const holding = !pl.gameData.hidden && !pl.gameData.frozen && distToFish < catchRadius;
        // 가짜 범위(디코이)에 들어가면 스택이 빠르게 감소한다
        const inDecoy = (pl.gameData.decoys || []).some((d) => Math.hypot(pl.gameData.miniX - d.x, pl.gameData.miniY - d.y) < catchRadius);

        let up, down;
        if (fish.special === "gangodeungeo") {
          up = 10; down = 0; // 간고등어 - 강화 무관 고정
        } else {
          const g = GAUGE_TABLE[fish.id][this._getLevel(pl.id, "낚싯대")];
          up = g[0]; down = g[1];
        }
        const downMult = pl.gameData.downMult || 1;
        if (pl.gameData.frozen) {
          // 시간정지 중엔 게이지도 그대로 유지
        } else if (inDecoy) {
          pl.gameData.gauge -= down * 3 * dt; // 디코이 페널티(3배속 감소)
        } else {
          pl.gameData.gauge += (holding ? up : -down * downMult) * dt;
        }
        pl.gameData.gauge = Math.max(0, Math.min(GAUGE_WIN, pl.gameData.gauge));

        if (pl.gameData.gauge <= 0) {
          pl.gameData.failHoldT += dt;
          if (pl.gameData.failHoldT >= GAUGE_FAIL_HOLD_MS / 1000) {
            this.room.broadcastEvent("fish_missed", { id: pl.id, name: fish.name });
            this._resetToIdle(pl);
          }
        } else {
          pl.gameData.failHoldT = 0;
        }
        if (pl.gameData.gauge >= GAUGE_WIN) {
          pl.gameData.score += fish.points;
          pl.gameData.dex[fish.id] = true;
          if (fish.special === "gangodeungeo") {
            pl.gameData.caughtGangodeungeo = true;
            pl.gameData.pendingForced51 = true; // 다음 캐스팅 때 51번 강제 등장
          }
          this.room.broadcastEvent("fish_caught", { id: pl.id, fishId: fish.id, name: fish.name, points: fish.points, tier: fish.tier });
          this._resetToIdle(pl);
        }
        // 포기하기(대시 키를 "포기"로 재사용)
        if (pl.dashPressed()) {
          this.room.broadcastEvent("fish_gaveup", { id: pl.id, name: fish.name });
          this._resetToIdle(pl);
        }
      }
      pl.commitInputFrame();
    });

    if (this.t >= DURATION) {
      this.finished = true;
      return true;
    }
    return false;
  }

  getRanking() {
    const players = this.room.getAlivePlayers();
    return players.map((p) => p.id).sort((a, b) => {
      const pa = players.find((p) => p.id === a).gameData.score;
      const pb = players.find((p) => p.id === b).gameData.score;
      return pb - pa;
    });
  }

  getScoreAwards() {
    const ranking = this.getRanking();
    const awards = {};
    const pts = FishingGame.rankPoints;
    ranking.forEach((pid, idx) => { awards[pid] = pts[idx] != null ? pts[idx] : 0; });
    return awards;
  }

  getStateJSON() {
    const players = this.room.getAlivePlayers();
    return {
      gameId: FishingGame.id,
      timeLeft: Math.max(0, Math.ceil(DURATION - this.t)),
      playerExtra: Object.fromEntries(
        players.map((p) => {
          const fish = p.gameData.fish;
          return [p.id, {
            score: p.gameData.score,
            phase: p.gameData.phase,
            fishName: fish ? fish.name : null,
            fishTier: fish ? fish.tier : null,
            fishDesc: fish ? fish.desc : null,
            nameColor: fish ? (fish.nameColor || (fish.id === 50 ? UNKNOWN_50_COLOR : TIER_NAME_COLOR[fish.tier])) : null,
            gauge: p.gameData.gauge,
            zoneW: p.gameData.zoneW, zoneH: p.gameData.zoneH,
            miniX: p.gameData.miniX, miniY: p.gameData.miniY,
            fishX: p.gameData.fishX, fishY: p.gameData.fishY,
            rodSizeMult: p.gameData.rodSizeMult,
            dexCount: Object.keys(p.gameData.dex).length,
            hidden: p.gameData.hidden,
            frozen: p.gameData.frozen,
            darkActive: p.gameData.darkActive,
            darkX: p.gameData.darkX, darkY: p.gameData.darkY,
            decoys: p.gameData.decoys,
            errorGlitch: p.gameData.errorGlitch,
          }];
        })
      ),
    };
  }

  // 관리자 패널 - 원하는 물고기를 강제로 결정한다(캐스팅 시점부터 적용)
  adminForceFish(playerId, fishId) {
    const pl = this.room.getAlivePlayers().find((p) => p.id === playerId);
    if (!pl) return;
    pl.gameData.debugForcedFishId = fishId;
  }
}

module.exports = FishingGame;
