/**
 * Phase 2 서버 로직 테스트
 * 실행: node test/phase2-test.js
 * 서버가 localhost:3000 에서 실행 중이어야 합니다.
 */

const { io } = require('socket.io-client');

const URL = 'http://localhost:3000';
const results = [];
let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`);
    results.push({ label, pass: true });
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    results.push({ label, pass: false });
    failed++;
  }
}

function connect() {
  return new Promise((resolve) => {
    const client = io(URL, { timeout: 3000 });
    client.on('connect', () => resolve(client));
    client.on('connect_error', (err) => {
      console.error('연결 실패:', err.message);
      process.exit(1);
    });
  });
}

function waitFor(client, event) {
  return new Promise((resolve) => {
    client.once(event, resolve);
  });
}

async function run() {
  console.log('\n=== Phase 2 서버 로직 테스트 ===\n');

  // ─── 테스트 1: 방 만들기 ─────────────────────────────
  console.log('[T1] 방 만들기');
  const clientA = await connect();
  clientA.emit('create_room', { nickname: '서덕주' });
  const t1Data = await waitFor(clientA, 'room_joined');

  assert('room_joined 이벤트 수신',         !!t1Data);
  assert('방 코드 6자리',                    t1Data.roomCode?.length === 6, t1Data.roomCode);
  assert('isHost = true',                    t1Data.isHost === true);
  assert('참여자 목록에 방장 포함',           t1Data.players?.length === 1 && t1Data.players[0].nickname === '서덕주');
  assert('방장 플래그 정상',                 t1Data.players?.[0]?.isHost === true);

  const roomCode = t1Data.roomCode;

  // ─── 테스트 2: 방 입장 ─────────────────────────────
  console.log('\n[T2] 방 입장');
  const clientB = await connect();

  const [t2DataB, t2DataA] = await Promise.all([
    new Promise(resolve => {
      clientB.emit('join_room', { roomCode, nickname: '김철수' });
      clientB.once('room_joined', resolve);
    }),
    waitFor(clientA, 'player_joined')
  ]);

  assert('room_joined 수신 (B)',             !!t2DataB);
  assert('isHost = false (B)',               t2DataB.isHost === false);
  assert('참여자 2명',                        t2DataB.players?.length === 2);
  assert('방장 표시 정상 (B 수신 목록)',      t2DataB.players?.some(p => p.nickname === '서덕주' && p.isHost));
  assert('player_joined 수신 (A)',           t2DataA?.nickname === '김철수');

  // ─── 테스트 3: 비방장 퇴장 ─────────────────────────────
  console.log('\n[T3] 비방장(B) 퇴장');
  const clientC = await connect();
  clientC.emit('join_room', { roomCode, nickname: '이영희' });
  await waitFor(clientA, 'player_joined'); // A에서 C 입장 이벤트 대기

  // A와 B 둘 다 player_left 를 소비해야 T4에서 레이스 컨디션 방지
  const t3PromiseA = waitFor(clientA, 'player_left');
  const t3PromiseB = waitFor(clientB, 'player_left');
  clientC.disconnect();
  const [t3Data] = await Promise.all([t3PromiseA, t3PromiseB]);

  assert('player_left 수신',                 !!t3Data);
  assert('퇴장자 닉네임',                    t3Data.nickname === '이영희');
  assert('방장 위임 없음 (newHost null)',     t3Data.newHost === null);
  assert('남은 참여자 2명',                  t3Data.players?.length === 2);

  // ─── 테스트 4: 방장 퇴장 → 방장 위임 ────────────────────
  console.log('\n[T4] 방장(A) 퇴장 → B가 방장이 됨');
  const t4Promise = waitFor(clientB, 'player_left');
  clientA.disconnect();
  const t4Data = await t4Promise;

  assert('player_left 수신 (B)',             !!t4Data);
  assert('퇴장자 닉네임 = 서덕주',           t4Data.nickname === '서덕주');
  assert('newHost = 김철수',                 t4Data.newHost === '김철수');
  assert('새 방장 플래그 정상',              t4Data.players?.some(p => p.nickname === '김철수' && p.isHost));

  // ─── 테스트 5: 오류 케이스 ─────────────────────────────
  console.log('\n[T5] 오류 케이스');
  const clientD = await connect();

  // 5-1. 존재하지 않는 방
  clientD.emit('join_room', { roomCode: 'ZZZZZZ', nickname: '테스트' });
  const err1 = await waitFor(clientD, 'error');
  assert('존재하지 않는 방 오류',            err1.message === '존재하지 않는 방입니다.', err1.message);

  // 5-2. 닉네임 중복
  clientD.emit('join_room', { roomCode, nickname: '김철수' });
  const err2 = await waitFor(clientD, 'error');
  assert('닉네임 중복 오류',                 err2.message === '이미 사용 중인 닉네임입니다.', err2.message);

  // ─── 테스트 6: 방 삭제 (마지막 플레이어 퇴장) ────────────
  console.log('\n[T6] 마지막 플레이어 퇴장 → 방 삭제');
  clientB.disconnect();
  await new Promise(r => setTimeout(r, 300));

  // 삭제된 방에 새 클라이언트가 입장 시도 → "존재하지 않는 방" 오류
  const clientE = await connect();
  clientE.emit('join_room', { roomCode, nickname: '박지수' });
  const err3 = await waitFor(clientE, 'error');
  assert('방 삭제 후 입장 오류',             err3.message === '존재하지 않는 방입니다.', err3.message);

  // ─── 결과 출력 ────────────────────────────────────────
  console.log('\n==============================');
  console.log(`결과: ${passed}/${passed + failed} 통과`);
  if (failed > 0) console.log(`실패: ${failed}개`);
  console.log('==============================\n');

  clientD.disconnect();
  clientE.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('테스트 오류:', err.message);
  process.exit(1);
});
