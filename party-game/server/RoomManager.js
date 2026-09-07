// server/RoomManager.js
const { ROOM_CODE_CHARS, ROOM_CODE_LENGTH } = require("../shared/constants");
const Room = require("./Room");

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
  }

  _generateCode() {
    let code;
    do {
      code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom() {
    const code = this._generateCode();
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get((code || "").toUpperCase());
  }

  removeRoomIfEmpty(code) {
    const room = this.rooms.get(code);
    if (room && room.isEmpty()) {
      room.stopLoop();
      this.rooms.delete(code);
    }
  }
}

module.exports = RoomManager;
