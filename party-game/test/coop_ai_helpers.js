// test/coop_ai_helpers.js
// 여러 협동 스테이지 자동 플레이 테스트에서 공통으로 쓰는 AI 동작 함수들.

function setInput(pl, tx, ty) {
  const dx = tx - pl.x;
  const dy = ty - pl.y;
  pl.input.up = dy < -6;
  pl.input.down = dy > 6;
  pl.input.left = dx < -6;
  pl.input.right = dx > 6;
  pl.input.action = false;
  pl.input.interact = false;
  pl.input.dash = false;
}

function stop(pl) {
  pl.input.up = pl.input.down = pl.input.left = pl.input.right = false;
}

// 발판을 타고 구멍을 건넌다. waitX가 주어지면 "그 지점에 실제로 도달하기 전까지는"
// 무조건 그 안전지대를 향해서만 이동한다 (발판이 마침 가까워 보인다고 조기에 쫓아가면,
// 발판도 나를 향해 같이 다가오는 중이라 실제로는 아직 안전지대에 못 미친 채로 구멍 쪽으로
// 끌려들어갈 수 있다). 안전지대에 도달한 뒤에야 비로소 발판에 올라타는 시도를 한다.
// 발판 위에 실제로 올라탔으면 exitX 쪽으로 전진하고, 아니면 발판 중심을 쫓아간다.
function crossPlatform(pl, platformState, exitX, waitX) {
  if (pl.x >= exitX) return true;
  const margin = 25; // 서버의 라이딩(동승) 판정 여유와 비슷하게 맞춘 값
  const left = platformState.x - margin;
  const right = platformState.x + platformState.w + margin;
  const onPlatform = pl.x > left && pl.x < right && Math.abs(pl.y - (platformState.y + platformState.h / 2)) < platformState.h;
  const cy = platformState.y + platformState.h / 2;
  const platCenterX = platformState.x + platformState.w / 2;

  if (onPlatform) {
    // 발판 범위 안에서 최대한 exitX 쪽으로 전진한다 (중심만 쫓으면 발판이 도달하는
    // 최대 위치보다 더 못 나갈 수 있다)
    const advanceX = Math.min(exitX, platformState.x + platformState.w - 30);
    setInput(pl, advanceX, cy);
    return false;
  }
  if (waitX != null && pl.x < waitX) {
    setInput(pl, waitX, cy); // 아직 안전지대에도 못 미쳤으니 무조건 그쪽으로 먼저 간다
    return false;
  }
  // 안전지대 이후: 발판이 진짜로 가까이 왔을 때만 올라타러 가고, 아니면 안전지대에서 계속 대기
  if (Math.abs(platCenterX - pl.x) < 150) {
    setInput(pl, platCenterX, cy);
  } else if (waitX != null) {
    setInput(pl, waitX, cy);
  } else {
    stop(pl);
  }
  return false;
}

// group 내 압력판들에 플레이어들을 한 명씩 배정해서 동시에 밟게 한다.
// active 가 true 가 되면(서버 응답) true 를 반환.
function pressPlateGroup(players, plates, groupId, active) {
  const groupPlates = plates.filter((p) => p.group === groupId);
  players.forEach((pl, i) => {
    const plate = groupPlates[i % groupPlates.length];
    if (plate) setInput(pl, plate.x, plate.y);
  });
  return !!active;
}

module.exports = { setInput, stop, crossPlatform, pressPlateGroup };
