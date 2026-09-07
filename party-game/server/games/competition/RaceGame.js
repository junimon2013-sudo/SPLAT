// server/games/competition/RaceGame.js
// 경주 - 탑모드. 구역(zone)별로 카메라가 나뉘어 있어서, 오른쪽 끝에 닿아야 다음 구역으로 넘어간다.
// 마지막 구역을 넘어가면 결승선이 있는 마무리 구역이 하나 더 나온다.
const { PHYSICS } = require("../../../shared/constants");

const DURATION = 90;
const ZONE_WIDTH = 1400;
const ZONE_HEIGHT = 760;
const NUM_ZONES = 6; // 실제로 뽑히는 구역 수 (마무리 구역 제외)
const TOTAL_ZONE_TEMPLATES = 10; // 준비된 구역 템플릿 풀

function circleRectCollide(cx, cy, cr, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX, dy = cy - closestY;
  return dx * dx + dy * dy < cr * cr;
}
function resolveCircleRect(px, py, pr, rect) {
  const closestX = Math.max(rect.x, Math.min(px, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(py, rect.y + rect.h));
  let dx = px - closestX, dy = py - closestY;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d === 0) return { x: px, y: py - pr };
  const push = pr - d;
  return { x: px + (dx / d) * push, y: py + (dy / d) * push };
}

// 구역 템플릿 10종 - 각각 로컬 좌표(0~ZONE_WIDTH) 기준 지그재그 장애물 벽 패턴
function buildZoneTemplates() {
  const templates = [];
  for (let t = 0; t < TOTAL_ZONE_TEMPLATES; t++) {
    const walls = [];
    const wallCount = 2 + (t % 3);
    for (let i = 0; i < wallCount; i++) {
      const x = 300 + i * (900 / wallCount) + (t * 37) % 80;
      const gapFromTop = (i % 2 === 0) ? (t * 53) % (ZONE_HEIGHT - 260) : 0;
      const h = ZONE_HEIGHT - 240;
      walls.push({ x, y: gapFromTop, w: 40, h });
    }
    templates.push({ walls });
  }
  return templates;
}
const ZONE_TEMPLATES = buildZoneTemplates();

class RaceGame {
  static id = "race";
  static displayName = "경주";
  static description = "구역을 하나씩 넘어가며 결승선까지 먼저 도착하라!";
  static enhancementItems = ["다리"];
  static rankPoints = [4, 2];

  constructor(room, enhanceLevels) {
    this.room = room;
    this.enhanceLevels = enhanceLevels || {};
    this.t = 0;
    this.finished = false;
    this.finishOrder = [];
    this.finishTime = {};
    // 10개 템플릿 중 6개를 무작위 순서로 뽑아 구역 배치를 구성. 마지막에 결승 구역(zone index 6) 추가
    const pool = [...Array(TOTAL_ZONE_TEMPLATES).keys()];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.zoneTemplateIds = pool.slice(0, NUM_ZONES);
    this.totalZones = NUM_ZONES + 1; // 마무리 구역 포함
    this.finishX = this.totalZones * ZONE_WIDTH - ZONE_WIDTH / 2; // 마무리 구역 한가운데가 결승선

    const players = room.getAlivePlayers();
    players.forEach((pl, i) => {
      pl.status = "playing";
      pl.x = 60;
      pl.y = 120 + i * 130;
      pl.gameData.gaveUp = false;
    });
  }

  _getLevel(playerId) {
    const lv = this.enhanceLevels[playerId] && this.enhanceLevels[playerId]["다리"];
    return lv || 0;
  }

  _wallsAt(worldX) {
    // worldX가 속한 구역의 로컬 벽 좌표를 절대좌표로 변환해서 반환 (마무리 구역엔 장애물 없음)
    const zoneIdx = Math.floor(worldX / ZONE_WIDTH);
    if (zoneIdx >= NUM_ZONES) return [];
    const templateId = this.zoneTemplateIds[zoneIdx];
    const template = ZONE_TEMPLATES[templateId];
    const offsetX = zoneIdx * ZONE_WIDTH;
    return template.walls.map((w) => ({ x: w.x + offsetX, y: w.y, w: w.w, h: w.h }));
  }

  // 클라이언트의 "기권" 버튼에서 호출
  giveUp(playerId) {
    const pl = this.room.getAlivePlayers().find((p) => p.id === playerId);
    if (pl) pl.gameData.gaveUp = true;
  }

  update(dt) {
    if (this.finished) return true;
    this.t += dt;
    const allPlayers = this.room.getAlivePlayers();
    const players = allPlayers.filter((p) => !this.finishTime[p.id] && !p.gameData.gaveUp);

    players.forEach((pl) => {
      const legLv = this._getLevel(pl.id);
      const speed = PHYSICS.MOVE_SPEED + legLv * 40;
      let mx = 0, my = 0;
      if (pl.input.up) my -= 1;
      if (pl.input.down) my += 1;
      if (pl.input.left) mx -= 1;
      if (pl.input.right) mx += 1;
      const len = Math.sqrt(mx * mx + my * my) || 1;
      mx /= len; my /= len;
      if (mx !== 0 || my !== 0) pl.facing = { x: mx, y: my };
      pl.x += mx * speed * dt;
      pl.y += my * speed * dt;
      pl.x = Math.max(pl.radius, pl.x);
      pl.y = Math.max(pl.radius, Math.min(ZONE_HEIGHT - pl.radius, pl.y));

      this._wallsAt(pl.x).forEach((w) => {
        if (circleRectCollide(pl.x, pl.y, pl.radius, w)) {
          const r = resolveCircleRect(pl.x, pl.y, pl.radius, w);
          pl.x = r.x; pl.y = r.y;
        }
      });

      if (pl.x >= this.finishX && !this.finishTime[pl.id]) {
        this.finishTime[pl.id] = this.t;
        this.finishOrder.push(pl.id);
        this.room.broadcastEvent("race_finish", { id: pl.id, place: this.finishOrder.length });
      }
    });

    const finishedCount = this.finishOrder.length;
    const remaining = allPlayers.filter((p) => !this.finishTime[p.id] && !p.gameData.gaveUp);
    if (finishedCount >= 2 || remaining.length === 0 || this.t >= DURATION) {
      this.finished = true;
      return true;
    }
    return false;
  }

  getRanking() {
    const players = this.room.getAlivePlayers();
    const finished = [...this.finishOrder];
    const rest = players
      .map((p) => p.id)
      .filter((id) => !this.finishTime[id])
      .sort((a, b) => {
        const pa = players.find((p) => p.id === a);
        const pb = players.find((p) => p.id === b);
        return (pb ? pb.x : 0) - (pa ? pa.x : 0);
      });
    return [...finished, ...rest];
  }

  getScoreAwards() {
    const ranking = this.getRanking();
    const awards = {};
    const pts = RaceGame.rankPoints;
    ranking.forEach((pid, idx) => { awards[pid] = pts[idx] != null ? pts[idx] : 0; });
    return awards;
  }

  getStateJSON() {
    const players = this.room.getAlivePlayers();
    // 각 플레이어의 현재 구역, 그리고 "내 앞/뒤 구역에 있는 다른 플레이어 색" 힌트(핑)
    const zoneOf = (pl) => Math.min(this.totalZones - 1, Math.floor(pl.x / ZONE_WIDTH));
    const playerZones = Object.fromEntries(players.map((p) => [p.id, zoneOf(p)]));
    const playerExtra = Object.fromEntries(
      players.map((p) => {
        const myZone = zoneOf(p);
        const aheadColors = players.filter((o) => o.id !== p.id && zoneOf(o) === myZone + 1).map((o) => o.color);
        const behindColors = players.filter((o) => o.id !== p.id && zoneOf(o) === myZone - 1).map((o) => o.color);
        return [p.id, {
          zone: myZone,
          aheadColors, behindColors,
          finished: this.finishTime[p.id] != null,
          place: this.finishTime[p.id] != null ? this.finishOrder.indexOf(p.id) + 1 : null,
          gaveUp: p.gameData.gaveUp,
        }];
      })
    );
    return {
      gameId: RaceGame.id,
      timeLeft: Math.max(0, Math.ceil(DURATION - this.t)),
      zoneWidth: ZONE_WIDTH,
      zoneHeight: ZONE_HEIGHT,
      totalZones: this.totalZones,
      finishX: this.finishX,
      zoneWalls: this.zoneTemplateIds.map((tid, i) => ({
        zone: i,
        walls: ZONE_TEMPLATES[tid].walls.map((w) => ({ x: w.x + i * ZONE_WIDTH, y: w.y, w: w.w, h: w.h })),
      })),
      playerZones,
      playerExtra,
    };
  }
}

module.exports = RaceGame;
