// server/index.js
const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const { MSG, MIN_PLAYERS } = require("../shared/constants");
const RoomManager = require("./RoomManager");
const Player = require("./Player");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, "..", "client")));
app.use("/shared", express.static(path.join(__dirname, "..", "shared")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const roomManager = new RoomManager();

function send(ws, type, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

wss.on("connection", (ws) => {
  let player = null;
  let room = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      console.error("[ws] 잘못된 패킷:", e.message);
      return;
    }
    const { type, payload } = msg || {};

    try {
      switch (type) {
        case MSG.CREATE_ROOM: {
          if (room) return; // 이미 방에 있으면 무시
          const name = (payload && payload.name) || "Player";
          room = roomManager.createRoom();
          player = new Player(ws, name);
          room.addPlayer(player);
          send(ws, MSG.ROOM_STATE, {
            code: room.code,
            joined: true,
            playerId: player.id,
          });
          room.broadcastRoomState();
          break;
        }

        case MSG.JOIN_ROOM: {
          if (room) return;
          const code = (payload && payload.code) || "";
          const name = (payload && payload.name) || "Player";
          const target = roomManager.getRoom(code);
          if (!target) {
            send(ws, MSG.ROOM_ERROR, { message: "방을 찾을 수 없습니다." });
            return;
          }
          if (target.isFull()) {
            send(ws, MSG.ROOM_ERROR, { message: "방이 가득 찼습니다." });
            return;
          }
          if (target.phase === "in_game") {
            send(ws, MSG.ROOM_ERROR, { message: "게임이 이미 시작되었습니다." });
            return;
          }
          room = target;
          player = new Player(ws, name);
          room.addPlayer(player);
          send(ws, MSG.ROOM_STATE, {
            code: room.code,
            joined: true,
            playerId: player.id,
          });
          room.broadcastRoomState();
          break;
        }

        case MSG.SET_MODE:
          if (room && player) room.setMode(payload && payload.mode);
          break;

        case MSG.SET_STAGE:
          if (room && player) room.setStage(payload && payload.index);
          break;

        case MSG.PING:
          if (room && player) {
            room.broadcastEvent("ping", {
              playerId: player.id,
              name: player.name,
              color: (player.color && player.color.hex) || "#ffffff",
              x: payload && payload.x,
              y: payload && payload.y,
            });
          }
          break;

        case MSG.SET_ROUNDS:
          if (room && player) room.setRounds(payload && payload.rounds);
          break;

        case MSG.SET_READY:
          if (room && player) room.setReady(player.id, payload && payload.ready);
          break;

        case MSG.SET_APPEARANCE:
          if (room && player) room.setAppearance(player.id, payload);
          break;

        case MSG.START_GAME: {
          if (!room || !player) return;
          const result = room.startGame(player.id);
          if (!result.ok) {
            send(ws, MSG.ROOM_ERROR, { message: result.reason });
          }
          break;
        }

        case MSG.ADMIN_START_GAME: {
          if (!room || !player) return;
          if (room.phase !== "in_game") room.adminStartGame();
          if (room.engine && typeof room.engine.adminJumpToGame === "function") {
            room.engine.adminJumpToGame(payload.gameId);
          }
          break;
        }

        case MSG.ADMIN_FORCE_ENHANCE:
          if (room && player && room.engine && typeof room.engine.adminForceMaxEnhance === "function") {
            room.engine.adminForceMaxEnhance(player.id);
          }
          break;

        case MSG.ADMIN_SPAWN_TREASURE:
          if (room && player && room.engine && room.engine.currentGame && typeof room.engine.currentGame.adminSpawnTreasure === "function") {
            room.engine.currentGame.adminSpawnTreasure(player.id, payload.mineralIdx);
          }
          break;

        case MSG.INPUT:
          if (room && player) room.handleInput(player.id, payload || {});
          break;

        case MSG.RETRY_STAGE:
          if (room && player) room.retryStage();
          break;

        case MSG.RETURN_TO_LOBBY:
          if (room && player) room.returnToLobby();
          break;

        case MSG.ENHANCE_ATTEMPT:
          if (room && player) room.attemptEnhance(player.id, payload && payload.forceSuccess);
          break;

        case MSG.GIVE_UP:
          if (room && player) room.giveUp(player.id);
          break;

        case MSG.MINE_CLICK:
          if (room && player) room.mineClick(player.id, payload.col, payload.row);
          break;

        case MSG.MINE_RELEASE:
          if (room && player) room.mineRelease(player.id);
          break;

        case MSG.LEAVE_ROOM: {
          if (room && player) {
            const code = room.code;
            room.removePlayer(player.id);
            roomManager.removeRoomIfEmpty(code);
          }
          room = null;
          player = null;
          break;
        }

        case MSG.PING:
          send(ws, MSG.PONG, {});
          break;

        default:
          break;
      }
    } catch (err) {
      console.error("[ws] 메시지 처리 오류:", type, err);
    }
  });

  ws.on("close", () => {
    if (room && player) {
      const code = room.code;
      room.removePlayer(player.id);
      roomManager.removeRoomIfEmpty(code);
    }
  });

  ws.on("error", (err) => {
    console.error("[ws] 소켓 오류:", err.message);
  });
});

server.listen(PORT, () => {
  console.log(`[server] SPLAT! 서버 실행 중 - http://localhost:${PORT}`);
  console.log(`[server] 같은 네트워크의 다른 컴퓨터는 http://<이_PC의_IP>:${PORT} 로 접속`);
});
