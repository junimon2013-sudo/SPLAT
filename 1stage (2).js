// SPLAT! 커스텀 스테이지 - "hardcor" (stage1)
// 이 파일을 1stage.js, 2stage.js, 3stage.js... 순서대로(1부터 시작, 빈 번호 없이) 이름 붙여서
// index.html과 같은 폴더에 올리세요. index.html은 다시 안 건드려도 자동으로 인식됩니다.
(function () {
  window.SPLAT_CUSTOM_STAGES = window.SPLAT_CUSTOM_STAGES || [];
  window.SPLAT_CUSTOM_STAGES.push({
  id: "stage1",
  name: "hardcor",
  timeLimit: 90,
  playerCount: 0, // 0=전체(2~4), 또는 2/3/4 고정
  spaceToolEnabled: true, // SPACE=도구 사용 ON/OFF (엔진 별도 지원 필요)
  sharedCamera: true, // true=전원 공유 카메라, false=각자 독립 카메라
  dashDistance: 86, // SHIFT 대시 이동거리(px)
  swordRange: 46, // SPACE 칼질이 닿는 거리(px)
  cameraDistance: 500, // 독립 카메라일 때 화면 범위(px)
  freeView: false, // 독립 카메라일 때 각자 카메라 직접 조작 가능 여부
  darkness: true, // 암전 모드 (개인별 부채꼴 시야)
  visionRadius: 260, // 시야 반지름(px)
  visionAngle: 80, // 시야 각도(도)
  darknessIntensity: 75, // 시야 밖 어두운 정도 - 15(약)/45(중)/75(강)
  bounds: { width: 3960, height: 1060 },
  spawns: [
    { x: 50, y: 40, count: 4 },
  ], // 부족한 인원은 무작위로 흩뿌려짐
  walls: [
    { x: 450, y: 340, w: 160, h: 720 },
    { x: 3250, y: -10, w: 310, h: 1070 },
    { x: 750, y: 0, w: 120, h: 440 },
    { x: 610, y: 340, w: 140, h: 100 },
  ],
  keys: [
    { id: "k1", x: 550, y: 250, r: 16 },
    { id: "k2", x: 3860, y: 730, r: 16, movement: { type: "waypoints", loopMode: "pingpong", waypoints: [{ x: 3930, y: 650, speed: 400 }, { x: 3930, y: 740, speed: 400 }] } },
  ],
  doors: [
    { id: "d2", x: 0, y: 350, w: 450, h: 100, requiresKeys: 1, openDuration: 0 },
    { id: "d3", x: 0, y: 450, w: 450, h: 100, requiresPlateGroup: "g1", openDuration: 0 },
    { id: "d4", x: 500, y: 200, w: 20, h: 140, requiresKeyIds: ["k1"], openDuration: 0 },
    { id: "d5", x: 3560, y: 690, w: 290, h: 60, requiresKeyIds: ["k2"], openDuration: 0 },
  ],
  plates: [
    { id: "pl1", x: 690, y: 220, r: 26, group: "g1" },
  ],
  teleporters: [ // 항상 2개가 한 쌍(linkedId로 서로 연결)
    { id: "tp1", x: 0, y: 1060, r: 24, linkedId: "tp2" },
    { id: "tp2", x: 3900, y: 500, r: 24, linkedId: "tp1" },
  ],
  platforms: [
  ],
  pits: [ // 물웅덩이 (텍스처: water)
    { x: 300, y: 0, w: 200, h: 200 },
    { x: 0, y: 600, w: 450, h: 10 },
    { x: 0, y: 700, w: 450, h: 10 },
    { x: 600, y: 50, w: 50, h: 290 },
    { x: 500, y: 0, w: 250, h: 50 },
  ],
  killbricks: [ // 닿으면 즉시 탈락
    { id: "kb7", x: 0, y: 100, w: 50, h: 50, movement: { type: "linear", axis: "x", from: 0, to: 250, speed: 200 } },
    { id: "kb9", x: 3660, y: 550, w: 50, h: 50, movement: { type: "waypoints", loopMode: "pingpong", waypoints: [{ x: 3660, y: 600, speed: 200 }, { x: 3660, y: 550, speed: 200 }, { x: 3910, y: 550, speed: 200 }, { x: 3660, y: 600, speed: 40 }] } },
    { id: "kb10", x: 3670, y: 600, w: 30, h: 30, movement: { type: "waypoints", loopMode: "pingpong", waypoints: [{ x: 3670, y: 650, speed: 200 }, { x: 3670, y: 600, speed: 200 }, { x: 3920, y: 600, speed: 200 }, { x: 3670, y: 650, speed: 40 }] } },
    { id: "kb11", x: 500, y: 50, w: 100, h: 100, color: "#fff70a" },
    { id: "kb13", x: 3550, y: 550, w: 240, h: 50 },
    { id: "kb14", x: 3700, y: 650, w: 200, h: 40 },
    { id: "kb16", x: 3900, y: 690, w: 60, h: 60 },
    { id: "kb17", x: 3850, y: 690, w: 50, h: 50 },
  ],
  destructibles: [ // SPACE 칼질로 부술 수 있는 블럭 (부서지면 파티클 효과)
    { id: "db1", x: 0, y: 110, w: 300, h: 10, hitsToBreak: 10 },
    { id: "db2", x: 0, y: 120, w: 300, h: 10, hitsToBreak: 10 },
    { id: "db3", x: 0, y: 130, w: 300, h: 10, hitsToBreak: 10 },
    { id: "db4", x: 0, y: 140, w: 300, h: 10, hitsToBreak: 10 },
    { id: "db5", x: 0, y: 150, w: 300, h: 10, hitsToBreak: 10 },
    { id: "db6", x: 0, y: 100, w: 300, h: 10, hitsToBreak: 10 },
    { id: "db7", x: 0, y: 160, w: 300, h: 10, hitsToBreak: 10 },
    { id: "db8", x: 500, y: 150, w: 50, h: 50, hitsToBreak: 1 },
    { id: "db9", x: 3900, y: 650, w: 60, h: 50, hitsToBreak: 1 },
  ],
  goal: { x: 3900, y: 900, w: 60, h: 160 },
  });
})();
