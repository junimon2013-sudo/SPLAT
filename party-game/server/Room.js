// server/Room.js
const {
  MSG,
  MODE,
  ROOM_PHASE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  TICK_MS,
} = require("../shared/constants");
const CoopEngine = require("./games/coop/CoopEngine");
const { STAGES } = require("./games/coop/stages");
const { CompetitionManager } = require("./games/competition/CompetitionManager");

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // id -> Player
    this.hostId = null;
    this.phase = ROOM_PHASE.LOBBY;
    this.mode = MODE.COOP;
    this.rounds = 5;
    this.selectedStageIndex = null; // null이면 전체 스테이지 순서대로, 값이 있으면 그 맵 하나만 플레이
    this.engine = null; // CoopEngine | CompetitionManager
    this._loopHandle = null;
    this._lastTick = Date.now();
  }

  isEmpty() {
    return this.players.size === 0;
  }

  isFull() {
    return this.players.size >= MAX_PLAYERS;
  }

  getAlivePlayers() {
    return Array.from(this.players.values());
  }

  _nextFreeColor() {
    const used = new Set(Array.from(this.players.values()).map((p) => p.color && p.color.id));
    const free = PLAYER_COLORS.find((c) => !used.has(c.id));
    return free ? free.id : PLAYER_COLORS[0].id;
  }

  addPlayer(player) {
    player.assignColor(this._nextFreeColor());
    this.players.set(player.id, player);
    if (!this.hostId) {
      this.hostId = player.id;
      player.isHost = true;
    }
    // 이미 방에 있던 사람들이 설정해둔 칼 스킨을, 새로 들어온 사람에게도 따라잡기 동기화.
    // 연결 직후(join_room 처리 시점)엔 소켓/커넥션이 아직 완전히 "열림" 확정 전이라 바로 보내면
    // 조용히 씹힐 수 있어서, 다음 틱(연결이 안정된 뒤)으로 살짝 늦춰서 보낸다.
    setTimeout(() => {
      this.players.forEach((p) => {
        if (p.id !== player.id && p.swordSkin) {
          player.send(MSG.GAME_EVENT, { event: "player_sword_skin", data: { playerId: p.id, swordSkin: p.swordSkin } });
        }
      });
    }, 300);
    this._ensureLoop();
    this.broadcastRoomState();
  }

  removePlayer(playerId) {
    const wasHost = this.hostId === playerId;
    this.players.delete(playerId);
    if (this.engine && this.engine.onPlayerLeave) {
      // best effort - 엔진에 알림 (탈락 처리 등)
      const fakePlayer = { id: playerId };
      this.engine.onPlayerLeave(fakePlayer);
    }
    if (wasHost) {
      const next = this.players.values().next();
      if (!next.done) {
        this.hostId = next.value.id;
        next.value.isHost = true;
      } else {
        this.hostId = null;
      }
    }
    if (this.players.size < MIN_PLAYERS && this.phase === ROOM_PHASE.IN_GAME) {
      // 인원 부족 -> 로비로 강제 복귀
      this.phase = ROOM_PHASE.LOBBY;
      this.engine = null;
      this.players.forEach((p) => (p.ready = false));
      this.broadcastEvent("room_notice", { message: "인원이 부족해 로비로 돌아갑니다." });
    }
    this.broadcastRoomState();
  }

  setMode(mode) {
    if (this.phase !== ROOM_PHASE.LOBBY) return;
    if (mode === MODE.COOP || mode === MODE.COMPETITION) {
      this.mode = mode;
      this.broadcastRoomState();
    }
  }

  // index가 null이면 "전체 스테이지 순서대로", 숫자면 "그 맵 하나만" 플레이하도록 고른다
  setStage(index) {
    if (this.phase !== ROOM_PHASE.LOBBY) return;
    if (index === null) {
      this.selectedStageIndex = null;
      this.broadcastRoomState();
      return;
    }
    const i = parseInt(index, 10);
    if (!Number.isNaN(i) && i >= 0 && i < STAGES.length) {
      this.selectedStageIndex = i;
      this.broadcastRoomState();
    }
  }

  setRounds(rounds) {
    if (this.phase !== ROOM_PHASE.LOBBY) return;
    const r = parseInt(rounds, 10);
    if ([3, 5, 7, 10].includes(r)) {
      this.rounds = r;
      this.broadcastRoomState();
    }
  }

  setReady(playerId, ready) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.ready = !!ready;
    this.broadcastRoomState();
  }

  // 로비에서 캐릭터 색상/장신구/칼 스킨을 바꾼다. 색상은 중복 선택이 안 되게 막는다.
  setAppearance(playerId, payload) {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, reason: "플레이어를 찾을 수 없습니다." };
    if (payload && payload.colorId) {
      const already = Array.from(this.players.values()).some(
        (other) => other.id !== p.id && other.color && other.color.id === payload.colorId
      );
      if (already) return { ok: false, reason: "이미 다른 플레이어가 선택한 색상입니다." };
      p.assignColor(payload.colorId);
    }
    if (payload && payload.accessory != null) {
      p.accessory = payload.accessory;
    }
    if (payload && payload.swordSkin !== undefined) {
      p.swordSkin = payload.swordSkin; // null이면 스킨 제거
      // 이미지 데이터는 매 틱 상태에 안 실어보내고, 딱 한 번만 이벤트로 브로드캐스트한다
      this.broadcastEvent("player_sword_skin", { playerId: p.id, swordSkin: p.swordSkin });
    }
    this.broadcastRoomState();
    return { ok: true };
  }

  canStart(requesterId) {
    if (requesterId !== this.hostId) return { ok: false, reason: "방장만 시작할 수 있습니다." };
    if (this.players.size < MIN_PLAYERS)
      return { ok: false, reason: "최소 2명의 플레이어가 필요합니다." };
    if (this.mode === MODE.COOP) {
      const allReady = Array.from(this.players.values()).every((p) => p.ready || p.isHost);
      if (!allReady) return { ok: false, reason: "모든 플레이어가 준비해야 합니다." };
      // 깃허브 페이지 등 정적 호스팅에서 <script src="커스텀스테이지.js">로 불러온 스테이지가 있으면
      // (스크립트 태그가 본문 스크립트보다 뒤에 있어도) 이 시점에 합쳐준다. Node 서버에는 window가 없다.
      if (typeof window !== "undefined" && window.SPLAT_CUSTOM_STAGES && window.SPLAT_CUSTOM_STAGES.length) {
        window.SPLAT_CUSTOM_STAGES.forEach((s) => {
          if (!STAGES.find((x) => x.id === s.id)) STAGES.push(s);
        });
      }
      if (STAGES.length === 0) {
        return { ok: false, reason: "협동 스테이지가 하나도 없습니다. 레벨 에디터로 스테이지를 만들어 추가해주세요." };
      }
      if (!CoopEngine.checkPlayerCount(STAGES[0], this.players.size)) {
        return { ok: false, reason: `이 스테이지는 ${STAGES[0].playerCount}명 전용입니다. 현재 인원: ${this.players.size}명` };
      }
    }
    return { ok: true };
  }

  startGame(requesterId) {
    const check = this.canStart(requesterId);
    if (!check.ok) return check;
    this.phase = ROOM_PHASE.IN_GAME;
    if (this.mode === MODE.COOP) {
      this.engine = new CoopEngine(this);
    } else {
      this.engine = new CompetitionManager(this, this.rounds);
    }
    this.broadcastRoomState();
    return { ok: true };
  }

  // 관리자 패널 전용 - 방장 여부/준비 상태를 무시하고 경쟁모드를 강제로 시작한다(테스트용)
  adminStartGame() {
    if (this.phase === ROOM_PHASE.IN_GAME) return;
    if (this.players.size < 1) return;
    this.mode = MODE.COMPETITION;
    this.phase = ROOM_PHASE.IN_GAME;
    this.engine = new CompetitionManager(this, this.rounds);
    this.broadcastRoomState();
  }

  retryStage() {
    if (this.mode === MODE.COOP && this.engine) this.engine.retry();
  }

  attemptEnhance(playerId, forceSuccess) {
    if (this.mode === MODE.COMPETITION && this.engine && typeof this.engine.attemptEnhance === "function") {
      const result = this.engine.attemptEnhance(playerId, forceSuccess);
      const player = this.players.get(playerId);
      if (player && result) player.send(MSG.GAME_EVENT, { event: "enhance_result", data: result });
    }
  }

  giveUp(playerId) {
    if (this.mode === MODE.COMPETITION && this.engine && this.engine.currentGame && typeof this.engine.currentGame.giveUp === "function") {
      this.engine.currentGame.giveUp(playerId);
    }
  }

  mineClick(playerId, col, row) {
    if (this.mode === MODE.COMPETITION && this.engine && this.engine.currentGame && typeof this.engine.currentGame.mineClick === "function") {
      this.engine.currentGame.mineClick(playerId, col, row);
    }
  }

  mineRelease(playerId) {
    if (this.mode === MODE.COMPETITION && this.engine && this.engine.currentGame && typeof this.engine.currentGame.mineRelease === "function") {
      this.engine.currentGame.mineRelease(playerId);
    }
  }

  returnToLobby() {
    this.phase = ROOM_PHASE.LOBBY;
    this.engine = null;
    this.players.forEach((p) => {
      p.ready = false;
      p.status = "connected";
    });
    this.broadcastRoomState();
  }

  handleInput(playerId, inputPayload) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== ROOM_PHASE.IN_GAME) return;
    p.input.up = !!inputPayload.up;
    p.input.down = !!inputPayload.down;
    p.input.left = !!inputPayload.left;
    p.input.right = !!inputPayload.right;
    p.input.action = !!inputPayload.action;
    p.input.interact = !!inputPayload.interact;
    p.input.dash = !!inputPayload.dash;
  }

  _ensureLoop() {
    if (this._loopHandle) return;
    this._lastTick = Date.now();
    this._loopHandle = setInterval(() => this._tick(), TICK_MS);
  }

  stopLoop() {
    if (this._loopHandle) {
      clearInterval(this._loopHandle);
      this._loopHandle = null;
    }
  }

  _tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this._lastTick) / 1000);
    this._lastTick = now;

    if (this.phase === ROOM_PHASE.IN_GAME && this.engine) {
      this.engine.update(dt);

      // 협동: CLEAR 후 일정 시간 지나면 RESULT 진입 -> RESULT에서 자동으로 다음 스테이지 진행
      this.broadcastGameState();
    }
  }

  broadcastRoomState() {
    const payload = {
      code: this.code,
      phase: this.phase,
      mode: this.mode,
      rounds: this.rounds,
      hostId: this.hostId,
      selectedStageIndex: this.selectedStageIndex,
      stageList: STAGES.map((s, i) => ({ index: i, name: s.name })),
      players: Array.from(this.players.values()).map((p) => p.toPublicJSON()),
    };
    this.players.forEach((p) => p.send(MSG.ROOM_STATE, payload));
  }

  broadcastGameState() {
    if (!this.engine) return;
    const payload = {
      players: Array.from(this.players.values()).map((p) => p.toPublicJSON()),
      ...this.engine.getStateJSON(),
    };
    this.players.forEach((p) => p.send(MSG.GAME_STATE, payload));
  }

  broadcastEvent(eventName, data) {
    this.players.forEach((p) => p.send(MSG.GAME_EVENT, { event: eventName, data }));
  }
}

module.exports = Room;
