// server/Player.js
const { PLAYER_COLORS, PHYSICS } = require("../shared/constants");

let nextInternalId = 1;

class Player {
  constructor(ws, name) {
    this.id = "p" + nextInternalId++;
    this.ws = ws;
    this.name = (name || "Player").slice(0, 12);
    this.color = null; // room이 배정
    this.accessory = "none"; // 장신구(로비에서 선택)
    this.swordSkin = null; // 칼 스킨 이미지(data URL, 로비에서 업로드)
    this.isHost = false;
    this.ready = false;
    this.connected = true;

    // 공통 게임 상태 (탑다운 좌표계)
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = { x: 0, y: 1 };
    this.radius = PHYSICS.PLAYER_RADIUS;
    this.speedMultiplier = 1; // 속도 포털을 지나가면 바뀌는 배율(누적)

    // 입력 상태 (클라이언트가 매 프레임 전송)
    this.input = {
      up: false,
      down: false,
      left: false,
      right: false,
      action: false, // 이번 tick에 새로 눌렸는지 여부는 서버에서 edge 감지
      interact: false,
      dash: false,
      jump: false, // Q키 - 경쟁모드 일부 게임(밀어내기 등)에서 회피/점프용
    };
    this._prevAction = false;
    this._prevInteract = false;
    this._prevDash = false;
    this._prevJump = false;

    this.dashTimer = 0;
    this.dashCooldown = 0;

    // 게임별 확장 상태 (co-op/경쟁 로직에서 자유롭게 사용)
    this.status = "connected"; // connected, ready, playing, eliminated, finished, winner
    this.gameData = {};
  }

  assignColor(colorId) {
    const c = PLAYER_COLORS.find((c) => c.id === colorId) || PLAYER_COLORS[0];
    this.color = c;
  }

  // 이번 tick에 새로 눌린 입력인지 (edge trigger)
  actionPressed() {
    const pressed = this.input.action && !this._prevAction;
    return pressed;
  }
  interactPressed() {
    return this.input.interact && !this._prevInteract;
  }
  dashPressed() {
    return this.input.dash && !this._prevDash;
  }
  jumpPressed() {
    return this.input.jump && !this._prevJump;
  }

  commitInputFrame() {
    this._prevAction = this.input.action;
    this._prevInteract = this.input.interact;
    this._prevDash = this.input.dash;
    this._prevJump = this.input.jump;
  }

  toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      color: this.color ? this.color.id : null,
      colorHex: this.color ? this.color.hex : "#ffffff",
      accessory: this.accessory || "none",
      isHost: this.isHost,
      ready: this.ready,
      connected: this.connected,
      x: Math.round(this.x),
      y: Math.round(this.y),
      radius: this.radius,
      speedMultiplier: this.speedMultiplier,
      facing: this.facing,
      status: this.status,
      swordSwing: this.gameData && this.gameData.swordSwing > 0 ? this.gameData.swordSwing : 0,
      dashing: this.dashTimer > 0,
      nearKeyId: (this.gameData && this.gameData.nearKeyId) || null,
      nearSwitchId: (this.gameData && this.gameData.nearSwitchId) || null,
      carriedKeyIds: (this.gameData && this.gameData.carriedKeyIds) || [],
    };
  }

  send(type, payload) {
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({ type, payload }));
      } catch (e) {
        // ignore send errors (client probably disconnecting)
      }
    }
  }
}

module.exports = Player;
