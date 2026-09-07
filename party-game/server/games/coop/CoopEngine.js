// server/games/coop/CoopEngine.js
const { COOP_STATE, PHYSICS, COUNTDOWN_SECONDS } = require("../../../shared/constants");
const { STAGES } = require("./stages");

const PIT_GRACE_SECONDS = 0.4;
const SWORD_RANGE = 46;
const SWORD_SWING_DURATION = 0.22;
const SWORD_COOLDOWN = 0.32;
// 포털을 지나가면 커지거나 작아지는 배율(방향마다 누적) 및 한도 - 최소는 원래 크기의 1/10,
// 최대는 대략 맵의 벽 하나 크기 정도(그 이상으로 계산돼도 화면·판정엔 이 크기까지만 적용)
const PORTAL_GROW_FACTOR = 1.3; // 포털 배치 시 기본값 (오브젝트별 factor로 덮어쓸 수 있음)
const PORTAL_MIN_SCALE = 0.1;
const PORTAL_MAX_RADIUS = 130;
const PORTAL_MAX_SPEED_MULT = 5; // 속도 포털은 "벽 크기"라는 기준이 안 맞아서 배율 자체에 상한을 둔다

function circleRectCollide(cx, cy, cr, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < cr * cr;
}

function resolveCircleRect(px, py, pr, rect) {
  const closestX = Math.max(rect.x, Math.min(px, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(py, rect.y + rect.h));
  let dx = px - closestX;
  let dy = py - closestY;
  let dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) {
    const overlaps = [
      { d: px - rect.x, ax: -1, ay: 0 },
      { d: rect.x + rect.w - px, ax: 1, ay: 0 },
      { d: py - rect.y, ax: 0, ay: -1 },
      { d: rect.y + rect.h - py, ax: 0, ay: 1 },
    ];
    overlaps.sort((a, b) => a.d - b.d);
    return { x: px + overlaps[0].ax * pr, y: py + overlaps[0].ay * pr };
  }
  const push = pr - dist;
  dx /= dist;
  dy /= dist;
  return { x: px + dx * push, y: py + dy * push };
}

// 회전(rotation, 도형 자체의 정적 각도)이 걸린 사각형과의 원 충돌 판정: 원의 중심을
// 사각형의 로컬(회전 안 된) 좌표계로 역회전시켜서 일반 축정렬 판정을 그대로 재사용한다.
function toLocalSpace(px, py, rect, rotationDeg) {
  if (!rotationDeg) return { x: px, y: py };
  const rad = (-rotationDeg * Math.PI) / 180;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}
function fromLocalDelta(dx, dy, rotationDeg) {
  if (!rotationDeg) return { x: dx, y: dy };
  const rad = (rotationDeg * Math.PI) / 180;
  return { x: dx * Math.cos(rad) - dy * Math.sin(rad), y: dx * Math.sin(rad) + dy * Math.cos(rad) };
}
function circleRectCollideRotated(cx, cy, cr, rect, rotationDeg) {
  const local = toLocalSpace(cx, cy, rect, rotationDeg);
  return circleRectCollide(local.x, local.y, cr, rect);
}
function resolveCircleRectRotated(px, py, pr, rect, rotationDeg) {
  if (!rotationDeg) return resolveCircleRect(px, py, pr, rect);
  const local = toLocalSpace(px, py, rect, rotationDeg);
  const resolvedLocal = resolveCircleRect(local.x, local.y, pr, rect);
  const localDelta = { x: resolvedLocal.x - local.x, y: resolvedLocal.y - local.y };
  const worldDelta = fromLocalDelta(localDelta.x, localDelta.y, rotationDeg);
  return { x: px + worldDelta.x, y: py + worldDelta.y };
}

// ============================================================
// 범용 움직임(모든 블록 타입에 공통 적용: 왕복 직선 또는 회전운동)
// ============================================================
function initMovementState(def) {
  if (!def.movement) return { x: def.x, y: def.y };
  if (def.movement.type === "rotate") {
    return { angle: def.movement.startAngle || 0, x: def.x, y: def.y };
  }
  if (def.movement.type === "waypoints") {
    return { elapsed: 0, x: def.x, y: def.y };
  }
  return { t: 0, x: def.x, y: def.y };
}

// 다중 정거장(waypoints) 경로 계산 - 레벨 에디터의 검증된 계산식과 동일 (구간별 속도, 왕복/순환)
function waypointSegments(m) {
  const wps = m.waypoints || [];
  const loop = m.loopMode === "loop";
  const n = loop ? wps.length : Math.max(0, wps.length - 1);
  const segs = [];
  for (let i = 0; i < n; i++) {
    const a = wps[i];
    const b = wps[(i + 1) % wps.length];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const speed = Math.max(1, a.speed || 40);
    segs.push({ from: a, to: b, duration: dist / speed });
  }
  return { segs, loop };
}
function waypointPositionAt(m, tSeconds) {
  const wps = m.waypoints || [];
  if (wps.length === 0) return { x: 0, y: 0 };
  if (wps.length === 1) return { x: wps[0].x, y: wps[0].y };
  const { segs, loop } = waypointSegments(m);
  const forwardDuration = segs.reduce((s, seg) => s + seg.duration, 0);
  if (forwardDuration <= 0) return { x: wps[0].x, y: wps[0].y };

  let cyclePos;
  let segsToWalk;
  if (loop) {
    cyclePos = tSeconds % forwardDuration;
    segsToWalk = segs;
  } else {
    const cycleDuration = forwardDuration * 2;
    cyclePos = tSeconds % cycleDuration;
    if (cyclePos <= forwardDuration) {
      segsToWalk = segs;
    } else {
      cyclePos -= forwardDuration;
      segsToWalk = segs.slice().reverse().map((s) => ({ from: s.to, to: s.from, duration: s.duration }));
    }
  }
  let acc = 0;
  for (const seg of segsToWalk) {
    if (cyclePos <= acc + seg.duration) {
      const segT = seg.duration > 0 ? (cyclePos - acc) / seg.duration : 0;
      return { x: seg.from.x + (seg.to.x - seg.from.x) * segT, y: seg.from.y + (seg.to.y - seg.from.y) * segT };
    }
    acc += seg.duration;
  }
  const last = segsToWalk[segsToWalk.length - 1];
  return { x: last.to.x, y: last.to.y };
}

// ---- 트리거(밟으면 발동) 관련 헬퍼 - 레벨 에디터의 검증된 계산식과 동일 ----
function hexToRgbTrig(hex) {
  hex = String(hex || "#888888").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const num = parseInt(hex, 16) || 0;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function lerpHexColor(c1, c2, t) {
  const p1 = hexToRgbTrig(c1), p2 = hexToRgbTrig(c2);
  const r = Math.round(p1.r + (p2.r - p1.r) * t);
  const g = Math.round(p1.g + (p2.g - p1.g) * t);
  const b = Math.round(p1.b + (p2.b - p1.b) * t);
  return `rgb(${r},${g},${b})`;
}
function triggerAnimOffset(anim, tSeconds) {
  if (!anim || anim.kind !== "move") return { dx: 0, dy: 0 };
  const progress = anim.duration > 0 ? Math.min(1, (tSeconds - anim.startT) / anim.duration) : 1;
  const curX = anim.fromX + (anim.toX - anim.fromX) * progress;
  const curY = anim.fromY + (anim.toY - anim.fromY) * progress;
  return { dx: curX - anim.baseX, dy: curY - anim.baseY };
}
function triggerAnimColor(anim, tSeconds) {
  if (!anim || anim.kind !== "color") return null;
  const progress = anim.duration > 0 ? Math.min(1, (tSeconds - anim.startT) / anim.duration) : 1;
  return lerpHexColor(anim.fromColor, anim.toColor, progress);
}

function stepMovement(def, state, dt, ridersCount) {
  if (!def.movement) return;
  const m = def.movement;
  if (m.type === "rotate") {
    const dir = m.clockwise === false ? -1 : 1;
    state.angle = (state.angle || 0) + dir * (m.speed || 30) * dt;
    const rad = (state.angle * Math.PI) / 180;
    const w = def.w || 0;
    const h = def.h || 0;
    state.x = m.centerX + Math.cos(rad) * (m.radius || 0) - w / 2;
    state.y = m.centerY + Math.sin(rad) * (m.radius || 0) - h / 2;
    return;
  }
  if (m.type === "waypoints") {
    state.elapsed = (state.elapsed || 0) + dt;
    const pos = waypointPositionAt(m, state.elapsed);
    state.x = pos.x;
    state.y = pos.y;
    return;
  }
  const range = Math.abs(m.to - m.from);
  if (range < 0.001) return;
  const dir = m.to >= m.from ? 1 : -1;
  // 필요 인원이 정해져 있으면: 그 인원 이상이 타고 있을 때만 앞으로 나아가고,
  // 아니면 출발점(state.t = 0)으로 서서히 되돌아간다
  const gateOk = m.requiredRiders == null || (ridersCount || 0) >= m.requiredRiders;
  const tStep = ((m.speed || 40) * dt) / Math.max(1, range);
  if (gateOk) {
    state.t = (state.t || 0) + tStep;
  } else {
    state.t = Math.max(0, (state.t || 0) - tStep);
  }
  const phase = (Math.sin(state.t * Math.PI * 2 - Math.PI / 2) + 1) / 2;
  const pos = m.from + dir * range * phase;
  if (m.axis === "y") {
    state.x = def.x;
    state.y = pos;
  } else {
    state.x = pos;
    state.y = def.y;
  }
}

class CoopEngine {
  constructor(room) {
    this.room = room;
    this.singleStageMode = room.selectedStageIndex != null; // 특정 맵 하나만 골라서 시작한 경우
    this.stageIndex = room.selectedStageIndex != null ? room.selectedStageIndex : 0;
    this.state = COOP_STATE.STAGE_INTRO;
    this.timer = 0;
    this.stageTimeLeft = 0;
    this.collectedKeys = 0;
    this.keys = [];
    this.plateGroupsOpen = {};
    this.doorsOpen = {};
    this.doorOpenedAt = {};
    this.eliminated = new Set();
    this._playingElapsed = 0;
    this._loadStage();
  }

  _loadStage() {
    const def = STAGES[this.stageIndex];
    this.def = def;
    this.state = COOP_STATE.STAGE_INTRO;
    this.timer = 0;
    this.stageTimeLeft = def.timeLimit;
    this.collectedKeys = 0;
    this.collectedKeyIds = new Set();
    this.keys = def.keys.map((k) => ({ ...k, collected: false }));
    this.plateGroupsOpen = {};
    this.doorsOpen = {};
    this.doorOpenedAt = {};
    this.doorConditionWasMet = {};
    this.eliminated = new Set();
    this._playingElapsed = 0;
    this.brokenDestructibles = new Set();
    this.destructibleHits = {};

    this.platformState = def.platforms.map((p) => initMovementState(p));
    this.heavyBlockState = (def.heavyBlocks || []).map((b) => ({ x: b.x, y: b.y })); // 무거운 블럭 - 여러 명이 밀면 움직임
    this.portalState = (def.portals || []).map((po) => ({ x: po.x, y: po.y })); // 포털도 트리거로 이동시킬 수 있어야 하니 상태를 둔다
    this.wallState = (def.walls || []).map((w) => initMovementState(w));
    this.pitState = (def.pits || []).map((p) => initMovementState(p));
    this.killbrickState = (def.killbricks || []).map((k) => initMovementState(k));
    this.doorState = (def.doors || []).map((d) => initMovementState(d));
    this.destructibleState = (def.destructibles || []).map((d) => initMovementState(d));
    this.plateState = (def.plates || []).map((p) => initMovementState(p));
    this.keyState = (def.keys || []).map((k) => initMovementState(k));
    this.toggleBlockState = (def.toggleBlocks || []).map((b) => ({ visible: b.visible !== false })); // 스위치로 켜고 끄는 블럭 - 초기 상태 반영
    this.teleporterState = (def.teleporters || []).map((tp) => initMovementState(tp));
    this.triggerActive = {}; // 트리거 id -> 지금 누군가 그 영역 안에 있는지 (밟는 순간에만 발동시키기 위함)
    this.triggerAnim = {}; // "type:id:kind" -> 진행 중인 이동/색상 애니메이션 상태
    this.triggerSequences = []; // 진행 중인 트리거 시퀀스들 [{trId, stepIndex, stepStartT, waitMode, waitMs, maxDurationMs}]
    this.cameraTriggerEvent = null; // 카메라 트리거가 발동하면 클라이언트에 1회성으로 알릴 정보
    this.prevPlatformPos = {}; // platform id -> 직전 tick의 위치 (발판 이동량만큼 위에 탄 플레이어를 실어 나르기 위함)
    this.platformRiders = {}; // platform id -> 직전 tick에 그 위에 있던 플레이어 수 (필요 인원 조건에 사용, 한 틱 지연)
    this.portalSide = {}; // "playerId:portalId" -> 직전 tick에 그 플레이어가 포털 중심의 왼쪽/오른쪽 중 어디 있었는지

    this._assignSpawns();
    this._broadcastStageAssets();
  }

  // 다중 스폰 + 인원수 흩뿌리기: spawns 배열(각 {x,y,count})을 앞에서부터 채우고,
  // count 합보다 인원이 많으면 남는 인원은 맵 안에서 무작위 위치에 흩뿌린다.
  // 구버전 스테이지(spawns 없이 단일 spawn:{x,y}만 있는 경우)는 기존 방식 그대로 동작한다.
  _assignSpawns() {
    const def = this.def;
    const players = this.room.getAlivePlayers();
    const bounds = def.bounds;

    const resetPlayer = (pl, x, y) => {
      pl.x = x;
      pl.y = y;
      pl.vx = 0;
      pl.vy = 0;
      pl.status = "playing";
      pl.gameData.finished = false;
      pl.gameData.pitGrace = 0;
      pl.gameData.toolActive = false;
      pl.gameData.swordSwing = 0;
      pl.gameData.swordCooldown = 0;
      pl.gameData.nearKeyId = null;
      pl.gameData.carriedKeyIds = [];
      pl.gameData.teleportCooldown = 0;
    };

    if (!def.spawns || !def.spawns.length) {
      const base = def.spawn || { x: 100, y: 100 };
      players.forEach((pl, i) => resetPlayer(pl, base.x + (i % 2) * 50, base.y + Math.floor(i / 2) * 50));
      return;
    }

    const slots = [];
    def.spawns.forEach((sp) => {
      const n = sp.count || 1;
      if (n === 1) {
        slots.push({ x: sp.x, y: sp.y });
      } else {
        // "이 지점 주변에 흩뿌릴 인원 수" - 여러 명이면 겹치지 않게 원형으로 고르게 펼친다
        const scatterRadius = PHYSICS.PLAYER_RADIUS * 2.5;
        for (let i = 0; i < n; i++) {
          const angle = (Math.PI * 2 * i) / n;
          slots.push({ x: sp.x + Math.cos(angle) * scatterRadius, y: sp.y + Math.sin(angle) * scatterRadius });
        }
      }
    });
    while (slots.length < players.length) {
      slots.push({
        x: PHYSICS.PLAYER_RADIUS + Math.random() * Math.max(1, bounds.width - PHYSICS.PLAYER_RADIUS * 2),
        y: PHYSICS.PLAYER_RADIUS + Math.random() * Math.max(1, bounds.height - PHYSICS.PLAYER_RADIUS * 2),
      });
    }
    players.forEach((pl, i) => {
      const slot = slots[i % slots.length];
      resetPlayer(pl, slot.x, slot.y);
    });
  }

  onPlayerLeave(player) {
    this.eliminated.delete(player.id);
  }

  // 이미지가 붙은 오브젝트가 있으면, 매 틱 재전송하지 않고 스테이지 로드 시 딱 한 번만 보낸다
  // (base64 이미지를 30Hz 게임 상태에 매번 실어보내면 대역폭이 감당 안 된다).
  _broadcastStageAssets() {
    const def = this.def;
    const assets = {};
    (def.walls || []).forEach((w, i) => { if (w.image) assets["wall:" + i] = w.image; });
    (def.pits || []).forEach((p, i) => { if (p.image) assets["pit:" + i] = p.image; });
    (def.killbricks || []).forEach((k) => { if (k.image) assets["killbrick:" + k.id] = k.image; });
    (def.doors || []).forEach((d) => { if (d.image) assets["door:" + d.id] = d.image; });
    (def.platforms || []).forEach((p) => { if (p.image) assets["platform:" + p.id] = p.image; });
    (def.destructibles || []).forEach((d) => { if (d.image) assets["destructible:" + d.id] = d.image; });
    (def.keys || []).forEach((k) => { if (k.image) assets["key:" + k.id] = k.image; });
    (def.plates || []).forEach((p) => { if (p.image) assets["plate:" + p.id] = p.image; });
    (def.teleporters || []).forEach((tp) => { if (tp.image) assets["teleporter:" + tp.id] = tp.image; });
    if (def.goal && def.goal.image) assets["goal"] = def.goal.image;
    this.room.broadcastEvent("stage_assets", assets);
  }

  _activePlateCount(group) {
    const groupPlates = this.def.plates.filter((p) => p.group === group);
    const aliveCount = this.room.getAlivePlayers().filter((p) => !this.eliminated.has(p.id)).length;
    return Math.max(1, Math.min(groupPlates.length, aliveCount));
  }

  // 방장이 게임을 시작하기 전에, 이 스테이지가 요구하는 인원수와 현재 방 인원이 맞는지 확인
  static checkPlayerCount(stageDef, playerCount) {
    if (!stageDef || !stageDef.playerCount) return true;
    return playerCount === stageDef.playerCount;
  }

  update(dt) {
    this.timer += dt;
    switch (this.state) {
      case COOP_STATE.STAGE_INTRO:
        if (this.timer >= 2.5) this._enter(COOP_STATE.COUNTDOWN);
        break;
      case COOP_STATE.COUNTDOWN:
        if (this.timer >= COUNTDOWN_SECONDS) this._enter(COOP_STATE.PLAYING);
        break;
      case COOP_STATE.PLAYING:
        this._updatePlaying(dt);
        break;
      case COOP_STATE.CLEAR:
      case COOP_STATE.FAILED:
        if (this.timer >= 2.5) {
          this._resultFrom = this.state;
          this._enter(COOP_STATE.RESULT);
        }
        break;
      case COOP_STATE.RESULT:
        if (this._resultFrom === COOP_STATE.CLEAR && this.timer >= 3) {
          // 특정 맵 하나만 골라서 시작했으면(단일 맵 모드) 클리어 즉시 로비로 돌아간다
          if (this.singleStageMode || this.stageIndex >= STAGES.length - 1) {
            this.room.returnToLobby();
          } else {
            this.nextStage();
          }
        }
        break;
    }
  }

  _enter(state) {
    this.state = state;
    this.timer = 0;
  }

  // 트리거가 발동됐을 때 실제로 적용 - 대상 타입에 맞는 state 배열에서 현재 위치/색을 찾아 애니메이션 등록
  // 트리거 액션 하나를 실제로 발동시킨다 (이동/색상/쉐이크/카메라)
  _activateTriggerAction(action, nowSec) {
    if (action.kind === "move" || action.kind === "color") {
      if (!action.targetType || !action.targetId) return;
      const defArr = this.def[action.targetType + "s"] || [];
      const stateArr = this[action.targetType + "State"];
      const idx = defArr.findIndex((o) => o.id === action.targetId);
      if (idx < 0 || !stateArr) return;
      const target = defArr[idx];
      const state = stateArr[idx];
      const key = action.targetType + ":" + action.targetId + ":" + action.kind;
      if (action.kind === "move") {
        const prevOff = this._trigOffset(action.targetType, action.targetId);
        const goToX = action.mode === "off" ? target.x : action.toX;
        const goToY = action.mode === "off" ? target.y : action.toY;
        this.triggerAnim[key] = {
          kind: "move",
          baseX: target.x, baseY: target.y,
          fromX: state.x + prevOff.dx, fromY: state.y + prevOff.dy,
          toX: goToX, toY: goToY,
          startT: nowSec, duration: action.duration != null ? action.duration : 1,
        };
      } else {
        const prevColor = triggerAnimColor(this.triggerAnim[key], nowSec) || target.color || "#888888";
        const goToColor = action.mode === "off" ? (target.color || "#888888") : action.toColor;
        this.triggerAnim[key] = {
          kind: "color",
          fromColor: prevColor, toColor: goToColor,
          startT: nowSec, duration: action.duration != null ? action.duration : 1,
        };
      }
    } else if (action.kind === "shake") {
      // 화면 흔들림은 서버가 직접 그릴 수 없으니, 클라이언트에 알려서 각자 화면에서 흔들게 한다
      this.room.broadcastEvent("shake_trigger", {
        strength: action.strength != null ? action.strength : 8,
        duration: action.duration != null ? action.duration : 0.4,
      });
    } else if (action.kind === "camera") {
      // 실제 카메라 이동은 각자의 화면(클라이언트)에서 처리 - 1회성 이벤트로 알려준다
      this.room.broadcastEvent("camera_trigger", {
        toX: action.toX, toY: action.toY,
        duration: action.duration != null ? action.duration : 1,
        holdDuration: action.holdDuration != null ? action.holdDuration : 1,
        returnAfter: action.returnAfter !== false,
      });
    }
  }

  // 그 스텝에 있는 모든 액션을 동시에 발동시키고, 다음 스텝으로 넘어갈 대기 조건을 기록한다
  _runTriggerStep(seq, nowSec) {
    const tr = (this.def.triggers || []).find((t) => t.id === seq.trId);
    const step = tr && tr.steps[seq.stepIndex];
    if (!step) return false; // 더 이상 스텝 없음 - 시퀀스 종료
    step.actions.forEach((action) => this._activateTriggerAction(action, nowSec));
    seq.stepStartT = nowSec;
    seq.waitMode = step.waitMode;
    seq.waitMs = step.waitMs;
    const maxDurationSec = step.actions.reduce((mx, a) => Math.max(mx, a.duration != null ? a.duration : (a.kind === "shake" ? 0.4 : 1)), 0);
    seq.maxDurationMs = maxDurationSec * 1000;
    return true;
  }

  // 트리거 영역이 발동되면(밟히면) 스텝 0부터 시퀀스를 시작한다
  _activateTrigger(tr, nowSec) {
    const seq = { trId: tr.id, stepIndex: 0 };
    if (this._runTriggerStep(seq, nowSec)) this.triggerSequences.push(seq);
  }

  // 매 프레임 진행 중인 시퀀스들의 "대기 조건"을 확인해서 충족되면 다음 스텝으로 넘긴다
  _advanceTriggerSequences(nowSec) {
    this.triggerSequences = this.triggerSequences.filter((seq) => {
      const elapsedMs = (nowSec - seq.stepStartT) * 1000;
      const readyMs = seq.waitMode === "ms" ? seq.waitMs : seq.maxDurationMs;
      if (elapsedMs < readyMs) return true; // 아직 대기 중, 유지
      seq.stepIndex++;
      return this._runTriggerStep(seq, nowSec); // false면(다음 스텝 없음) 필터에서 제거됨
    });
  }

  // 트리거로 인한 이동 오프셋(baseX/Y 대비 dx/dy) - 충돌판정과 getStateJSON에서 공용으로 쓴다
  _trigOffset(type, id) {
    return triggerAnimOffset(this.triggerAnim[type + ":" + id + ":move"], this._playingElapsed);
  }

  _updatePlaying(dt) {
    this.stageTimeLeft -= dt;
    if (this.stageTimeLeft <= 0) {
      this._fail("시간 초과");
      return;
    }
    this._playingElapsed += dt;

    this.def.platforms.forEach((p, i) => stepMovement(p, this.platformState[i], dt, this.platformRiders[p.id]));

    // 발판이 이번 틱에 얼마나 움직였는지(트리거 오프셋 포함) 미리 계산해둔다 -
    // 플레이어 판정 도중에 prevPlatformPos를 갱신해버리면 순서에 따라 결과가 달라지므로,
    // 모든 플레이어 판정이 끝난 뒤에 한꺼번에 갱신한다
    const platformDeltas = {}; // platform id -> {dx, dy}
    const newPlatformRiders = {}; // 이번 틱에 각 발판 위에 있던 플레이어 수(다음 틱의 필요인원 판정에 사용)
    const newPlatformPos = {};
    this.def.platforms.forEach((p, i) => {
      const off = this._trigOffset("platform", p.id);
      const curX = this.platformState[i].x + off.dx, curY = this.platformState[i].y + off.dy;
      const prev = this.prevPlatformPos[p.id];
      platformDeltas[p.id] = prev ? { dx: curX - prev.x, dy: curY - prev.y } : { dx: 0, dy: 0 };
      newPlatformPos[p.id] = { x: curX, y: curY };
    });
    (this.def.walls || []).forEach((w, i) => stepMovement(w, this.wallState[i], dt));
    (this.def.pits || []).forEach((p, i) => stepMovement(p, this.pitState[i], dt));
    (this.def.killbricks || []).forEach((k, i) => stepMovement(k, this.killbrickState[i], dt));
    (this.def.doors || []).forEach((d, i) => stepMovement(d, this.doorState[i], dt));
    (this.def.destructibles || []).forEach((d, i) => stepMovement(d, this.destructibleState[i], dt));

    // 트리거 감지 - 누군가 영역을 "밟는 순간"(들어갈 때 한 번)에만 발동
    (this.def.triggers || []).forEach((tr) => {
      const inside = this.room.getAlivePlayers().some((pl) => pl.x > tr.x && pl.x < tr.x + tr.w && pl.y > tr.y && pl.y < tr.y + tr.h);
      const wasInside = !!this.triggerActive[tr.id];
      if (inside && !wasInside) this._activateTrigger(tr, this._playingElapsed);
      this.triggerActive[tr.id] = inside;
    });
    this._advanceTriggerSequences(this._playingElapsed); // 진행 중인 시퀀스들 대기조건 확인해서 다음 스텝으로

    const players = this.room.getAlivePlayers().filter((pl) => !this.eliminated.has(pl.id));

    // 압력판 판정
    const groups = {};
    this.def.plates.forEach((plate) => {
      groups[plate.group] = groups[plate.group] || [];
    });
    Object.keys(groups).forEach((group) => {
      const groupPlates = this.def.plates.filter((p) => p.group === group);
      let occupied = 0;
      const usedPlayers = new Set();
      groupPlates.forEach((plate) => {
        const off = this._trigOffset("plate", plate.id);
        const px = plate.x + off.dx, py = plate.y + off.dy;
        for (const pl of players) {
          if (usedPlayers.has(pl.id)) continue;
          const dx = pl.x - px;
          const dy = pl.y - py;
          if (Math.sqrt(dx * dx + dy * dy) < plate.r + pl.radius) {
            occupied++;
            usedPlayers.add(pl.id);
            break;
          }
        }
      });
      const needed = this._activePlateCount(group);
      this.plateGroupsOpen[group] = occupied >= needed;
    });

    // 문 개방/재폐쇄 판정 (openDuration > 0 이면 그 시간이 지나면 다시 닫힌다).
    // openDuration으로 닫힌 뒤에는, 조건이 "새로 다시 충족(엣지)"되어야만 재개방한다 - 조건이 계속
    // 참인 상태(예: 열쇠를 이미 다 모은 경우)로 매 틱 재평가하면 열리자마자 또 열려버려서 깜빡이게 된다.
    this.def.doors.forEach((door) => {
      const wasOpen = !!this.doorsOpen[door.id];
      let conditionMet = false;
      if (door.requiresKeyIds != null) {
        conditionMet = door.requiresKeyIds.every((kid) => this.collectedKeyIds.has(kid));
      } else if (door.requiresKeys != null) {
        conditionMet = this.collectedKeys >= door.requiresKeys;
      } else if (door.requiresPlateGroup) {
        conditionMet = !!this.plateGroupsOpen[door.requiresPlateGroup];
      }

      const prevConditionMet = !!this.doorConditionWasMet[door.id];
      const risingEdge = conditionMet && !prevConditionMet;
      this.doorConditionWasMet[door.id] = conditionMet;

      if (!wasOpen && risingEdge) {
        this.doorsOpen[door.id] = true;
        this.doorOpenedAt[door.id] = this._playingElapsed;
        this.room.broadcastEvent("door_open", { doorId: door.id });
      } else if (wasOpen && door.openDuration > 0) {
        const openedAt = this.doorOpenedAt[door.id] || 0;
        if (this._playingElapsed - openedAt >= door.openDuration) {
          this.doorsOpen[door.id] = false;
          this.room.broadcastEvent("door_close", { doorId: door.id });
        }
      }
    });

    players.forEach((pl) => {
      let mx = 0,
        my = 0;
      if (pl.input.up) my -= 1;
      if (pl.input.down) my += 1;
      if (pl.input.left) mx -= 1;
      if (pl.input.right) mx += 1;
      const len = Math.sqrt(mx * mx + my * my) || 1;
      mx /= len;
      my /= len;
      if (mx !== 0 || my !== 0) pl.facing = { x: mx, y: my };
      pl.gameData.lastMoveDir = { x: mx, y: my }; // 무거운 블럭을 미는 방향 판정에 사용

      // 대시 (스테이지별 dashDistance 설정을 대시 지속시간은 고정, 속도만 환산해서 반영)
      if (pl.dashCooldown > 0) pl.dashCooldown -= dt;
      if (pl.dashPressed() && pl.dashCooldown <= 0 && (mx !== 0 || my !== 0)) {
        pl.dashTimer = PHYSICS.DASH_DURATION;
        pl.dashCooldown = PHYSICS.DASH_COOLDOWN;
      }
      const isDashingThisFrame = pl.dashTimer > 0; // 이번 프레임에 실제로 대시 중이었는지 - 감소시키기 전에 미리 기록
      const sizeScale = pl.radius / PHYSICS.PLAYER_RADIUS; // 포털로 커지거나 작아진 만큼 대시 거리·칼 사거리도 비례
      let speed = PHYSICS.MOVE_SPEED * pl.speedMultiplier;
      if (pl.dashTimer > 0) {
        const dashDistance = (this.def.dashDistance != null ? this.def.dashDistance : PHYSICS.DASH_SPEED * PHYSICS.DASH_DURATION) * sizeScale;
        speed = (dashDistance / PHYSICS.DASH_DURATION) * pl.speedMultiplier;
        pl.dashTimer -= dt;
      }

      // SPACE = 칼 휘두르기 (이 스테이지에서 spaceToolEnabled가 켜져 있을 때만)
      if (pl.gameData.swordCooldown > 0) pl.gameData.swordCooldown -= dt;
      if (pl.gameData.swordSwing > 0) pl.gameData.swordSwing -= dt;
      if (this.def.spaceToolEnabled && pl.actionPressed() && pl.gameData.swordCooldown <= 0) {
        pl.gameData.swordSwing = SWORD_SWING_DURATION;
        pl.gameData.swordCooldown = SWORD_COOLDOWN;
        this._trySwordHit(pl);
      }

      let nx = pl.x + mx * speed * dt;
      let ny = pl.y + my * speed * dt;

      const solids = this.def.walls.map((w, i) => ({ rect: { x: this.wallState[i].x, y: this.wallState[i].y, w: w.w, h: w.h }, rotation: w.rotation }));
      this.def.doors.forEach((d, i) => {
        if (!this.doorsOpen[d.id]) {
          const off = this._trigOffset("door", d.id);
          solids.push({ rect: { x: this.doorState[i].x + off.dx, y: this.doorState[i].y + off.dy, w: d.w, h: d.h }, rotation: d.rotation });
        }
      });
      (this.def.destructibles || []).forEach((d, i) => {
        if (!this.brokenDestructibles.has(d.id)) {
          const off = this._trigOffset("destructible", d.id);
          solids.push({ rect: { x: this.destructibleState[i].x + off.dx, y: this.destructibleState[i].y + off.dy, w: d.w, h: d.h }, rotation: d.rotation });
        }
      });
      (this.def.heavyBlocks || []).forEach((b, i) => {
        const st = this.heavyBlockState[i];
        const off = this._trigOffset("heavyBlock", b.id);
        solids.push({ rect: { x: st.x + off.dx, y: st.y + off.dy, w: b.w, h: b.h }, rotation: 0 });
      });
      (this.def.toggleBlocks || []).forEach((b, i) => {
        if (this.toggleBlockState[i].visible) {
          solids.push({ rect: { x: b.x, y: b.y, w: b.w, h: b.h }, rotation: b.rotation || 0 });
        }
      });
      // 한 프레임 이동거리가 (반지름 대비) 크면 벽을 훌쩍 넘어가버릴 수 있다(터널링) -
      // 특히 포털로 작아졌을 때 반지름이 작아진 만큼 훨씬 쉽게 발생하므로, 이동을 여러 개의
      // 작은 조각(서브스텝)으로 나눠서 매 조각마다 충돌 판정을 한다
      const totalDx = nx - pl.x, totalDy = ny - pl.y;
      const moveDist = Math.hypot(totalDx, totalDy);
      const maxStepDist = Math.max(2, pl.radius * 0.5);
      const steps = Math.min(20, Math.max(1, Math.ceil(moveDist / maxStepDist)));
      nx = pl.x; ny = pl.y;
      for (let s = 0; s < steps; s++) {
        nx += totalDx / steps;
        ny += totalDy / steps;
        solids.forEach(({ rect, rotation }) => {
          if (circleRectCollideRotated(nx, ny, pl.radius, rect, rotation)) {
            const resolved = resolveCircleRectRotated(nx, ny, pl.radius, rect, rotation);
            nx = resolved.x;
            ny = resolved.y;
          }
        });
      }

      pl.x = nx;
      pl.y = ny;

      // 포털: 포털 영역 안에 있는 동안, 중심선 기준으로 왼쪽→오른쪽으로 넘어가면 커지거나(또는 빨라지고)
      // 오른쪽→왼쪽으로 넘어가면 작아진다(또는 느려진다) - kind로 종류 결정, 양방향/누적
      (this.def.portals || []).forEach((po, poIdx) => {
        const key = pl.id + ":" + po.id;
        const st = this.portalState[poIdx];
        const off = this._trigOffset("portal", po.id);
        const rect = { x: st.x + off.dx, y: st.y + off.dy, w: po.w, h: po.h };
        const overlapping = circleRectCollide(pl.x, pl.y, pl.radius, rect);
        if (!overlapping) { delete this.portalSide[key]; return; }
        const centerX = rect.x + po.w / 2;
        const side = pl.x < centerX ? "left" : "right";
        const prevSide = this.portalSide[key];
        const factor = po.factor != null ? po.factor : 1.3;
        if (prevSide && prevSide !== side) {
          const grow = prevSide === "left" && side === "right";
          const shrink = prevSide === "right" && side === "left";
          if (po.kind === "speed") {
            if (grow) pl.speedMultiplier = Math.min(PORTAL_MAX_SPEED_MULT, pl.speedMultiplier * factor);
            else if (shrink) pl.speedMultiplier = Math.max(PORTAL_MIN_SCALE, pl.speedMultiplier / factor);
          } else {
            if (grow) pl.radius = Math.min(PORTAL_MAX_RADIUS, pl.radius * factor);
            else if (shrink) pl.radius = Math.max(PHYSICS.PLAYER_RADIUS * PORTAL_MIN_SCALE, pl.radius / factor);
          }
        }
        this.portalSide[key] = side;
      });

      let onPlatform = false;
      this.def.platforms.forEach((p, idx) => {
        const st = this.platformState[idx];
        const off = this._trigOffset("platform", p.id);
        const rect = { x: st.x + off.dx, y: st.y + off.dy, w: p.w, h: p.h };
        if (circleRectCollide(pl.x, pl.y, pl.radius * 1.15, rect)) {
          onPlatform = true;
          newPlatformRiders[p.id] = (newPlatformRiders[p.id] || 0) + 1;
          // 발판이 이번 틱에 움직인 만큼, 그 위에 있는 플레이어도 같이 실어 나른다
          const d = platformDeltas[p.id];
          pl.x += d.dx;
          pl.y += d.dy;
        }
      });

      // 물웅덩이 낙사 판정 - 발판 위이거나 대시로 뛰어넘는 중일 때는 완전히 안전, 그 외엔 짧은 유예시간(코요테 타임) 적용
      const inPit = this.def.pits.some((pit, i) => {
        const st = this.pitState[i];
        return pl.x > st.x && pl.x < st.x + pit.w && pl.y > st.y && pl.y < st.y + pit.h;
      });
      if (onPlatform || isDashingThisFrame || !inPit) {
        pl.gameData.pitGrace = 0;
      } else {
        pl.gameData.pitGrace = (pl.gameData.pitGrace || 0) + dt;
        if (pl.gameData.pitGrace > PIT_GRACE_SECONDS) {
          this.eliminated.add(pl.id);
          pl.status = "eliminated";
        }
      }

      // 킬브릭: 유예시간 없이 닿는 즉시 탈락
      (this.def.killbricks || []).forEach((k, i) => {
        if (this.eliminated.has(pl.id)) return;
        const st = this.killbrickState[i];
        const off = this._trigOffset("killbrick", k.id);
        const rect = { x: st.x + off.dx, y: st.y + off.dy, w: k.w, h: k.h };
        if (circleRectCollideRotated(pl.x, pl.y, pl.radius * 0.7, rect, k.rotation)) {
          this.eliminated.add(pl.id);
          pl.status = "eliminated";
        }
      });

      // 열쇠 획득: 가까이 가면 E(interact)로 줍는다 (자동 획득 아님)
      pl.gameData.nearKeyId = null;
      let nearestDist = Infinity;
      this.keys.forEach((k) => {
        if (k.collected) return;
        const off = this._trigOffset("key", k.id);
        const dx = pl.x - (k.x + off.dx);
        const dy = pl.y - (k.y + off.dy);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < k.r + pl.radius + 12 && d < nearestDist) {
          nearestDist = d;
          pl.gameData.nearKeyId = k.id;
        }
      });
      if (pl.interactPressed() && pl.gameData.nearKeyId) {
        const k = this.keys.find((kk) => kk.id === pl.gameData.nearKeyId && !kk.collected);
        if (k) this._collectKey(pl, k);
      }

      // 스위치: 가까이 가서 E를 누르면 연결된 블럭의 보임/안보임이 반전된다
      pl.gameData.nearSwitchId = null;
      let nearestSwitchDist = Infinity;
      (this.def.switches || []).forEach((sw) => {
        const dx = pl.x - sw.x, dy = pl.y - sw.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < sw.r + pl.radius + 12 && d < nearestSwitchDist) {
          nearestSwitchDist = d;
          pl.gameData.nearSwitchId = sw.id;
        }
      });
      if (pl.interactPressed() && pl.gameData.nearSwitchId) {
        const sw = (this.def.switches || []).find((s) => s.id === pl.gameData.nearSwitchId);
        if (sw && sw.targetId) {
          const idx = (this.def.toggleBlocks || []).findIndex((b) => b.id === sw.targetId);
          if (idx >= 0) this.toggleBlockState[idx].visible = !this.toggleBlockState[idx].visible;
        }
      }

      // 텔레포터: 짝지어진 곳으로 순간이동 - "밟는 순간"(들어갈 때 한 번)에만 발동해서,
      // 가만히 서있으면 계속 왔다갔다 튕기지 않고 벗어났다 다시 들어와야 재발동한다
      pl.gameData.teleporterInside = pl.gameData.teleporterInside || {};
      (this.def.teleporters || []).forEach((tp) => {
        if (!tp.linkedId) return;
        const off = this._trigOffset("teleporter", tp.id);
        const dx = pl.x - (tp.x + off.dx), dy = pl.y - (tp.y + off.dy);
        const inside = Math.sqrt(dx * dx + dy * dy) < tp.r + pl.radius;
        const wasInside = !!pl.gameData.teleporterInside[tp.id];
        if (inside && !wasInside) {
          const target = (this.def.teleporters || []).find((o) => o.id === tp.linkedId);
          if (target) {
            const targetOff = this._trigOffset("teleporter", target.id);
            pl.x = target.x + targetOff.dx;
            pl.y = target.y + targetOff.dy;
            pl.gameData.teleporterInside[target.id] = true; // 도착지에 막 도착했으니 즉시 재발동하지 않게
            this.room.broadcastEvent("teleported", { playerId: pl.id, toId: target.id });
          }
        }
        pl.gameData.teleporterInside[tp.id] = inside;
      });
    });

    players.forEach((pl) => pl.commitInputFrame());
    this.prevPlatformPos = newPlatformPos; // 다음 틱 계산을 위해 이번 틱의 발판 위치를 저장
    this.platformRiders = newPlatformRiders; // 다음 틱의 필요인원 판정을 위해 이번 틱의 탑승 인원을 저장

    // 플레이어끼리 서로 겹치지 않도록 밀어낸다 (원-원 충돌 해소, 겹친 만큼을 절반씩 나눠서 밀어냄)
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i], b = players[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.radius + b.radius;
        if (dist > 0 && dist < minDist) {
          const overlap = minDist - dist;
          const nx = dx / dist, ny = dy / dist;
          a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
        } else if (dist === 0) {
          // 완전히 같은 지점(순간이동 등)에 겹쳤으면 임의 방향으로 살짝 떼어놓는다
          a.x -= minDist * 0.5; b.x += minDist * 0.5;
        }
      }
    }

    // 무거운 블럭: 필요 인원 이상이 같은 방향으로 붙어서 밀고 있으면 그 방향으로 이동한다
    const HEAVY_BLOCK_SPEED = 70; // px/s - 플레이어 이동속도보다 느리게, 힘겹게 미는 느낌
    (this.def.heavyBlocks || []).forEach((hb, i) => {
      const st = this.heavyBlockState[i];
      const trigOff = this._trigOffset("heavyBlock", hb.id);
      const rect = { x: st.x + trigOff.dx, y: st.y + trigOff.dy, w: hb.w, h: hb.h };
      const centerX = rect.x + rect.w / 2, centerY = rect.y + rect.h / 2;
      const padded = { x: rect.x - 12, y: rect.y - 12, w: rect.w + 24, h: rect.h + 24 };
      let sumX = 0, sumY = 0, pusherCount = 0;
      players.forEach((pl) => {
        const dir = pl.gameData.lastMoveDir;
        if (!dir || (dir.x === 0 && dir.y === 0)) return;
        if (!circleRectCollide(pl.x, pl.y, pl.radius, padded)) return;
        const toBlockX = centerX - pl.x, toBlockY = centerY - pl.y;
        const toBlockLen = Math.hypot(toBlockX, toBlockY) || 1;
        const dot = (dir.x * toBlockX + dir.y * toBlockY) / toBlockLen;
        if (dot > 0.5) { sumX += dir.x; sumY += dir.y; pusherCount++; }
      });
      const required = hb.requiredPlayers != null ? hb.requiredPlayers : 2;
      if (pusherCount < required) return;
      // 미는 방향은 4방향(상하좌우) 중 하나로 스냅해서 예측 가능하게 움직인다
      const dirX = Math.abs(sumX) >= Math.abs(sumY) ? Math.sign(sumX) : 0;
      const dirY = dirX === 0 ? Math.sign(sumY) : 0;
      if (dirX === 0 && dirY === 0) return;
      const newX = st.x + dirX * HEAVY_BLOCK_SPEED * dt;
      const newY = st.y + dirY * HEAVY_BLOCK_SPEED * dt;
      const newRect = { x: newX, y: newY, w: hb.w, h: hb.h };
      const blockedByWall = this.def.walls.some((w, wi) => {
        const wr = { x: this.wallState[wi].x, y: this.wallState[wi].y, w: w.w, h: w.h };
        return newRect.x < wr.x + wr.w && newRect.x + newRect.w > wr.x && newRect.y < wr.y + wr.h && newRect.y + newRect.h > wr.y;
      });
      const inBounds = newRect.x >= 0 && newRect.y >= 0 && newRect.x + newRect.w <= this.def.bounds.width && newRect.y + newRect.h <= this.def.bounds.height;
      if (!blockedByWall && inBounds) { st.x = newX; st.y = newY; }
    });

    if (this.eliminated.size > 0) {
      this._fail("동료가 탈락했습니다");
      return;
    }

    const alivePlayers = players.filter((pl) => !this.eliminated.has(pl.id));
    if (alivePlayers.length > 0) {
      const allIn = alivePlayers.every((pl) => {
        const g = this.def.goal;
        return pl.x > g.x && pl.x < g.x + g.w && pl.y > g.y && pl.y < g.y + g.h;
      });
      if (allIn) this._clear();
    }
  }

  // 열쇠 획득 처리 공용 헬퍼 - E키로 줍든, 칼로 베어서 줍든 결과는 같다
  _collectKey(pl, k) {
    k.collected = true;
    k.carriedBy = pl.id;
    this.collectedKeys++;
    this.collectedKeyIds.add(k.id);
    pl.gameData.carriedKeyIds = pl.gameData.carriedKeyIds || [];
    pl.gameData.carriedKeyIds.push(k.id);
    pl.gameData.nearKeyId = null;
    this.room.broadcastEvent("key_collected", { keyId: k.id, by: pl.id });
  }

  // 칼 휘두르기 판정: 플레이어가 바라보는 방향 앞쪽의 파괴 가능 블럭 + 열쇠를 확인한다
  _trySwordHit(pl) {
    const sizeScale = pl.radius / PHYSICS.PLAYER_RADIUS;
    const swordRange = (this.def.swordRange != null ? this.def.swordRange : SWORD_RANGE) * sizeScale;
    const hitX = pl.x + pl.facing.x * (pl.radius + swordRange / 2);
    const hitY = pl.y + pl.facing.y * (pl.radius + swordRange / 2);
    // 열쇠는 원형+단일 판정점이라, 대상이 플레이어에게 너무 가까우면 칼끝(고정 거리점)이
    // 오히려 그 지점을 훌쩍 지나쳐 못 맞추는 문제가 있다 - 그래서 "정면 부채꼴 + 도달거리 이내"로 판정한다
    const maxReach = pl.radius + swordRange;
    const facingAngle = Math.atan2(pl.facing.y, pl.facing.x);
    this.keys.forEach((k) => {
      if (k.collected) return;
      const off = this._trigOffset("key", k.id);
      const kx = k.x + off.dx, ky = k.y + off.dy;
      const dx = kx - pl.x, dy = ky - pl.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxReach + k.r) return;
      let diff = Math.abs(Math.atan2(dy, dx) - facingAngle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff > Math.PI / 2) return; // 정면 기준 좌우 90도(총 180도 부채꼴) 안에서만 인정
      this._collectKey(pl, k);
    });
    (this.def.destructibles || []).forEach((d, i) => {
      if (this.brokenDestructibles.has(d.id)) return;
      const st = this.destructibleState[i];
      const off = this._trigOffset("destructible", d.id);
      const rect = { x: st.x + off.dx, y: st.y + off.dy, w: d.w, h: d.h };
      if (!circleRectCollideRotated(hitX, hitY, swordRange / 2, rect, d.rotation)) return;
      this.destructibleHits[d.id] = (this.destructibleHits[d.id] || 0) + 1;
      const need = d.hitsToBreak != null ? d.hitsToBreak : 1;
      if (this.destructibleHits[d.id] >= need) {
        this.brokenDestructibles.add(d.id);
        this.room.broadcastEvent("block_broken", { blockId: d.id, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
      } else {
        this.room.broadcastEvent("block_hit", { blockId: d.id, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
      }
    });
  }

  _fail(reason) {
    this.state = COOP_STATE.FAILED;
    this.timer = 0;
    this.failReason = reason;
    this.room.broadcastEvent("stage_failed", { reason });
  }

  _clear() {
    this.state = COOP_STATE.CLEAR;
    this.timer = 0;
    this.room.broadcastEvent("stage_clear", { stageId: this.def.id });
  }

  retry() {
    this._loadStage();
  }

  nextStage() {
    if (this.stageIndex < STAGES.length - 1) {
      this.stageIndex++;
      this._loadStage();
      return true;
    }
    return false;
  }

  isAllStagesCleared() {
    return this.stageIndex >= STAGES.length - 1 && this.state === COOP_STATE.CLEAR;
  }

  getStateJSON() {
    const nowSec = this._playingElapsed;
    const trigColorOf = (type, id, fallback) => {
      const c = triggerAnimColor(this.triggerAnim[type + ":" + id + ":color"], nowSec);
      return c || fallback;
    };
    const trigOffsetOf = (type, id) => triggerAnimOffset(this.triggerAnim[type + ":" + id + ":move"], nowSec);
    return {
      mode: "coop",
      state: this.state,
      stageIndex: this.stageIndex,
      totalStages: STAGES.length,
      stageName: this.def.name,
      timeLeft: Math.max(0, Math.ceil(this.stageTimeLeft)),
      countdown: this.state === COOP_STATE.COUNTDOWN ? Math.max(0, Math.ceil(COUNTDOWN_SECONDS - this.timer)) : null,
      failReason: this.failReason || null,
      bounds: this.def.bounds,
      sharedCamera: this.def.sharedCamera !== false,
      singleSpawn: !!(this.def.spawns && this.def.spawns.length === 1),
      cameraDistance: this.def.cameraDistance != null ? this.def.cameraDistance : 500,
      darkness: !!this.def.darkness,
      visionRadius: this.def.visionRadius != null ? this.def.visionRadius : 260,
      visionAngle: this.def.visionAngle != null ? this.def.visionAngle : 80,
      darknessIntensity: this.def.darknessIntensity != null ? this.def.darknessIntensity : 45,
      freeView: !!this.def.freeView,
      walls: this.def.walls.map((w, i) => ({ w: w.w, h: w.h, rotation: w.rotation || 0, color: w.color, x: this.wallState[i].x, y: this.wallState[i].y })),
      keys: this.keys.map((k, i) => {
        const off = trigOffsetOf("key", k.id);
        const bx = this.keyState[i] ? this.keyState[i].x : k.x, by = this.keyState[i] ? this.keyState[i].y : k.y;
        return { ...k, x: bx + off.dx, y: by + off.dy, color: trigColorOf("key", k.id, k.color) };
      }),
      teleporters: (this.def.teleporters || []).map((tp, i) => {
        const off = trigOffsetOf("teleporter", tp.id);
        const bx = this.teleporterState[i] ? this.teleporterState[i].x : tp.x, by = this.teleporterState[i] ? this.teleporterState[i].y : tp.y;
        return { ...tp, x: bx + off.dx, y: by + off.dy, color: trigColorOf("teleporter", tp.id, tp.color) };
      }),
      doors: this.def.doors.map((d, i) => {
        const off = trigOffsetOf("door", d.id);
        return {
          ...d,
          open: !!this.doorsOpen[d.id],
          x: this.doorState[i].x + off.dx,
          y: this.doorState[i].y + off.dy,
          color: trigColorOf("door", d.id, d.color),
          openRemaining:
            this.doorsOpen[d.id] && d.openDuration > 0
              ? Math.max(0, d.openDuration - (this._playingElapsed - (this.doorOpenedAt[d.id] || 0)))
              : null,
        };
      }),
      plates: this.def.plates.map((p, i) => {
        const off = trigOffsetOf("plate", p.id);
        const bx = this.plateState[i] ? this.plateState[i].x : p.x, by = this.plateState[i] ? this.plateState[i].y : p.y;
        return { ...p, active: !!this.plateGroupsOpen[p.group], x: bx + off.dx, y: by + off.dy, color: trigColorOf("plate", p.id, p.color) };
      }),
      platforms: this.def.platforms.map((p, i) => {
        const off = trigOffsetOf("platform", p.id);
        return {
          id: p.id,
          w: p.w,
          h: p.h,
          rotation: p.rotation || 0,
          color: trigColorOf("platform", p.id, p.color),
          x: this.platformState[i].x + off.dx,
          y: this.platformState[i].y + off.dy,
        };
      }),
      pits: (this.def.pits || []).map((p, i) => ({ w: p.w, h: p.h, rotation: p.rotation || 0, color: p.color, x: this.pitState[i].x, y: this.pitState[i].y })),
      killbricks: (this.def.killbricks || []).map((k, i) => {
        const off = trigOffsetOf("killbrick", k.id);
        return {
          id: k.id,
          w: k.w,
          h: k.h,
          rotation: k.rotation || 0,
          color: trigColorOf("killbrick", k.id, k.color),
          x: this.killbrickState[i].x + off.dx,
          y: this.killbrickState[i].y + off.dy,
        };
      }),
      destructibles: (this.def.destructibles || [])
        .map((d, i) => {
          const off = trigOffsetOf("destructible", d.id);
          return {
            id: d.id,
            w: d.w,
            h: d.h,
            rotation: d.rotation || 0,
            color: trigColorOf("destructible", d.id, d.color),
            x: this.destructibleState[i].x + off.dx,
            y: this.destructibleState[i].y + off.dy,
            broken: this.brokenDestructibles.has(d.id),
          };
        })
        .filter((d) => !d.broken),
      goal: this.def.goal,
      portals: (this.def.portals || []).map((po, i) => {
        const off = this._trigOffset("portal", po.id);
        return { ...po, x: this.portalState[i].x + off.dx, y: this.portalState[i].y + off.dy };
      }),
      heavyBlocks: (this.def.heavyBlocks || []).map((hb, i) => {
        const off = this._trigOffset("heavyBlock", hb.id);
        return {
          id: hb.id, w: hb.w, h: hb.h,
          requiredPlayers: hb.requiredPlayers != null ? hb.requiredPlayers : 2,
          color: trigColorOf("heavyBlock", hb.id, hb.color),
          x: this.heavyBlockState[i].x + off.dx,
          y: this.heavyBlockState[i].y + off.dy,
        };
      }),
      switches: (this.def.switches || []).map((sw) => ({ id: sw.id, x: sw.x, y: sw.y, r: sw.r, color: sw.color })),
      toggleBlocks: (this.def.toggleBlocks || []).map((b, i) => ({
        id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, rotation: b.rotation || 0, color: b.color,
        visible: this.toggleBlockState[i].visible,
      })),
      collectedKeys: this.collectedKeys,
      collectedKeyIds: Array.from(this.collectedKeyIds),
      totalKeys: this.keys.length,
      eliminated: Array.from(this.eliminated),
      isLastStage: this.stageIndex >= STAGES.length - 1,
    };
  }
}

module.exports = CoopEngine;
