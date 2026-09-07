// server/games/competition/EnhancementSystem.js
// 모든 미니게임에서 공용으로 쓰는 강화(스타포스) 시스템.
// 흐름: 해당 게임에 강화 항목이 있으면, 게임 시작 직전에 모든 플레이어가 동시에
// 항목마다 최대 30초씩 스타포스 타이밍 미니게임을 진행한다. 실패하면 그 항목은
// 마지막으로 성공한 레벨에서 멈추고, 30초가 지나면 자동으로 현재 레벨에서 멈춘다.

// +강화 단계별 [수식어, 성공zone이 전체 게이지에서 차지하는 비율(%)]
// +0은 항상 성공(사실상 강화 없이 바로 +1로 취급하기 위한 자리), +10은 최대치(더 이상 강화 불가)
const TIER_TABLE = [
  { level: 0, modifier: "썩어빠진", zonePercent: 200 }, // 무조건 성공
  { level: 1, modifier: "매우 낡은", zonePercent: 60 },
  { level: 2, modifier: "낡은", zonePercent: 40 },
  { level: 3, modifier: "부실한", zonePercent: 20 },
  { level: 4, modifier: "평범한", zonePercent: 17 },
  { level: 5, modifier: "쓸만한", zonePercent: 10 },
  { level: 6, modifier: "좋은", zonePercent: 5 },
  { level: 7, modifier: "위대한", zonePercent: 3 },
  { level: 8, modifier: "용사의", zonePercent: 2 },
  { level: 9, modifier: "전설의", zonePercent: 1 },
  { level: 10, modifier: "레전드", zonePercent: 0 }, // 최대치, 더 강화 불가
];

const ITEM_TIME_LIMIT = 30; // 항목마다 강화에 주어지는 시간(초)
const GAUGE_SPEED = 1.4; // 게이지 바가 왕복하는 속도(초당 왕복 비율, 0~1 구간을 왕복)

function tierFor(level) {
  return TIER_TABLE[Math.max(0, Math.min(10, level))];
}

// 실제 성공 zone 크기는 티어 기준 %에서 ±10% 랜덤으로 흔들리고, 위치는 게이지 안에서 무작위
function rollZone(level) {
  const base = tierFor(level).zonePercent;
  const jitter = 1 + (Math.random() * 0.2 - 0.1); // -10% ~ +10%
  const widthPercent = Math.max(0.5, base * jitter);
  const maxStart = Math.max(0, 100 - widthPercent);
  const start = Math.random() * maxStart;
  return { start, width: widthPercent };
}

class PlayerEnhancement {
  constructor(itemNames) {
    this.itemNames = itemNames; // 예: ["신발", "손"]
    this.levels = {}; // itemName -> 현재 강화 레벨(0~10)
    this.done = {}; // itemName -> 이 항목의 강화 세션이 끝났는지(성공/실패/시간초과로 종료)
    this.currentItemIndex = 0;
    this.itemTimer = 0;
    this.gaugePos = 0; // 0~1 왕복
    this.gaugeDir = 1;
    this.zone = null; // {start, width} 퍼센트 단위
    itemNames.forEach((name) => {
      this.levels[name] = 0;
      this.done[name] = false;
    });
    this._rollNewZone();
  }

  _rollNewZone() {
    const item = this.currentItem();
    if (!item) return;
    this.zone = rollZone(this.levels[item]);
    this.gaugePos = 0;
    this.gaugeDir = 1;
  }

  currentItem() {
    return this.itemNames[this.currentItemIndex] || null;
  }

  allDone() {
    return this.itemNames.every((name) => this.done[name]);
  }

  update(dt) {
    if (this.allDone()) return;
    const item = this.currentItem();
    if (!item || this.done[item]) {
      this._advanceItem();
      return;
    }
    this.itemTimer += dt;
    // 게이지 바 왕복 이동
    this.gaugePos += this.gaugeDir * GAUGE_SPEED * dt;
    if (this.gaugePos >= 1) { this.gaugePos = 1; this.gaugeDir = -1; }
    if (this.gaugePos <= 0) { this.gaugePos = 0; this.gaugeDir = 1; }
    if (this.itemTimer >= ITEM_TIME_LIMIT) {
      // 시간 초과 - 현재 레벨에서 그대로 멈추고 다음 항목으로
      this.done[item] = true;
      this._advanceItem();
    }
  }

  // 플레이어가 강화 버튼을 누른 순간 호출 - 성공/실패 판정. forceSuccess=true면(관리자 패널) 판정을 무시하고 이번 1회를 무조건 성공시킨다
  attemptEnhance(forceSuccess) {
    const item = this.currentItem();
    if (!item || this.done[item]) return null;
    const level = this.levels[item];
    if (level >= 10) { this.done[item] = true; this._advanceItem(); return { success: true, maxed: true }; }
    const posPercent = this.gaugePos * 100;
    const inZone = this.zone && posPercent >= this.zone.start && posPercent <= this.zone.start + this.zone.width;
    // +0(썩어빠진)은 무조건 성공 취급 - level 0에서 시도하면 항상 성공
    const success = forceSuccess || level === 0 ? true : !!inZone;
    if (success) {
      this.levels[item] = level + 1;
      if (this.levels[item] >= 10) {
        this.done[item] = true;
        this._advanceItem();
        return { success: true, maxed: true };
      }
      this.itemTimer = 0;
      this._rollNewZone();
      return { success: true };
    } else {
      // 실패 - 이 항목은 현재 레벨에서 멈추고 다음 항목으로
      this.done[item] = true;
      this._advanceItem();
      return { success: false };
    }
  }

  _advanceItem() {
    this.currentItemIndex++;
    this.itemTimer = 0;
    if (!this.allDone()) this._rollNewZone();
  }

  getStateJSON() {
    const item = this.currentItem();
    return {
      itemNames: this.itemNames,
      levels: this.levels,
      done: this.done,
      currentItem: item,
      itemTimeLeft: item ? Math.max(0, ITEM_TIME_LIMIT - this.itemTimer) : 0,
      gaugePos: this.gaugePos,
      zone: this.zone,
      allDone: this.allDone(),
    };
  }
}

// 방 전체(모든 플레이어)의 강화 페이즈를 관리
class EnhancementPhase {
  constructor(room, itemNames) {
    this.room = room;
    this.itemNames = itemNames;
    this.playerStates = {};
    room.getAlivePlayers().forEach((pl) => {
      this.playerStates[pl.id] = new PlayerEnhancement(itemNames);
    });
  }

  update(dt) {
    Object.values(this.playerStates).forEach((ps) => ps.update(dt));
    return Object.values(this.playerStates).every((ps) => ps.allDone());
  }

  attemptEnhance(playerId, forceSuccess) {
    const ps = this.playerStates[playerId];
    if (!ps) return null;
    return ps.attemptEnhance(forceSuccess);
  }

  // 관리자 테스트용 - 특정 플레이어의 모든 항목을 즉시 최대 레벨로
  forceMaxAll(playerId) {
    const ps = this.playerStates[playerId];
    if (!ps) return;
    ps.itemNames.forEach((name) => {
      ps.levels[name] = 10;
      ps.done[name] = true;
    });
  }

  // 최종 레벨 맵을 반환: playerId -> { itemName: level }
  getFinalLevels() {
    const out = {};
    Object.entries(this.playerStates).forEach(([pid, ps]) => {
      out[pid] = { ...ps.levels };
    });
    return out;
  }

  getStateJSON() {
    const players = {};
    Object.entries(this.playerStates).forEach(([pid, ps]) => {
      players[pid] = ps.getStateJSON();
    });
    return { itemNames: this.itemNames, players, tierTable: TIER_TABLE };
  }
}

module.exports = { TIER_TABLE, ITEM_TIME_LIMIT, tierFor, PlayerEnhancement, EnhancementPhase };
