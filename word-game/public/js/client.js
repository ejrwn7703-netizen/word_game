const socket = io();

// ===== 상태 =====
let myNickname = '';
let myRoomCode = '';
let isHost = false;

// ===== 화면 전환 =====
const screens = {
  main:   document.getElementById('screen-main'),
  lobby:  document.getElementById('screen-lobby'),
  game:   document.getElementById('screen-game'),
  result: document.getElementById('screen-result')
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ===== 메인 화면 DOM =====
const nicknameInput  = document.getElementById('nickname-input');
const createRoomBtn  = document.getElementById('create-room-btn');
const roomCodeInput  = document.getElementById('room-code-input');
const joinRoomBtn    = document.getElementById('join-room-btn');
const mainError      = document.getElementById('main-error');

// URL 파라미터 ?room=XXXXXX → 방 코드 자동 입력 (FR-12)
const urlRoom = new URLSearchParams(window.location.search).get('room');
if (urlRoom) roomCodeInput.value = urlRoom.toUpperCase();

function updateMainButtons() {
  const hasNick = nicknameInput.value.trim().length > 0;
  createRoomBtn.disabled = !hasNick;
  joinRoomBtn.disabled   = !(hasNick && roomCodeInput.value.trim().length > 0);
}

nicknameInput.addEventListener('input', updateMainButtons);
roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
  updateMainButtons();
});

// Enter 키: 방 코드가 있으면 입장, 없으면 방 만들기
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (roomCodeInput.value.trim()) joinRoomBtn.click();
  else createRoomBtn.click();
});
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoomBtn.click();
});

createRoomBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  if (!name) return;
  myNickname = name;
  mainError.textContent = '';
  socket.emit('create_room', { nickname: name });
});

joinRoomBtn.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name || !code) return;
  myNickname = name;
  mainError.textContent = '';
  socket.emit('join_room', { roomCode: code, nickname: name });
});

// ===== 대기실 화면 DOM =====
const lobbyRoomCodeEl  = document.getElementById('lobby-room-code');
const copyLinkBtn      = document.getElementById('copy-link-btn');
const playerCountEl    = document.getElementById('player-count');
const playerListEl     = document.getElementById('player-list');
const startGameBtn     = document.getElementById('start-game-btn');
const lobbyMinPlayers  = document.getElementById('lobby-min-players');

copyLinkBtn.addEventListener('click', () => {
  const link = `${window.location.origin}/?room=${myRoomCode}`;
  navigator.clipboard.writeText(link).then(() => {
    copyLinkBtn.textContent = '복사됨!';
    setTimeout(() => { copyLinkBtn.textContent = '링크 복사'; }, 2000);
  });
});

startGameBtn.addEventListener('click', () => {
  socket.emit('start_game');
});

function renderLobby(players) {
  playerCountEl.textContent = `참여자 (${players.length}명)`;
  playerListEl.innerHTML = players
    .map(p => `<li class="player-item${p.isHost ? ' host' : ''}">${p.isHost ? '👑 ' : ''}${p.nickname}</li>`)
    .join('');

  // 게임 시작 버튼 활성/비활성 (방장만 해당)
  if (isHost) {
    const canStart = players.length >= 2;
    startGameBtn.disabled = !canStart;
    lobbyMinPlayers.classList.toggle('hidden', canStart);
  }
}

// ===== 소켓 이벤트 =====
socket.on('connect', () => {
  console.log('서버에 연결됨:', socket.id);
});

// 방 입장 완료 (내가 만들거나 입장했을 때)
socket.on('room_joined', ({ roomCode, players, isHost: host }) => {
  myRoomCode = roomCode;
  isHost = host;

  lobbyRoomCodeEl.textContent = roomCode;

  // 방장에게만 게임 시작 버튼 표시
  startGameBtn.classList.toggle('hidden', !isHost);
  lobbyMinPlayers.classList.add('hidden');

  renderLobby(players);
  showScreen('lobby');
});

// 다른 플레이어 입장
socket.on('player_joined', ({ players }) => {
  renderLobby(players);
});

// 플레이어 퇴장 / 방장 위임
socket.on('player_left', ({ players, newHost }) => {
  if (newHost === myNickname) {
    isHost = true;
    startGameBtn.classList.remove('hidden');
  }
  renderLobby(players);
});

// 오류 메시지 (메인 화면에 표시)
socket.on('error', ({ message }) => {
  mainError.textContent = message;
});

socket.on('disconnect', () => {
  console.log('서버 연결 해제');
});

// 초기 버튼 상태 설정
updateMainButtons();
