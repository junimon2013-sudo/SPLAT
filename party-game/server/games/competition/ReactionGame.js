// server/games/competition/ReactionGame.js
// 반응속도 - 이동 없음. 가운데 패널에 3-2-1 카운트다운(빨간색) 후 초록색으로 바뀌면 스페이스!
// 빨간색 상태에서 누르면 그 라운드 1000ms 페널티. 3라운드 합산이 가장 낮은 사람이 승리.
const { rand } = require("./utils");

const ROUNDS = 3;
const COUNTDOWN_TIME = 3; // 3-2-1 카운트다운(빨간색 단계) 길이(초)
const MIN_WAIT_AFTER_GREEN = 1; // 초록색으로 바뀐 뒤 실제 신호까지 추가 대기(초록 자체가 신호이므로 0으로 둬도 되지만 약간의 랜덤을 위해 사용)
const MAX_WAIT_AFTER_GREEN = 3;
const EARLY_PENALTY = 1000; // 빨간색(카운트다운) 상태에서 누르면 이 ms로 기록

class ReactionGame {
  static id = "reaction";
  static displayName = "반응속도";
  static description = "패널이 빨간색일 때 누르면 페널티! 초록색으로 바뀌면 최대한 빨리 스페이스!";
  static enhancementItems = []; // 강화 없음
  static rankPoints = [4]; // 우승자만 4점

  constructor(room) {
    this.room = room;
    this.finished = false;
    this.round = 0;
    this.totalMs = {};
    room.getAlivePlayers().forEach((pl) => {
      pl.status = "playing";
      this.totalMs[pl.id] = 0;
    });
    this._setupRound();
  }

  _setupRound() {
    this.phase = "countdown"; // countdown(빨간색, 3-2-1) -> signal(초록색, 실제 신호)
    this.roundT = 0;
    this.greenAt = COUNTDOWN_TIME + rand(MIN_WAIT_AFTER_GREEN, MAX_WAIT_AFTER_GREEN);
    this.signalT = null;
    this.pressed = {};
    this.room.getAlivePlayers().forEach((pl) => (this.pressed[pl.id] = false));
    this.room.broadcastEvent("reaction_round_start", { round: this.round + 1 });
  }

  update(dt) {
    if (this.finished) return true;
    this.roundT += dt;
    const players = this.room.getAlivePlayers();

    if (this.phase === "countdown" && this.roundT >= this.greenAt) {
      this.phase = "signal";
      this.signalT = this.roundT;
      this.room.broadcastEvent("reaction_signal", {});
    }

    players.forEach((pl) => {
      if (this.pressed[pl.id]) {
        pl.commitInputFrame();
        return;
      }
      if (pl.actionPressed()) {
        this.pressed[pl.id] = true;
        if (this.phase === "countdown") {
          // 빨간색(카운트다운) 상태에서 성급하게 누름 - 1000ms 고정 페널티
          this.totalMs[pl.id] += EARLY_PENALTY;
          this.room.broadcastEvent("reaction_early", { id: pl.id });
        } else {
          const rt = Math.round((this.roundT - this.signalT) * 1000);
          this.totalMs[pl.id] += rt;
          this.room.broadcastEvent("reaction_result", { id: pl.id, ms: rt });
        }
      }
      pl.commitInputFrame();
    });

    const allPressed = players.every((pl) => this.pressed[pl.id]);
    const roundTimeout = this.phase === "signal" && this.roundT - this.signalT > 3;
    if (allPressed || roundTimeout) {
      players.forEach((pl) => {
        if (!this.pressed[pl.id]) this.totalMs[pl.id] += EARLY_PENALTY;
      });
      this.round++;
      if (this.round >= ROUNDS) {
        this.finished = true;
        return true;
      }
      this._setupRound();
    }
    return false;
  }

  getRanking() {
    const players = this.room.getAlivePlayers().map((p) => p.id);
    return players.sort((a, b) => (this.totalMs[a] || 0) - (this.totalMs[b] || 0));
  }

  // 1등에게만 4점 (그 밖은 0점)
  getScoreAwards() {
    const ranking = this.getRanking();
    const awards = {};
    ranking.forEach((pid, idx) => { awards[pid] = idx === 0 ? ReactionGame.rankPoints[0] : 0; });
    return awards;
  }

  getStateJSON() {
    return {
      gameId: ReactionGame.id,
      round: Math.min(this.round + 1, ROUNDS),
      totalRoundsInGame: ROUNDS,
      phase: this.phase, // "countdown"(빨간색) | "signal"(초록색)
      countdownLeft: this.phase === "countdown" ? Math.max(0, Math.ceil(COUNTDOWN_TIME - this.roundT)) : 0,
      playerExtra: Object.fromEntries(
        Object.entries(this.totalMs).map(([id, ms]) => [id, { totalMs: ms, pressed: !!this.pressed[id] }])
      ),
    };
  }
}

module.exports = ReactionGame;
