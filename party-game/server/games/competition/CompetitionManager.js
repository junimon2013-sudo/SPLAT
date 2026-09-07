// server/games/competition/CompetitionManager.js
const { COMP_STATE, COUNTDOWN_SECONDS } = require("../../../shared/constants");
const { EnhancementPhase } = require("./EnhancementSystem");
const PushOutGame = require("./PushOutGame");
const TailTagGame = require("./TailTagGame");
const RaceGame = require("./RaceGame");
const BombPassGame = require("./BombPassGame");
const TerritoryGame = require("./TerritoryGame");
const TreasureHuntGame = require("./TreasureHuntGame");
const ReactionGame = require("./ReactionGame");
const FishingGame = require("./FishingGame");

// 새 미니게임을 추가하려면 이 배열에 클래스만 추가하면 된다.
// 각 게임 클래스는 static enhancementItems(강화 항목 이름 배열, 없으면 [])와
// static rankPoints(순위별 점수 배열, 없으면 기본 [3,2,1])를 가질 수 있다.
const GAME_POOL = [
  PushOutGame,
  TailTagGame,
  RaceGame,
  BombPassGame,
  TerritoryGame,
  TreasureHuntGame,
  ReactionGame,
  FishingGame,
];

const DEFAULT_RANK_POINTS = [3, 2, 1]; // 게임이 자기만의 rankPoints를 안 정해뒀을 때 기본값

class CompetitionManager {
  constructor(room, totalRounds) {
    this.room = room;
    this.totalRounds = totalRounds || 3;
    this.round = 0;
    this.state = COMP_STATE.GAME_INTRO;
    this.timer = 0;
    this.scores = {}; // playerId -> 누적 점수
    room.players.forEach((pl) => (this.scores[pl.id] = 0));
    this.currentGame = null;
    this.enhancementPhase = null;
    this.lastRoundResult = null; // {ranking, pointsGained}
    this._adminForcedGameId = null; // orange 관리자 패널로 강제 지정한 게임 id
    this._pickGame();
  }

  _pickGame() {
    let GameClass;
    if (this._adminForcedGameId) {
      GameClass = GAME_POOL.find((g) => g.id === this._adminForcedGameId) || GAME_POOL[0];
      this._adminForcedGameId = null;
    } else if (GAME_POOL.length === 1) {
      GameClass = GAME_POOL[0];
    } else {
      do {
        GameClass = GAME_POOL[Math.floor(Math.random() * GAME_POOL.length)];
      } while (this.GameClass && GameClass.id === this.GameClass.id);
    }
    this.GameClass = GameClass;
    this.enhancementPhase = null;
    this._enter(COMP_STATE.GAME_INTRO);
  }

  // 관리자 패널에서 특정 게임으로 바로 이동
  adminJumpToGame(gameId) {
    this._adminForcedGameId = gameId;
    this._pickGame();
  }

  // 관리자 패널에서 특정 플레이어의 강화를 즉시 만렙으로
  adminForceMaxEnhance(playerId) {
    if (this.enhancementPhase) this.enhancementPhase.forceMaxAll(playerId);
  }

  onPlayerLeave(player) {
    // 점수 기록은 유지, 게임 중이면 해당 플레이어는 자연히 update에서 제외됨
  }

  // 클라이언트에서 강화 버튼을 눌렀을 때 호출. forceSuccess=true면(관리자 패널) 이번 1회를 무조건 성공시킨다
  attemptEnhance(playerId, forceSuccess) {
    if (!this.enhancementPhase) return null;
    return this.enhancementPhase.attemptEnhance(playerId, forceSuccess);
  }

  update(dt) {
    this.timer += dt;
    switch (this.state) {
      case COMP_STATE.GAME_INTRO:
        if (this.timer >= 2.2) {
          const items = this.GameClass.enhancementItems || [];
          if (items.length > 0) {
            this.enhancementPhase = new EnhancementPhase(this.room, items);
            this._enter(COMP_STATE.ENHANCEMENT);
          } else {
            this._enter(COMP_STATE.COUNTDOWN);
          }
        }
        break;
      case COMP_STATE.ENHANCEMENT: {
        const done = this.enhancementPhase.update(dt);
        if (done || this.timer >= (this.GameClass.enhancementItems || []).length * 30 + 1) {
          this._enter(COMP_STATE.COUNTDOWN);
        }
        break;
      }
      case COMP_STATE.COUNTDOWN:
        if (this.timer >= COUNTDOWN_SECONDS) {
          const enhanceLevels = this.enhancementPhase ? this.enhancementPhase.getFinalLevels() : null;
          this.currentGame = new this.GameClass(this.room, enhanceLevels);
          this._enter(COMP_STATE.PLAYING);
        }
        break;
      case COMP_STATE.PLAYING: {
        const done = this.currentGame.update(dt);
        if (done) this._finishRound();
        break;
      }
      case COMP_STATE.GAME_END:
        if (this.timer >= 1.5) this._enter(COMP_STATE.RESULT);
        break;
      case COMP_STATE.RESULT:
        // room이 다음 라운드 진행을 트리거 (자동 진행)
        if (this.timer >= 3.5) this._advance();
        break;
      case COMP_STATE.FINAL_RESULT:
        break;
    }
  }

  _enter(state) {
    this.state = state;
    this.timer = 0;
  }

  _finishRound() {
    let pointsGained;
    // 게임이 자기만의 점수 배분 로직(getScoreAwards)을 갖고 있으면 그걸 그대로 쓰고,
    // 없으면 기존처럼 순위 기반(rankPoints 또는 기본 3/2/1)으로 배분한다.
    if (typeof this.currentGame.getScoreAwards === "function") {
      pointsGained = this.currentGame.getScoreAwards();
    } else {
      const ranking = this.currentGame.getRanking();
      const rankPoints = this.GameClass.rankPoints || DEFAULT_RANK_POINTS;
      pointsGained = {};
      ranking.forEach((pid, idx) => {
        pointsGained[pid] = rankPoints[idx] != null ? rankPoints[idx] : 0;
      });
    }
    Object.entries(pointsGained).forEach(([pid, pts]) => {
      this.scores[pid] = (this.scores[pid] || 0) + pts;
    });
    const ranking = typeof this.currentGame.getRanking === "function" ? this.currentGame.getRanking() : Object.keys(pointsGained);
    this.lastRoundResult = { ranking, pointsGained, gameName: this.GameClass.displayName };
    this._enter(COMP_STATE.GAME_END);
  }

  _advance() {
    this.round++;
    if (this.round >= this.totalRounds) {
      this._enter(COMP_STATE.FINAL_RESULT);
    } else {
      this._pickGame();
    }
  }

  getFinalRanking() {
    return Object.entries(this.scores)
      .sort((a, b) => b[1] - a[1])
      .map(([id, score]) => ({ id, score }));
  }

  getStateJSON() {
    return {
      mode: "competition",
      state: this.state,
      round: this.round + 1,
      totalRounds: this.totalRounds,
      gameId: this.GameClass.id,
      gameName: this.GameClass.displayName,
      gameDescription: this.GameClass.description,
      enhancementItems: this.GameClass.enhancementItems || [],
      enhancement: this.enhancementPhase ? this.enhancementPhase.getStateJSON() : null,
      countdown:
        this.state === COMP_STATE.COUNTDOWN
          ? Math.max(0, Math.ceil(COUNTDOWN_SECONDS - this.timer))
          : null,
      scores: this.scores,
      lastRoundResult: this.lastRoundResult,
      finalRanking: this.state === COMP_STATE.FINAL_RESULT ? this.getFinalRanking() : null,
      game: this.currentGame ? this.currentGame.getStateJSON() : null,
      gamePool: GAME_POOL.map((g) => ({ id: g.id, name: g.displayName })), // 관리자 패널용
    };
  }
}

module.exports = { CompetitionManager, GAME_POOL };
