// server/games/competition/TreasureHuntGame.js
// 보물찾기 - 사이드모드, 개인 카메라. 마우스(곡괭이)로 클릭해서 아래로 파고 내려가며 광물을 캔다.
// 각 플레이어는 독립된 광산을 가진다(개인 인스턴스 던전).
const PLAYER_RADIUS = 22;
const BLOCK_SIZE = Math.round(PLAYER_RADIUS * 2 * 1.5); // 블록 = 플레이어 크기의 1.5배
const DURATION = 120;
const MINE_RANGE = 2; // 자기 위치 기준 상하좌우 2칸까지만 채굴 가능
const ROWS_PER_TIER = 100; // 100행마다 지반이 바뀜(흙->돌->검은돌, 검은돌부터는 무한 반복)

// 9단계 광물: 흙,돌,구리,철,플래티넘,티타늄,에메랄드,사파이어,다이아
const MINERALS = ["흙", "돌", "구리", "철", "플래티넘", "티타늄", "에메랄드", "사파이어", "다이아"];
const MINERAL_POINTS = [1, 2, 3, 4, 5, 7, 10, 15, 30];
// 지반별 광물 드랍률(%) - 순서는 MINERALS와 동일
const GROUND_DROP_RATES = {
  dirt: [30, 20, 5, 2, 1, 0.1, 0.01, 0, 0],
  stone: [10, 15, 20, 10, 5, 1, 0.1, 0.01, 0],
  blackstone: [0, 10, 15, 14, 12, 5, 3, 2, 1],
};
// 곡괭이 레벨별 채굴 시간(초) - [지반타입][레벨] -> 초
const MINE_TIME_TABLE = {
  dirt: (lv) => (lv <= 5 ? 0.3 : 0),
  stone: (lv) => (lv <= 5 ? 0.7 : lv <= 8 ? 0.3 : 0),
  blackstone: (lv) => (lv <= 2 ? Infinity : lv <= 4 ? 0.7 : lv <= 7 ? 0.3 : lv === 8 ? 0.1 : 0),
};
// 6강 이상 곡괭이의 "덤 보상" 확률 - 광물이 아닌 블록을 캘 때마다 발동
function bonusChance(lv) {
  if (lv >= 10) return { chance: 0.67, pool: "blackstone" };
  if (lv >= 8) return { chance: 0.5, pool: "stone" };
  if (lv >= 6) return { chance: 0.5, pool: "dirt" };
  return null;
}

function groundTypeForRow(row) {
  const tierIdx = Math.floor(row / ROWS_PER_TIER);
  if (tierIdx <= 0) return "dirt";
  if (tierIdx === 1) return "stone";
  return "blackstone"; // 200행부터는 검은돌이 무한히 반복
}

function rollMineral(groundType) {
  const rates = GROUND_DROP_RATES[groundType];
  const roll = Math.random() * 100;
  let acc = 0;
  for (let i = 0; i < rates.length; i++) {
    acc += rates[i];
    if (roll < acc) return i; // MINERALS 인덱스
  }
  return null; // 그냥 지반 블록(광물 없음)
}

class TreasureHuntGame {
  static id = "treasure_hunt";
  static displayName = "보물찾기";
  static description = "곡괭이로 아래를 파고 내려가며 광물을 캐라! 깊이 내려갈수록 더 좋은 광물이 나온다.";
  static enhancementItems = ["시야", "곡괭이"];
  static rankPoints = [3, 2, 1];

  constructor(room, enhanceLevels) {
    this.room = room;
    this.enhanceLevels = enhanceLevels || {};
    this.t = 0;
    this.finished = false;
    const players = room.getAlivePlayers();
    players.forEach((pl) => {
      pl.status = "playing";
      pl.gameData.score = 0;
      pl.gameData.col = 0;
      pl.gameData.row = 0; // 지표면부터 시작
      pl.gameData.mine = {}; // "col,row" -> null(빈 공간) | { groundType, mineralIdx|null }
      pl.gameData.miningKey = null; // 지금 채굴 중인 블록 좌표
      pl.gameData.miningProgress = 0;
      pl.gameData.onGround = true;
      pl.gameData.vy = 0;
    });
  }

  _getLevel(playerId, itemName) {
    const lv = this.enhanceLevels[playerId] && this.enhanceLevels[playerId][itemName];
    return lv || 0;
  }

  // 아직 생성 안 된 블록이면 그 자리에서 확정적으로 하나 생성해서 캐시에 저장(지연 생성)
  _blockAt(pl, col, row) {
    const key = `${col},${row}`;
    if (!(key in pl.gameData.mine)) {
      if (row < 0) {
        pl.gameData.mine[key] = "air"; // 지표면 위는 빈 공간
      } else {
        const groundType = groundTypeForRow(row);
        const mineralIdx = rollMineral(groundType);
        pl.gameData.mine[key] = { groundType, mineralIdx };
      }
    }
    return pl.gameData.mine[key];
  }

  // 클라이언트가 마우스로 특정 칸을 클릭했을 때 호출 (곡괭이질 시작/유지)
  mineClick(playerId, col, row) {
    const pl = this.room.getAlivePlayers().find((p) => p.id === playerId);
    if (!pl) return;
    const dc = Math.abs(col - pl.gameData.col), dr = Math.abs(row - pl.gameData.row);
    if (dc > MINE_RANGE || dr > MINE_RANGE) return; // 채굴 가능 범위 밖
    const key = `${col},${row}`;
    const block = this._blockAt(pl, col, row);
    if (block === "air" || block === null) return;
    if (pl.gameData.miningKey !== key) {
      pl.gameData.miningKey = key;
      pl.gameData.miningProgress = 0;
    }
  }
  mineRelease(playerId) {
    const pl = this.room.getAlivePlayers().find((p) => p.id === playerId);
    if (pl) { pl.gameData.miningKey = null; pl.gameData.miningProgress = 0; }
  }

  // 관리자 패널 - 바로 앞(캐낼 수 있는 범위 안)에 원하는 광물을 강제로 심는다
  adminSpawnTreasure(playerId, mineralIdx) {
    const pl = this.room.getAlivePlayers().find((p) => p.id === playerId);
    if (!pl || mineralIdx == null) return;
    const c = pl.gameData.col + 1, r = pl.gameData.row;
    const groundType = groundTypeForRow(r);
    pl.gameData.mine[`${c},${r}`] = { groundType, mineralIdx: Number(mineralIdx) };
  }

  update(dt) {
    if (this.finished) return true;
    this.t += dt;
    const players = this.room.getAlivePlayers();

    players.forEach((pl) => {
      const pickLv = this._getLevel(pl.id, "곡괭이");

      // 이동(좌우 - 칸 단위가 아니라 자유 이동, col/row는 근사 변환) + 점프(1칸 높이 정도)
      let mx = 0;
      if (pl.input.left) mx -= 1;
      if (pl.input.right) mx += 1;
      pl.x = (pl.x || 0) + mx * 220 * dt;
      pl.gameData.col = Math.round(pl.x / BLOCK_SIZE);
      if (pl.jumpPressed() && pl.gameData.onGround) {
        pl.gameData.vy = -Math.sqrt(2 * 1400 * BLOCK_SIZE * 1.05); // 대략 1칸 높이만큼 점프
        pl.gameData.onGround = false;
      }
      pl.gameData.vy += 2200 * dt;
      const nextY = (pl.y || 0) + pl.gameData.vy * dt;
      const nextRow = Math.floor(nextY / BLOCK_SIZE);
      const belowBlock = this._blockAt(pl, pl.gameData.col, nextRow);
      if (pl.gameData.vy >= 0 && belowBlock && belowBlock !== "air") {
        // 낙하 중 아래가 채워진 블록(캐낸 곳이 아님)이면 그 위에서 멈춘다
        pl.y = nextRow * BLOCK_SIZE;
        pl.gameData.vy = 0;
        pl.gameData.onGround = true;
      } else {
        pl.y = nextY;
        pl.gameData.onGround = false;
      }
      pl.gameData.row = Math.floor(pl.y / BLOCK_SIZE);

      // 채굴 진행
      if (pl.gameData.miningKey) {
        const block = pl.gameData.mine[pl.gameData.miningKey];
        if (block && block !== "air") {
          const timeNeeded = MINE_TIME_TABLE[block.groundType](pickLv);
          if (timeNeeded === Infinity) {
            // 캘 수 없는 지반(예: 검은돌 1~2강) - 진행 안 됨
          } else if (block.mineralIdx === 8 && pickLv < 7) {
            // 다이아는 7강 이상만 캘 수 있음
          } else if (block.mineralIdx === 5 && pickLv < 6) {
            // 티타늄은 6강 이상만 캘 수 있음
          } else {
            pl.gameData.miningProgress += dt;
            if (pl.gameData.miningProgress >= timeNeeded) {
              // 채굴 완료
              if (block.mineralIdx != null) {
                pl.gameData.score += MINERAL_POINTS[block.mineralIdx];
                this.room.broadcastEvent("treasure_mined", { id: pl.id, mineral: MINERALS[block.mineralIdx] });
              } else {
                // 광물이 없는 블록 - 6강 이상 곡괭이는 확률적으로 덤 보상
                const bonus = bonusChance(pickLv);
                if (bonus && Math.random() < bonus.chance) {
                  const bonusIdx = rollMineral(bonus.pool);
                  if (bonusIdx != null) {
                    pl.gameData.score += MINERAL_POINTS[bonusIdx];
                    this.room.broadcastEvent("treasure_bonus", { id: pl.id, mineral: MINERALS[bonusIdx] });
                  }
                }
              }
              pl.gameData.mine[pl.gameData.miningKey] = "air";
              pl.gameData.miningKey = null;
              pl.gameData.miningProgress = 0;
            }
          }
        }
      }
    });

    if (this.t >= DURATION) {
      this.finished = true;
      return true;
    }
    return false;
  }

  getRanking() {
    const alive = this.room.getAlivePlayers();
    return alive.map((p) => p.id).sort((a, b) => {
      const pa = alive.find((p) => p.id === a).gameData.score;
      const pb = alive.find((p) => p.id === b).gameData.score;
      return pb - pa;
    });
  }

  getScoreAwards() {
    const ranking = this.getRanking();
    const awards = {};
    const pts = TreasureHuntGame.rankPoints;
    ranking.forEach((pid, idx) => { awards[pid] = pts[idx] != null ? pts[idx] : 0; });
    return awards;
  }

  getStateJSON() {
    const players = this.room.getAlivePlayers();
    const VIEW_COLS = 10, VIEW_ROWS = 7; // 화면에 렌더링할 범위(자기 위치 기준)
    return {
      gameId: TreasureHuntGame.id,
      timeLeft: Math.max(0, Math.ceil(DURATION - this.t)),
      blockSize: BLOCK_SIZE,
      playerExtra: Object.fromEntries(
        players.map((p) => {
          const visionLv = this._getLevel(p.id, "시야");
          const visionRange = visionLv + 2;
          const visibleBlocks = {};
          for (let dc = -visionRange; dc <= visionRange; dc++) {
            for (let dr = -visionRange; dr <= visionRange; dr++) {
              const c = p.gameData.col + dc, r = p.gameData.row + dr;
              const block = this._blockAt(p, c, r);
              if (block && block !== "air" && block.mineralIdx != null) {
                visibleBlocks[`${c},${r}`] = MINERALS[block.mineralIdx];
              }
            }
          }
          // 화면에 그릴 실제 블록 그리드(캐낸 곳은 air로 표시되어 렌더러가 빈 공간으로 그림)
          const nearbyBlocks = {};
          for (let dc = -VIEW_COLS; dc <= VIEW_COLS; dc++) {
            for (let dr = -VIEW_ROWS; dr <= VIEW_ROWS; dr++) {
              const c = p.gameData.col + dc, r = p.gameData.row + dr;
              const block = this._blockAt(p, c, r);
              if (block === "air") nearbyBlocks[`${c},${r}`] = null;
              else nearbyBlocks[`${c},${r}`] = { groundType: block.groundType, mineral: block.mineralIdx != null ? MINERALS[block.mineralIdx] : null };
            }
          }
          return [p.id, {
            score: p.gameData.score,
            col: p.gameData.col,
            row: p.gameData.row,
            x: p.x, y: p.y,
            miningProgress: p.gameData.miningKey ? p.gameData.miningProgress : 0,
            miningKey: p.gameData.miningKey,
            visibleTreasures: visibleBlocks, // 시야 강화로 미리 보이는 보물들
            nearbyBlocks, // 화면 렌더링용 실제 블록 그리드
          }];
        })
      ),
    };
  }
}

module.exports = TreasureHuntGame;
