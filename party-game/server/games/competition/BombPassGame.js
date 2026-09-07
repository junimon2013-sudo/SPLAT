// server/games/competition/BombPassGame.js
// 폭탄 넘기기 - 탑모드, 대쉬 있음. 폭탄 소유자는 평소 1.5배 빠르지만,
// 방금 폭탄을 받은 직후 2초간은 "얼음" 상태(속도 1/5, 전달·대쉬 불가)가 된다. 1분 후 폭탄을 든 사람이 페널티.
const { dist, freeMove } = require("./utils");

const BOUNDS = { x: 60, y: 60, w: 1300, h: 700 };
const DURATION = 60; // 게임시간 1분
const PASS_COOLDOWN = 0.3;
const FREEZE_DURATION = 2; // 폭탄을 받은 직후 얼음 상태 지속시간
const FREEZE_SPEED_MULT = 1 / 5;
const HOLDER_SPEED_MULT = 1.5;
const DASH_SPEED_MULT = 2.4;
const DASH_DURATION = 0.18;
const DASH_COOLDOWN = 0.8;

class BombPassGame {
  static id = "bomb_pass";
  static displayName = "폭탄 넘기기";
  static description = "대쉬로 빠르게 다가가 폭탄을 넘겨라! 1분 뒤 폭탄을 들고 있으면 페널티.";
  static enhancementItems = []; // 강화 없음

  constructor(room) {
    this.room = room;
    this.t = 0;
    this.finished = false;
    this.passCooldown = 0;
    const players = room.getAlivePlayers();
    players.forEach((pl, i) => {
      pl.status = "playing";
      pl.x = BOUNDS.x + 100 + (i % 2) * 400;
      pl.y = BOUNDS.y + 100 + Math.floor(i / 2) * 300;
      pl.gameData.dashTimer = 0;
      pl.gameData.dashCooldown = 0;
    });
    // 룰렛으로 당첨자(첫 폭탄 소유자) 결정
    const winnerIdx = Math.floor(Math.random() * players.length);
    this.holderId = players[winnerIdx] ? players[winnerIdx].id : null;
    this.freezeTimer = 0; // > 0이면 지금 폭탄 소유자가 "얼음" 상태(방금 받음)
    this.room.broadcastEvent("bomb_roulette", { winnerId: this.holderId });
  }

  update(dt) {
    if (this.finished) return true;
    this.t += dt;
    if (this.passCooldown > 0) this.passCooldown -= dt;
    if (this.freezeTimer > 0) this.freezeTimer -= dt;
    const players = this.room.getAlivePlayers();

    players.forEach((pl) => {
      if (pl.gameData.dashCooldown > 0) pl.gameData.dashCooldown -= dt;
      if (pl.gameData.dashTimer > 0) pl.gameData.dashTimer -= dt;
      const isHolder = pl.id === this.holderId;
      const isFrozen = isHolder && this.freezeTimer > 0;
      // 얼음 상태가 아닐 때만 대쉬 가능
      if (!isFrozen && pl.dashPressed() && pl.gameData.dashCooldown <= 0 && pl.gameData.dashTimer <= 0) {
        pl.gameData.dashTimer = DASH_DURATION;
        pl.gameData.dashCooldown = DASH_COOLDOWN;
      }
      let speedMult = 1;
      if (isFrozen) speedMult = FREEZE_SPEED_MULT;
      else if (isHolder) speedMult = HOLDER_SPEED_MULT;
      if (pl.gameData.dashTimer > 0 && !isFrozen) speedMult *= DASH_SPEED_MULT;
      freeMove(pl, dt, BOUNDS, 220 * speedMult);
    });

    // 폭탄 전달 판정 - 얼음 상태(방금 받은 직후)에는 전달 불가
    if (this.passCooldown <= 0 && this.holderId && this.freezeTimer <= 0) {
      const holder = players.find((p) => p.id === this.holderId);
      if (holder) {
        for (const pl of players) {
          if (pl.id === holder.id) continue;
          if (dist(pl, holder) < pl.radius + holder.radius) {
            this.holderId = pl.id;
            this.passCooldown = PASS_COOLDOWN;
            this.freezeTimer = FREEZE_DURATION;
            this.room.broadcastEvent("bomb_assigned", { id: pl.id });
            break;
          }
        }
      }
    }

    if (this.t >= DURATION) {
      this.finished = true;
      this.room.broadcastEvent("bomb_explode", { id: this.holderId });
      return true;
    }
    return false;
  }

  // 순위: 폭탄을 안 든 사람들이 공동 상위, 폭탄을 든 사람이 꼴찌
  getRanking() {
    const players = this.room.getAlivePlayers().map((p) => p.id);
    const others = players.filter((id) => id !== this.holderId);
    return this.holderId ? [...others, this.holderId] : others;
  }

  // 폭탄을 들고 게임이 끝난 사람만 -2점, 나머지는 0점
  getScoreAwards() {
    const awards = {};
    this.room.getAlivePlayers().forEach((p) => {
      awards[p.id] = p.id === this.holderId ? -2 : 0;
    });
    return awards;
  }

  getStateJSON() {
    return {
      gameId: BombPassGame.id,
      timeLeft: Math.max(0, Math.ceil(DURATION - this.t)),
      holderId: this.holderId,
      frozen: this.freezeTimer > 0,
      bounds: BOUNDS,
      prompt: "대쉬로 다가가서 폭탄을 넘겨라!",
      playerExtra: Object.fromEntries(
        this.room.getAlivePlayers().map((p) => [p.id, {
          bomb: p.id === this.holderId,
          frozen: p.id === this.holderId && this.freezeTimer > 0,
        }])
      ),
    };
  }
}

module.exports = BombPassGame;
