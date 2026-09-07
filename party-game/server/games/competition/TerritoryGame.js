// server/games/competition/TerritoryGame.js
// 영역싸움 - 탑모드, 2팀전. 영역을 밟으면 그 팀 소유로 토글되고, 소유한 영역 수만큼 팀 점수가 쌓인다.
// 먼저 6000점을 채운 팀이 승리. 칼을 휘둘러 상대를 밀쳐낼 수 있고, 밀려난 사람이 벽에 부딪히면 기절한다.
const { PHYSICS } = require("../../../shared/constants");

const DURATION = 180; // 최대 제한시간(초) - 그 전에 6000점 도달하면 조기 종료
const BOUNDS = { x: 0, y: 0, w: 1500, h: 900 };
const TARGET_SCORE = 6000;
const SCORE_PER_ZONE_PER_SEC = 15; // 영역 하나 소유당 초당 점수
const ATTACK_COOLDOWN = 0.6;
const BASE_REACH = 60; // 칼 기본 사거리
const SWORD_FRICTION = 100; // 넉백 감속(px/s^2) - "마찰력은 100a"
const WALL_MARGIN = 4;

// 8개 영역을 화면에 고르게 배치
const ZONES = [
  { id: "z1", x: 180, y: 180, r: 80 }, { id: "z2", x: 750, y: 130, r: 80 },
  { id: "z3", x: 1320, y: 180, r: 80 }, { id: "z4", x: 180, y: 450, r: 80 },
  { id: "z5", x: 1320, y: 450, r: 80 }, { id: "z6", x: 180, y: 720, r: 80 },
  { id: "z7", x: 750, y: 770, r: 80 }, { id: "z8", x: 1320, y: 720, r: 80 },
];

class TerritoryGame {
  static id = "territory";
  static displayName = "영역싸움";
  static description = "영역을 밟아 우리 팀 것으로 만들고, 칼을 휘둘러 상대를 밀쳐내라! 먼저 6000점을 채운 팀이 승리.";
  static enhancementItems = ["칼"];

  constructor(room, enhanceLevels) {
    this.room = room;
    this.enhanceLevels = enhanceLevels || {};
    this.t = 0;
    this.finished = false;
    this.winningTeam = null;
    this.teamScore = [0, 0];
    this.zoneOwner = {}; // zoneId -> 0|1|null
    const players = room.getAlivePlayers();
    players.forEach((pl, i) => {
      pl.status = "playing";
      pl.gameData.team = i % 2;
      const side = pl.gameData.team === 0 ? 0.25 : 0.75;
      pl.x = BOUNDS.w * side;
      pl.y = 150 + (Math.floor(i / 2)) * 140;
      pl.gameData.attackCooldown = 0;
      pl.gameData.knockX = 0;
      pl.gameData.knockY = 0;
      pl.gameData.stunTimer = 0; // > 0이면 기절
    });
  }

  _getSwordLevel(playerId) {
    const lv = this.enhanceLevels[playerId] && this.enhanceLevels[playerId]["칼"];
    return lv || 0;
  }

  update(dt) {
    if (this.finished) return true;
    this.t += dt;
    const players = this.room.getAlivePlayers();

    players.forEach((pl) => {
      if (pl.gameData.attackCooldown > 0) pl.gameData.attackCooldown -= dt;
      if (pl.gameData.stunTimer > 0) {
        pl.gameData.stunTimer -= dt;
      }
      const swordLv = this._getSwordLevel(pl.id);

      // 넉백 이동 - 마찰(100a)로 선형 감속되며, 벽에 부딪히면 "남은 힘(px/s)"만큼 ms 기절
      const knockSpeed = Math.hypot(pl.gameData.knockX, pl.gameData.knockY);
      if (knockSpeed > 1) {
        const nx = pl.x + pl.gameData.knockX * dt;
        const ny = pl.y + pl.gameData.knockY * dt;
        const hitWallX = nx < BOUNDS.x + pl.radius || nx > BOUNDS.x + BOUNDS.w - pl.radius;
        const hitWallY = ny < BOUNDS.y + pl.radius || ny > BOUNDS.y + BOUNDS.h - pl.radius;
        if (hitWallX || hitWallY) {
          pl.gameData.stunTimer = Math.max(pl.gameData.stunTimer, knockSpeed); // 남은 힘(px/s)을 그대로 ms 기절시간으로
          pl.gameData.knockX = 0; pl.gameData.knockY = 0;
          this.room.broadcastEvent("territory_stun", { id: pl.id, stunMs: knockSpeed });
        } else {
          pl.x = nx; pl.y = ny;
          const decel = SWORD_FRICTION * dt;
          const newSpeed = Math.max(0, knockSpeed - decel);
          pl.gameData.knockX = (pl.gameData.knockX / knockSpeed) * newSpeed;
          pl.gameData.knockY = (pl.gameData.knockY / knockSpeed) * newSpeed;
        }
      } else if (pl.gameData.stunTimer <= 0) {
        // 평소 이동(기절 중이거나 날아가는 중이 아닐 때만)
        let mx = 0, my = 0;
        if (pl.input.up) my -= 1;
        if (pl.input.down) my += 1;
        if (pl.input.left) mx -= 1;
        if (pl.input.right) mx += 1;
        const len = Math.sqrt(mx * mx + my * my) || 1;
        mx /= len; my /= len;
        if (mx !== 0 || my !== 0) pl.facing = { x: mx, y: my };
        pl.x += mx * PHYSICS.MOVE_SPEED * dt;
        pl.y += my * PHYSICS.MOVE_SPEED * dt;
      }
      pl.x = Math.max(BOUNDS.x + pl.radius + WALL_MARGIN, Math.min(BOUNDS.x + BOUNDS.w - pl.radius - WALL_MARGIN, pl.x));
      pl.y = Math.max(BOUNDS.y + pl.radius + WALL_MARGIN, Math.min(BOUNDS.y + BOUNDS.h - pl.radius - WALL_MARGIN, pl.y));

      // 공격(칼 휘두르기) - 기절 중이거나 날아가는 중엔 공격 불가
      if (pl.actionPressed() && pl.gameData.attackCooldown <= 0 && pl.gameData.stunTimer <= 0 && knockSpeed <= 1) {
        pl.gameData.attackCooldown = ATTACK_COOLDOWN;
        const reach = BASE_REACH * (1 + swordLv * 0.5);
        const force = Math.max(200, swordLv * 200);
        this.room.broadcastEvent("territory_attack", { by: pl.id, x: pl.x, y: pl.y, facing: pl.facing, reach });
        players.forEach((other) => {
          if (other.id === pl.id || other.gameData.team === pl.gameData.team) return;
          const dx = other.x - pl.x, dy = other.y - pl.y;
          const dist = Math.hypot(dx, dy);
          if (dist > reach + other.radius) return;
          const fx = pl.facing.x, fy = pl.facing.y;
          const forward = dx * fx + dy * fy;
          if (forward < 0) return; // 바라보는 방향 반대쪽은 안 맞음
          const kdx = dist > 0.01 ? dx / dist : fx;
          const kdy = dist > 0.01 ? dy / dist : fy;
          other.gameData.knockX = kdx * force;
          other.gameData.knockY = kdy * force;
          this.room.broadcastEvent("territory_hit", { by: pl.id, target: other.id });
        });
      }
    });

    // 영역 판정 - 밟으면 그 팀 소유로 토글, 소유한 영역 수만큼 팀 점수 누적
    ZONES.forEach((zone) => {
      const steppers = players.filter((pl) => Math.hypot(pl.x - zone.x, pl.y - zone.y) < zone.r);
      if (steppers.length > 0) {
        const teams = new Set(steppers.map((p) => p.gameData.team));
        if (teams.size === 1) {
          const team = steppers[0].gameData.team;
          if (this.zoneOwner[zone.id] !== team) {
            this.zoneOwner[zone.id] = team;
            this.room.broadcastEvent("territory_capture", { zoneId: zone.id, team });
          }
        }
      }
    });
    ZONES.forEach((zone) => {
      const owner = this.zoneOwner[zone.id];
      if (owner != null) this.teamScore[owner] += SCORE_PER_ZONE_PER_SEC * dt;
    });

    players.forEach((pl) => pl.commitInputFrame());

    if (this.teamScore[0] >= TARGET_SCORE || this.teamScore[1] >= TARGET_SCORE || this.t >= DURATION) {
      this.finished = true;
      this.winningTeam = this.teamScore[0] >= this.teamScore[1] ? 0 : 1;
      return true;
    }
    return false;
  }

  getRanking() {
    const players = this.room.getAlivePlayers();
    return [...players.filter((p) => p.gameData.team === this.winningTeam), ...players.filter((p) => p.gameData.team !== this.winningTeam)].map((p) => p.id);
  }

  // 이긴 팀 전원 +2점씩, 진 팀은 0점
  getScoreAwards() {
    const awards = {};
    this.room.getAlivePlayers().forEach((p) => {
      awards[p.id] = p.gameData.team === this.winningTeam ? 2 : 0;
    });
    return awards;
  }

  getStateJSON() {
    return {
      gameId: TerritoryGame.id,
      timeLeft: Math.max(0, Math.ceil(DURATION - this.t)),
      bounds: BOUNDS,
      targetScore: TARGET_SCORE,
      teamScore: this.teamScore,
      zones: ZONES.map((z) => ({ ...z, ownerTeam: this.zoneOwner[z.id] != null ? this.zoneOwner[z.id] : null })),
      playerExtra: Object.fromEntries(
        this.room.getAlivePlayers().map((p) => [p.id, {
          team: p.gameData.team,
          stunned: p.gameData.stunTimer > 0,
        }])
      ),
    };
  }
}

module.exports = TerritoryGame;
