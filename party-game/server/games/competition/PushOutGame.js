// server/games/competition/PushOutGame.js
// 밀어내기 - 탑모드. 마찰 없는 얼음판 위에서 서로 밀어내 마지막까지 살아남는 게임.
const { PHYSICS } = require("../../../shared/constants");

const ARENA = { x: 700, y: 420, radius: 300 };
const MIN_ARENA_RADIUS = 90; // 얼음이 이 이하로는 줄어들지 않음
const SHRINK_RATE = 3.2; // 가장자리부터 초당 줄어드는 반지름(px/s)
const ATTACK_COOLDOWN = 0.55;
const JUMP_DURATION = 0.4; // 점프(회피) 지속시간
const JUMP_COOLDOWN = 1.0;
const ROUND_TIME_LIMIT = 60;
const BASE_FRICTION = 0; // 얼음판 기본 마찰력 - 없음(신발 강화로만 생김)
const KNOCK_DECAY_NO_FRICTION = 0.995; // 마찰 없을 때 감쇠(거의 안 줄어듦, 얼음판이라 미끄러짐)
const PLAYER_BOUNCE = 0.6; // 플레이어끼리 부딪혔을 때 서로 밀어내는 정도

class PushOutGame {
  static id = "push_out";
  static displayName = "밀어내기";
  static description = "스페이스로 밀어서 상대를 얼음판 밖으로 떨어뜨려라! 마지막까지 살아남으면 승리.";
  static enhancementItems = ["신발", "손"];
  static rankPoints = [3, 2, 1];

  constructor(room, enhanceLevels) {
    this.room = room;
    this.enhanceLevels = enhanceLevels || {}; // playerId -> {신발: lv, 손: lv}
    this.timeLeft = ROUND_TIME_LIMIT;
    this.arenaRadius = ARENA.radius;
    this.eliminationOrder = []; // 탈락한 순서대로 push (마지막 탈락자가 더 순위 높음)
    this.finished = false;
    const players = room.getAlivePlayers();
    const n = players.length;
    this._initialPlayerCount = n; // 관리자가 1명으로 테스트 시작해도 즉시 끝나지 않게 하기 위한 기록
    players.forEach((pl, i) => {
      const angle = (i / n) * Math.PI * 2;
      pl.x = ARENA.x + Math.cos(angle) * (ARENA.radius * 0.55);
      pl.y = ARENA.y + Math.sin(angle) * (ARENA.radius * 0.55);
      pl.facing = { x: -Math.cos(angle), y: -Math.sin(angle) };
      pl.gameData.eliminated = false;
      pl.gameData.attackCooldown = 0;
      pl.gameData.jumpCooldown = 0;
      pl.gameData.jumpTimer = 0; // > 0이면 지금 점프(회피) 중
      pl.gameData.vx = 0; // 얼음판 위 관성 속도(가속도 개념 - 마찰 없으면 계속 미끄러짐)
      pl.gameData.vy = 0;
      pl.status = "playing";
    });
  }

  _getLevel(playerId, itemName) {
    const lv = this.enhanceLevels[playerId] && this.enhanceLevels[playerId][itemName];
    return lv || 0;
  }

  update(dt) {
    if (this.finished) return true;
    this.timeLeft -= dt;
    // 얼음판이 가장자리부터 서서히 줄어든다
    this.arenaRadius = Math.max(MIN_ARENA_RADIUS, this.arenaRadius - SHRINK_RATE * dt);

    const players = this.room.getAlivePlayers().filter((p) => !p.gameData.eliminated);

    players.forEach((pl) => {
      const shoeLv = this._getLevel(pl.id, "신발");
      const handLv = this._getLevel(pl.id, "손");
      const friction = BASE_FRICTION + Math.max(0, (shoeLv - 1) * 10); // -((lv-1)*10)a 만큼의 "제동력"(감속)

      if (pl.gameData.jumpCooldown > 0) pl.gameData.jumpCooldown -= dt;
      if (pl.gameData.jumpTimer > 0) pl.gameData.jumpTimer -= dt;

      let mx = 0, my = 0;
      if (pl.input.up) my -= 1;
      if (pl.input.down) my += 1;
      if (pl.input.left) mx -= 1;
      if (pl.input.right) mx += 1;
      const len = Math.sqrt(mx * mx + my * my) || 1;
      mx /= len; my /= len;
      if (mx !== 0 || my !== 0) pl.facing = { x: mx, y: my };

      // 점프(Q) - 회피 + 가속도(관성 속도) 초기화
      if (pl.jumpPressed() && pl.gameData.jumpCooldown <= 0) {
        pl.gameData.jumpCooldown = JUMP_COOLDOWN;
        pl.gameData.jumpTimer = JUMP_DURATION;
        pl.gameData.vx = 0;
        pl.gameData.vy = 0;
        this.room.broadcastEvent("push_jump", { by: pl.id });
      }

      if (pl.gameData.attackCooldown > 0) pl.gameData.attackCooldown -= dt;

      // 넉백(맞아서 밀려나는 관성 속도) 감쇠 적용 이동 - 마찰(신발 강화)이 없으면 얼음판이라 거의 안 줄어들고 계속 미끄러진다
      const knock = Math.hypot(pl.gameData.vx, pl.gameData.vy);
      if (knock > 5) {
        pl.x += pl.gameData.vx * dt;
        pl.y += pl.gameData.vy * dt;
        if (friction > 0) {
          const decel = friction * dt;
          const newSpeed = Math.max(0, knock - decel);
          pl.gameData.vx = (pl.gameData.vx / knock) * newSpeed;
          pl.gameData.vy = (pl.gameData.vy / knock) * newSpeed;
        } else {
          pl.gameData.vx *= KNOCK_DECAY_NO_FRICTION;
          pl.gameData.vy *= KNOCK_DECAY_NO_FRICTION;
        }
      } else {
        // 넉백이 거의 없으면 평소처럼 즉시반응 고정 속도로 이동
        pl.gameData.vx = 0; pl.gameData.vy = 0;
        pl.x += mx * PHYSICS.MOVE_SPEED * dt;
        pl.y += my * PHYSICS.MOVE_SPEED * dt;
      }

      // 공격 판정 - 손 강화 레벨에 따른 범위[d,h]와 힘
      if (pl.actionPressed() && pl.gameData.attackCooldown <= 0) {
        pl.gameData.attackCooldown = ATTACK_COOLDOWN;
        const rangeD = Math.max(15, handLv * 15);
        const rangeH = Math.max(10, handLv * 10);
        const pushForce = Math.max(200, handLv * 200);
        this.room.broadcastEvent("push_attack", { by: pl.id, x: pl.x, y: pl.y, facing: pl.facing, rangeD, rangeH });
        players.forEach((other) => {
          if (other.id === pl.id) return;
          if (other.gameData.jumpTimer > 0) return; // 점프(회피) 중이면 안 맞음
          const dx = other.x - pl.x, dy = other.y - pl.y;
          // 공격자가 바라보는 방향을 앞(+x)으로 하는 로컬 좌표계로 변환해서 사각형 판정
          const fx = pl.facing.x, fy = pl.facing.y;
          const forward = dx * fx + dy * fy; // 전방 성분
          const side = dx * -fy + dy * fx; // 측면 성분
          if (forward < -other.radius || forward > rangeD + other.radius) return;
          if (Math.abs(side) > rangeH + other.radius) return;
          const dist = Math.hypot(dx, dy) || 1;
          const kdx = dist > 0.01 ? dx / dist : fx || 1;
          const kdy = dist > 0.01 ? dy / dist : fy || 0;
          other.gameData.vx = kdx * pushForce;
          other.gameData.vy = kdy * pushForce;
          this.room.broadcastEvent("push_hit", { by: pl.id, target: other.id });
        });
      }
    });

    // 플레이어끼리 부딪히면 서로 밀어낸다(당구공처럼) - "플레이어 사이에 물리가 작용함"
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i], b = players[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const minDist = a.radius + b.radius;
        if (dist < minDist) {
          const overlap = minDist - dist;
          const nx = dx / dist, ny = dy / dist;
          a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
          // 서로의 속도 일부를 교환해서 부딪힌 느낌을 준다
          const relVx = b.gameData.vx - a.gameData.vx, relVy = b.gameData.vy - a.gameData.vy;
          const relSpeed = relVx * nx + relVy * ny;
          if (relSpeed < 0) {
            a.gameData.vx += nx * relSpeed * PLAYER_BOUNCE;
            a.gameData.vy += ny * relSpeed * PLAYER_BOUNCE;
            b.gameData.vx -= nx * relSpeed * PLAYER_BOUNCE;
            b.gameData.vy -= ny * relSpeed * PLAYER_BOUNCE;
          }
        }
      }
    }

    // 탈락 판정 (얼음판 밖 = 물에 빠짐)
    players.forEach((pl) => {
      const dx = pl.x - ARENA.x, dy = pl.y - ARENA.y;
      if (Math.sqrt(dx * dx + dy * dy) > this.arenaRadius + pl.radius * 0.3) {
        pl.gameData.eliminated = true;
        pl.status = "eliminated";
        this.eliminationOrder.push(pl.id);
        this.room.broadcastEvent("eliminated", { id: pl.id });
      }
    });

    players.forEach((pl) => pl.commitInputFrame());

    const remaining = this.room.getAlivePlayers().filter((p) => !p.gameData.eliminated);
    // 처음부터 인원이 1명뿐이면(관리자 테스트 등) 시작하자마자 끝나버리면 안 되니, 2명 이상으로 시작했을 때만 "1명 남으면 종료" 규칙을 적용한다
    const shouldEndBySurvivors = this._initialPlayerCount > 1 && remaining.length <= 1;
    if (shouldEndBySurvivors || this.timeLeft <= 0) {
      this.finished = true;
      remaining.forEach((pl) => {
        if (!this.eliminationOrder.includes(pl.id)) this.eliminationOrder.push(pl.id);
      });
      return true;
    }
    return false;
  }

  // 순위 계산: 마지막까지 남은 사람이 1등. eliminationOrder는 "탈락한 순"이므로 뒤집으면 순위.
  getRanking() {
    const order = [...this.eliminationOrder].reverse();
    return order; // [1등 playerId, 2등, ...]
  }

  // 1,2,3등만 3,2,1점 (그 밖은 0점)
  getScoreAwards() {
    const ranking = this.getRanking();
    const awards = {};
    const pts = PushOutGame.rankPoints;
    ranking.forEach((pid, idx) => {
      awards[pid] = pts[idx] != null ? pts[idx] : 0;
    });
    return awards;
  }

  getStateJSON() {
    return {
      gameId: PushOutGame.id,
      arena: { x: ARENA.x, y: ARENA.y, radius: this.arenaRadius },
      timeLeft: Math.max(0, Math.ceil(this.timeLeft)),
    };
  }
}

module.exports = PushOutGame;
