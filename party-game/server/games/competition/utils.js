// server/games/competition/utils.js
const { PHYSICS } = require("../../../shared/constants");

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 벽이 없는 열린 공간에서의 자유 이동 (World bounds 안으로 클램프)
function freeMove(pl, dt, bounds, speedOverride) {
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
  const speed = speedOverride || PHYSICS.MOVE_SPEED;
  pl.x += mx * speed * dt;
  pl.y += my * speed * dt;
  if (bounds) {
    pl.x = Math.max(bounds.x + pl.radius, Math.min(bounds.x + bounds.w - pl.radius, pl.x));
    pl.y = Math.max(bounds.y + pl.radius, Math.min(bounds.y + bounds.h - pl.radius, pl.y));
  }
}

// 순위 없는 점수 맵을 순위 배열(playerId 내림차순)로 변환
function rankFromScores(scoreMap, playerIds) {
  return [...playerIds].sort((a, b) => (scoreMap[b] || 0) - (scoreMap[a] || 0));
}

module.exports = { dist, rand, randInt, pick, freeMove, rankFromScores };
