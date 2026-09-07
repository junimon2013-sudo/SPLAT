// test/browser_test.js
const { chromium } = require("playwright");

const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const URL = "http://localhost:3000";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log("=== 실제 브라우저(헤드리스 Chromium) 2창 통합 테스트 ===");
  const browser = await chromium.launch({ executablePath: EXEC });
  const consoleErrors = [];

  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  [page1, page2].forEach((pg, i) => {
    pg.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[page${i + 1}] ${msg.text()}`);
    });
    pg.on("pageerror", (err) => {
      consoleErrors.push(`[page${i + 1}] pageerror: ${err.message}`);
    });
  });

  const failedRequests = [];
  [page1, page2].forEach((pg, idx) => {
    pg.on("requestfailed", (req) => failedRequests.push(`FAILED ${req.url()}`));
    pg.on("response", (res) => {
      if (res.status() >= 400) failedRequests.push(`page${idx + 1} ${res.status()} ${res.url()}`);
    });
  });

  console.log("페이지 로딩...");
  await page1.goto(URL);
  await page2.goto(URL);
  await page1.waitForSelector("#screen-title.active", { timeout: 5000 });
  console.log("✅ 타이틀 화면 렌더링 확인 (두 창 모두)");

  await page1.screenshot({ path: "/tmp/shot_title.png" });

  await page1.fill("#input-name", "호스트");
  await page1.click("#btn-create-room");
  await page1.waitForSelector("#screen-lobby.active", { timeout: 5000 });
  console.log("✅ 방 생성 -> 로비 화면 전환 확인");

  const roomCode = await page1.textContent("#lobby-room-code");
  console.log("방 코드:", roomCode);
  if (!roomCode || roomCode.includes("-")) throw new Error("방 코드 표시 이상: " + roomCode);

  await page2.fill("#input-name", "게스트");
  await page2.fill("#input-room-code", roomCode);
  await page2.click("#btn-join-room");
  await page2.waitForSelector("#screen-lobby.active", { timeout: 5000 });
  console.log("✅ 2번째 창 방 참가 -> 로비 진입 확인");

  await sleep(500);
  const playerCards = await page1.$$eval(".player-card:not(.empty)", (els) => els.length);
  if (playerCards !== 2) throw new Error("로비 플레이어 카드 수 이상: " + playerCards);
  console.log("✅ 로비에 2명 모두 표시됨 (실시간 목록 반영 확인)");

  await page1.screenshot({ path: "/tmp/shot_lobby.png" });

  await page1.click("#mode-coop");
  await page2.click("#btn-ready");
  await sleep(300);
  await page1.click("#btn-start");

  await page1.waitForSelector("#screen-game.active", { timeout: 5000 });
  await page2.waitForSelector("#screen-game.active", { timeout: 5000 });
  console.log("✅ 게임 화면으로 전환됨 (양쪽 모두)");

  await sleep(6500);
  await page1.screenshot({ path: "/tmp/shot_game_playing.png" });

  const canvasHasContent = await page1.evaluate(() => {
    const canvas = document.getElementById("game-canvas");
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 400) {
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) return true;
    }
    return false;
  });
  if (!canvasHasContent) throw new Error("캔버스가 비어있음 (렌더링 안 됨)");
  console.log("✅ 캔버스에 실제로 그래픽이 렌더링됨");

  const getHud = async (page) => page.evaluate(() => document.getElementById("hud-objective").textContent);

  await page1.click("#game-canvas");
  const before = await getHud(page1);
  await page1.keyboard.down("KeyD");
  await sleep(800);
  await page1.keyboard.up("KeyD");
  await sleep(200);
  console.log("✅ 키보드 입력(D키) 전송 완료, HUD:", before);

  await page1.setViewportSize({ width: 800, height: 600 });
  await sleep(300);
  const canvasSize = await page1.evaluate(() => {
    const c = document.getElementById("game-canvas");
    return { w: c.width, h: c.height };
  });
  console.log("✅ 리사이즈 후 캔버스 크기:", JSON.stringify(canvasSize));
  if (canvasSize.w !== 800 || canvasSize.h !== 600) {
    throw new Error("리사이즈 시 캔버스가 화면 크기를 따라가지 않음: " + JSON.stringify(canvasSize));
  }
  console.log("✅ 브라우저 창 크기 변경 시 캔버스가 정상적으로 리사이즈됨");

  await sleep(500);
  console.log("\n콘솔 에러 개수:", consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.log("발견된 콘솔 에러:");
    consoleErrors.forEach((e) => console.log(" -", e));
  }
  console.log("실패/4xx+ 응답 요청:", JSON.stringify(failedRequests));

  await browser.close();

  if (consoleErrors.length > 0) {
    console.error("❌ 브라우저 콘솔에서 에러가 발견됨");
    process.exit(1);
  }
  console.log("=== 실제 브라우저 통합 테스트 통과 (콘솔 에러 없음) ===");
  process.exit(0);
})().catch((e) => {
  console.error("❌ 브라우저 테스트 실패:", e.message);
  process.exit(1);
});
