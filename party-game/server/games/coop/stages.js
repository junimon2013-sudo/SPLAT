// server/games/coop/stages.js
// 협동 모드 스테이지 데이터. 기존 스테이지는 전부 삭제된 상태입니다 - SPLAT! 레벨 에디터로
// 새로 만든 스테이지를 이 배열에 붙여넣어 추가하세요.
//
// 스테이지 스키마 (레벨 에디터가 내보내는 형식과 동일):
// {
//   id, name, timeLimit,
//   playerCount,      // 0=전체(2~4), 또는 2/3/4 고정
//   spaceToolEnabled,  // SPACE = 칼 휘두르기 사용 여부
//   sharedCamera,      // true=전원 공유 카메라, false=각자 독립 카메라
//   dashDistance,      // SHIFT 대시 이동거리(px)
//   bounds: { width, height },
//   spawns: [{ x, y, count }],  // 부족한 인원은 무작위로 흩뿌려짐
//   walls: [{ x, y, w, h, rotation?, movement? }],
//   keys: [{ id, x, y, r, movement? }],
//   doors: [{ id, x, y, w, h, requiresKeys|requiresPlateGroup, openDuration, rotation?, movement? }],
//   plates: [{ id, x, y, r, group, movement? }],
//   platforms: [{ id, x, y, w, h, rotation?, movement }],
//   pits: [{ x, y, w, h, rotation?, movement? }],       // 물웅덩이
//   killbricks: [{ id, x, y, w, h, rotation?, movement? }],       // 닿으면 즉시 탈락
//   destructibles: [{ id, x, y, w, h, hitsToBreak, rotation?, movement? }], // 칼로 부술 수 있는 블럭
//   goal: { x, y, w, h },
// }
// movement: { type:"linear", axis:"x"|"y", from, to, speed } 또는 { type:"rotate", centerX, centerY, radius, speed, clockwise }

const STAGES = [];

module.exports = { STAGES };
