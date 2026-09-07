// server/games/competition/TailTagGame.js
// 꼬리잡기(뺏기) - 탑모드, 대쉬 있음. 모든 플레이어가 자기 뒤에 깃발을 달고 다니고,
// 다른 플레이어가 그 깃발에 닿아 스페이스바를 누르면 빼앗는다.
const { PHYSICS } = require("../../../shared/constants");

const DURATION = 60;
const BOUNDS = { x: 60, y: 60, w: 1300, h: 700 };
const FLAG_DIST_MULT = 4; // 깃발까지 거리 = 반지름 * 4 (플레이어 지름의 2배)
const STEAL_RADIUS = 26; // 깃발에 닿았다고 판정하는 반경
const RESPAWN_TIME = 10; // 뺏기면 이 시간(초) 후 새 깃발을 달고 부활
const FACING_GRACE_MS = 150; // 방향을 바꿔도 이 시간(ms) 동안은 이전 위치에도 깃발 판정이 남는다
const STEAL_COOLDOWN = 0.4; // 같은 깃발을 연속으로 뺏는 것 방지
const DASH_SPEED_MULT = 2.6;
const DASH_DURATION = 0.18;
const DASH_COOLDOWN = 0.9;

class TailTagGame {
  static id = "tail_tag";
  static displayName = "꼬리잡기";
  static description = "다른 플레이어 뒤의 깃발에 닿아 스페이스로 빼앗아라! 점수가 가장 높은 사람이 승리.";
  static enhancementItems = []; // 강화 없음
  static rankPoints = [3, 2, 1];

  constructor(room) {
    this.room = room;
    this.t = 0;
    this.finished = false;
    const players = room.getAlivePlayers();
    players.forEach((pl, i) => {
      pl.status = "playing";
      pl.x = BOUNDS.x + 100 + (i % 3) * 350;
      pl.y = BOUNDS.y + 100 + Math.floor(i / 3) * 300;
      pl.facing = pl.facing || { x: 0, y: 1 };
      pl.gameData.flagValue = 1; // 이 깃발을 뺏으면 얻는 점수
      pl.gameData.hasFlag = true;
      pl.gameData.respawnTimer = 0;
      pl.gameData.score = 0; // 누적 총점(승패 결정용)
      pl.gameData.prevFacing = { ...pl.facing };
      pl.gameData.facingChangedAt = -1; // 마지막으로 방향이 바뀐 시각(this.t 기준)
      pl.gameData.stealCooldown = 0;
      pl.gameData.stealPromptFrom = null; // 지금 이 플레이어가 훔칠 수 있는 대상의 id (본인에게만 보여줄 정보)
      pl.gameData.dashTimer = 0;
      pl.gameData.dashCooldown = 0;
    });
  }

  _flagPos(pl, facing) {
    const d = pl.radius * FLAG_DIST_MULT;
    return { x: pl.x - facing.x * d, y: pl.y - facing.y * d };
  }

  update(dt) {
    if (this.finished) return true;
    this.t += dt;
    const players = this.room.getAlivePlayers();

    players.forEach((pl) => {
      if (!pl.gameData.hasFlag) {
        pl.gameData.respawnTimer -= dt;
        if (pl.gameData.respawnTimer <= 0) {
          pl.gameData.hasFlag = true;
          pl.gameData.flagValue = 1;
          this.room.broadcastEvent("tailtag_respawn", { id: pl.id });
        }
      }
      if (pl.gameData.stealCooldown > 0) pl.gameData.stealCooldown -= dt;
      if (pl.gameData.dashCooldown > 0) pl.gameData.dashCooldown -= dt;
      if (pl.gameData.dashTimer > 0) pl.gameData.dashTimer -= dt;

      // 대시(Shift)
      if (pl.dashPressed() && pl.gameData.dashCooldown <= 0 && pl.gameData.dashTimer <= 0) {
        pl.gameData.dashTimer = DASH_DURATION;
        pl.gameData.dashCooldown = DASH_COOLDOWN;
      }

      // 속도 페널티: 자기 깃발 가치(flagValue)가 높을수록(=많이 뺏을수록) 5%씩 느려진다
      const speedPenalty = Math.max(0.2, 1 - (pl.gameData.flagValue - 1) * 0.05);
      let speedMult = speedPenalty;
      if (pl.gameData.dashTimer > 0) speedMult *= DASH_SPEED_MULT;

      const prevFacing = { ...pl.facing };
      let mx = 0, my = 0;
      if (pl.input.up) my -= 1;
      if (pl.input.down) my += 1;
      if (pl.input.left) mx -= 1;
      if (pl.input.right) mx += 1;
      const len = Math.sqrt(mx * mx + my * my) || 1;
      mx /= len; my /= len;
      if (mx !== 0 || my !== 0) pl.facing = { x: mx, y: my };
      // 방향이 바뀌면, 바뀌기 직전 방향을 잠깐(150ms) 잔상으로 남겨서 그 자리에서도 깃발 상호작용이 가능하게 한다
      if (pl.facing.x !== prevFacing.x || pl.facing.y !== prevFacing.y) {
        pl.gameData.prevFacing = prevFacing;
        pl.gameData.facingChangedAt = this.t;
      }
      pl.x += mx * PHYSICS.MOVE_SPEED * speedMult * dt;
      pl.y += my * PHYSICS.MOVE_SPEED * speedMult * dt;
      pl.x = Math.max(BOUNDS.x + pl.radius, Math.min(BOUNDS.x + BOUNDS.w - pl.radius, pl.x));
      pl.y = Math.max(BOUNDS.y + pl.radius, Math.min(BOUNDS.y + BOUNDS.h - pl.radius, pl.y));
    });

    // 깃발 상호작용 판정 - 누가 누구의 깃발(현재 위치 또는 150ms 이내의 잔상 위치)에 닿아있는지 매 프레임 갱신
    players.forEach((pl) => (pl.gameData.stealPromptFrom = null));
    players.forEach((holder) => {
      if (!holder.gameData.hasFlag) return;
      const positions = [this._flagPos(holder, holder.facing)];
      if (this.t - holder.gameData.facingChangedAt < FACING_GRACE_MS / 1000) {
        positions.push(this._flagPos(holder, holder.gameData.prevFacing));
      }
      players.forEach((other) => {
        if (other.id === holder.id) return;
        const near = positions.some((p) => Math.hypot(other.x - p.x, other.y - p.y) < STEAL_RADIUS + other.radius);
        if (near) other.gameData.stealPromptFrom = holder.id;
      });
    });

    // 뺏기 실행 (스페이스바)
    players.forEach((pl) => {
      if (pl.actionPressed() && pl.gameData.stealPromptFrom && pl.gameData.stealCooldown <= 0) {
        const holder = players.find((p) => p.id === pl.gameData.stealPromptFrom);
        if (holder && holder.gameData.hasFlag) {
          const gained = holder.gameData.flagValue;
          pl.gameData.score += gained;
          pl.gameData.flagValue += 1; // 훔칠 때마다 내 깃발 가치가 1씩 오른다
          pl.gameData.stealCooldown = STEAL_COOLDOWN;
          holder.gameData.hasFlag = false;
          holder.gameData.respawnTimer = RESPAWN_TIME;
          this.room.broadcastEvent("tailtag_steal", { by: pl.id, from: holder.id, gained });
        }
      }
    });

    players.forEach((pl) => pl.commitInputFrame());

    if (this.t >= DURATION) {
      this.finished = true;
      return true;
    }
    return false;
  }

  getRanking() {
    const players = this.room.getAlivePlayers();
    return players.map((pl) => pl.id).sort((a, b) => {
      const sa = players.find((p) => p.id === a).gameData.score;
      const sb = players.find((p) => p.id === b).gameData.score;
      return sb - sa;
    });
  }

  getScoreAwards() {
    const ranking = this.getRanking();
    const awards = {};
    const pts = TailTagGame.rankPoints;
    ranking.forEach((pid, idx) => { awards[pid] = pts[idx] != null ? pts[idx] : 0; });
    return awards;
  }

  getStateJSON() {
    const players = this.room.getAlivePlayers();
    return {
      gameId: TailTagGame.id,
      timeLeft: Math.max(0, Math.ceil(DURATION - this.t)),
      bounds: BOUNDS,
      flags: Object.fromEntries(
        players.filter((p) => p.gameData.hasFlag).map((p) => [p.id, {
          pos: this._flagPos(p, p.facing),
          value: p.gameData.flagValue,
        }])
      ),
      playerExtra: Object.fromEntries(
        players.map((p) => [p.id, {
          score: p.gameData.score,
          hasFlag: p.gameData.hasFlag,
          respawnIn: p.gameData.hasFlag ? 0 : Math.max(0, Math.ceil(p.gameData.respawnTimer)),
          stealPromptFrom: p.gameData.stealPromptFrom, // 이 사람 화면에서만 "스페이스로 뺏기" 표시
        }])
      ),
    };
  }
}

module.exports = TailTagGame;
