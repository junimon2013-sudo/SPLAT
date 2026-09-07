// test/browser_test_cross_origin.js
// 클라이언트가 서버와 "다른 주소"에서 열렸을 때(예: 깃허브 페이지 등 정적 호스팅) 시나리오를 검증한다.
// 1) 정적 파일 서버(8099)로 client/index.html만 서빙 (서버 없는 척)
// 2) 실제 게임 서버는 3000번에서 별도로 실행
// 3) 자동으로 "서버 연결 안 됨" 안내가 뜨는지, 주소를 입력하면 정상 연결/방 생성까지 되는지 확인
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const STATIC_PORT = 8099;
const SERVER_PORT = 3000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startStaticServer() {
  const htmlPath = path.join(__dirname, "..", "client", "index.html");
  const html = fs.readFileSync(htmlPath);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(STATIC_PORT, () => resolve(server));
  });
}

(async () => {
  console.log("=== 크로스 오리진(정적 호스팅) 서버 주소 설정 테스트 ===");

  const gameServer = spawn("node", [path.join(__dirname, "..", "server", "index.js")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  gameServer.stdout.on("data", (d) => process.stdout.write("[server] " + d));
  gameServer.stderr.on("data", (d) => process.stderr.write("[server-err] " + d));
  await sleep(1000);

  const staticServer = await startStaticServer();
  console.log(`✅ 정적 서버(${STATIC_PORT}) + 게임 서버(${SERVER_PORT}) 기동됨`);

  const browser = await chromium.launch({ executablePath: EXEC });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  let exitCode = 0;
  try {
    await page.goto(`http://localhost:${STATIC_PORT}/`);
    await page.waitForSelector("#screen-title.active");
    console.log("✅ 정적 페이지 로딩됨 (서버 없이 HTML만 서빙)");

    await page.waitForTimeout(4000);
    const settingsVisible = await page.evaluate(
      () => !document.getElementById("server-settings").classList.contains("hidden")
    );
    if (!settingsVisible) throw new Error("연결 실패 시 서버 주소 설정 박스가 자동으로 열리지 않음");
    console.log("✅ 연결 실패 시 서버 주소 설정 박스 자동으로 열림");

    await page.fill("#input-server-url", `ws://localhost:${SERVER_PORT}`);
    await page.click("#btn-save-server-url");
    await page.waitForTimeout(1500);

    await page.fill("#input-name", "테스터");
    await page.click("#btn-create-room");
    await page.waitForSelector("#screen-lobby.active", { timeout: 5000 });
    console.log("✅ 서버 주소 입력 후 실제로 방 생성까지 성공");

    if (errors.length > 0) throw new Error("콘솔 에러 발생: " + JSON.stringify(errors));
    console.log("✅ 콘솔 에러 없음");
    console.log("=== 크로스 오리진 테스트 통과 ===");
  } catch (e) {
    console.error("❌ 테스트 실패:", e.message);
    exitCode = 1;
  }

  await browser.close();
  staticServer.close();
  gameServer.kill();
  process.exit(exitCode);
})();
