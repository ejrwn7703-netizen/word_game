const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const wordsPath = path.join(__dirname, 'data', 'words.json');
const words = JSON.parse(fs.readFileSync(wordsPath, 'utf-8'));
console.log(`단어 ${words.length}개 로딩 완료`);

// 방 상태 저장소 (서버 메모리)
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log(`클라이언트 연결됨: ${socket.id}`);

  // 방 만들기
  socket.on('create_room', ({ nickname }) => {
    const name = (nickname || '').trim();
    if (!name || name.length > 10) {
      socket.emit('error', { message: '닉네임을 확인해주세요. (1~10자)' });
      return;
    }

    const roomCode = generateRoomCode();
    rooms.set(roomCode, {
      code: roomCode,
      hostSocketId: socket.id,
      players: [{ socketId: socket.id, nickname: name, score: 0, joinOrder: 0 }],
      status: 'waiting',
      wordQueue: [],
      currentIndex: 0,
      currentWord: '',
      questionTimer: null,
      categoryTimer: null,
      gameTimer: null,
      gameStartTime: 0
    });

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.nickname = name;

    socket.emit('room_joined', {
      roomCode,
      players: [{ nickname: name, isHost: true }],
      isHost: true
    });

    console.log(`방 생성: ${roomCode} (방장: ${name})`);
  });

  // 방 입장
  socket.on('join_room', ({ roomCode, nickname }) => {
    const name = (nickname || '').trim();
    const code = (roomCode || '').trim().toUpperCase();

    if (!name || name.length > 10) {
      socket.emit('error', { message: '닉네임을 확인해주세요. (1~10자)' });
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', { message: '존재하지 않는 방입니다.' });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('error', { message: '게임이 이미 진행 중입니다.' });
      return;
    }
    if (room.players.some(p => p.nickname === name)) {
      socket.emit('error', { message: '이미 사용 중인 닉네임입니다.' });
      return;
    }

    const joinOrder = room.players.length;
    room.players.push({ socketId: socket.id, nickname: name, score: 0, joinOrder });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.nickname = name;

    const playerList = room.players.map(p => ({
      nickname: p.nickname,
      isHost: p.socketId === room.hostSocketId
    }));

    socket.emit('room_joined', { roomCode: code, players: playerList, isHost: false });
    socket.to(code).emit('player_joined', { nickname: name, players: playerList });

    console.log(`방 입장: ${code} (${name})`);
  });

  // 연결 해제 — 방 정리 및 방장 위임
  socket.on('disconnect', () => {
    console.log(`클라이언트 연결 해제: ${socket.id}`);

    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    const idx = room.players.findIndex(p => p.socketId === socket.id);
    if (idx === -1) return;

    const leavingName = room.players[idx].nickname;
    const wasHost = room.hostSocketId === socket.id;
    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      rooms.delete(roomCode);
      console.log(`방 삭제: ${roomCode}`);
      return;
    }

    let newHost = null;
    if (wasHost) {
      // 입장 순서가 가장 빠른 플레이어가 방장
      const next = room.players.reduce((a, b) => a.joinOrder < b.joinOrder ? a : b);
      room.hostSocketId = next.socketId;
      newHost = next.nickname;
    }

    const playerList = room.players.map(p => ({
      nickname: p.nickname,
      isHost: p.socketId === room.hostSocketId
    }));

    io.to(roomCode).emit('player_left', { nickname: leavingName, players: playerList, newHost });
  });
});

server.listen(PORT, () => {
  console.log(`서버 실행 중 - 포트 ${PORT}`);
});
