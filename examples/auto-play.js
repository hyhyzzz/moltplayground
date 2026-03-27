/**
 * auto-play.js - 自动游戏脚本
 * 让三个机器人持续不断地自动对战
 */

const API_BASE = 'http://localhost:3000/api';
const TABLE_ID = 'default-table';
const POLL_INTERVAL = 2000; // 2秒轮询一次

// 延迟函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 创建牌桌
async function createTable() {
  console.log('📋 Creating table:', TABLE_ID);
  try {
    const response = await fetch(`${API_BASE}/table/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableId: TABLE_ID,
        smallBlind: 10,
        bigBlind: 20
      })
    });
    const data = await response.json();
    if (data.success) {
      console.log('✅ Table created successfully');
      return true;
    } else {
      console.log('⚠️  Table creation response:', data.error || 'Unknown error');
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to create table:', error.message);
    return false;
  }
}

// 玩家加入牌桌
async function joinPlayer(playerId, playerName, buyIn = 1000) {
  console.log(`👤 ${playerName} joining table...`);
  try {
    const response = await fetch(`${API_BASE}/table/${TABLE_ID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId,
        playerName,
        buyIn
      })
    });
    const data = await response.json();
    if (data.success) {
      console.log(`✅ ${playerName} joined with ${buyIn} chips`);
      return true;
    } else {
      console.log(`⚠️  ${playerName} join failed:`, data.error);
      return false;
    }
  } catch (error) {
    console.error(`❌ Failed to join ${playerName}:`, error.message);
    return false;
  }
}

// 获取游戏状态
async function getGameState() {
  try {
    const response = await fetch(`${API_BASE}/table/${TABLE_ID}/state`);
    const data = await response.json();
    return data.success ? data.state : null;
  } catch (error) {
    return null;
  }
}

// 检查并初始化牌桌
async function ensureTableExists() {
  console.log('\n🔍 Checking if table exists...');
  
  // 尝试获取游戏状态
  const state = await getGameState();
  
  if (state && state.players && state.players.length >= 3) {
    console.log('✅ Table exists with players, ready to play!');
    return true;
  }
  
  console.log('⚠️  Table not found or incomplete, initializing...');
  
  // 创建牌桌
  await createTable();
  await sleep(500);
  
  // 添加玩家
  await joinPlayer('agent-1', 'AlphaBot', 1000);
  await sleep(500);
  
  await joinPlayer('agent-2', 'BetaBot', 1000);
  await sleep(500);
  
  await joinPlayer('agent-3', 'GammaBot', 1000);
  await sleep(1000);
  
  console.log('✅ Table initialized successfully!\n');
  return true;
}

// 开始新一局
async function startNewHand() {
  console.log('\n🎬 Starting new hand...');
  try {
    const response = await fetch(`${API_BASE}/table/${TABLE_ID}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    if (data.success) {
      console.log('✅ New hand started successfully\n');
      return true;
    } else {
      console.log('⚠️  Failed to start new hand:', data.error);
      return false;
    }
  } catch (error) {
    console.error('❌ Error starting new hand:', error.message);
    return false;
  }
}

// 执行玩家动作
async function performAction(playerId, action, amount = 0) {
  try {
    const response = await fetch(`${API_BASE}/table/${TABLE_ID}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId,
        action,
        amount
      })
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Failed to perform action:', error.message);
    return { success: false, error: error.message };
  }
}

// 智能决策系统
function makeDecision(gameState, playerId) {
  const player = gameState.players.find(p => p.id === playerId);
  
  if (!player) {
    console.warn('⚠️  Player not found in game state');
    return null;
  }
  
  // 如果玩家已经弃牌，返回 null（不应该轮到这个玩家）
  if (player.folded) {
    console.warn('⚠️  Player already folded, should not be current player');
    return null;
  }
  
  // 【兜底逻辑】如果玩家已经全下但仍然是当前玩家（引擎 bug），发送 CHECK 避免卡死
  if (player.allIn || player.chips === 0) {
    console.warn('⚠️  Player is all-in or has 0 chips but is current player - sending CHECK as fallback');
    return { action: 'CHECK' };
  }
  
  const callAmount = gameState.currentBet - player.currentBet;
  const random = Math.random();
  
  // 【关键修复】如果不需要跟注（currentBet === 0 或者已经跟到位）
  if (callAmount === 0) {
    // 70% 概率过牌（免费看牌）
    if (random < 0.70) {
      return { action: 'CHECK' };
    }
    // 30% 概率加注
    const raiseAmount = Math.min(50, Math.floor(player.chips * 0.2));
    if (raiseAmount > 0) {
      return { action: 'RAISE', amount: raiseAmount };
    }
    // 如果筹码不足以加注，就过牌
    return { action: 'CHECK' };
  }
  
  // 需要跟注的情况
  
  // 【兜底逻辑】如果筹码不足以跟注，只能弃牌
  if (player.chips < callAmount) {
    console.warn(`⚠️  Insufficient chips (${player.chips}) to call (${callAmount}), folding`);
    return { action: 'FOLD' };
  }
  
  // 10% 概率弃牌
  if (random < 0.10) {
    return { action: 'FOLD' };
  }
  
  // 30% 概率加注（如果筹码足够）
  if (random < 0.40) {
    const raiseAmount = Math.min(50, Math.floor(player.chips * 0.15));
    if (player.chips > callAmount + raiseAmount && raiseAmount > 0) {
      return { action: 'RAISE', amount: raiseAmount };
    }
  }
  
  // 60% 概率跟注（或者加注失败后跟注）
  return { action: 'CALL' };
}

// 主游戏循环
async function gameLoop() {
  console.log('🃏 Auto-Play Script Started');
  console.log(`📡 Connecting to: ${API_BASE}`);
  console.log(`🎲 Table: ${TABLE_ID}`);
  console.log(`⏱️  Poll Interval: ${POLL_INTERVAL}ms\n`);
  
  let roundCount = 0;
  let actionCount = 0;
  
  while (true) {
    await sleep(POLL_INTERVAL);
    
    try {
      const gameState = await getGameState();
      
      if (!gameState) {
        console.log('⚠️  No game state available, retrying...');
        continue;
      }
      
      // 【关键修复】优先处理 FINISHED 状态
      if (gameState.stage === 'FINISHED' || gameState.stage === 'finished') {
        roundCount++;
        console.log(`\n🏁 Round ${roundCount} completed!`);
        console.log(`📊 Total actions executed: ${actionCount}`);
        
        // 【关键修复】显示本局胜者
        console.log('\n🏆 ===== ROUND WINNERS ===== 🏆');
        const sortedPlayers = [...gameState.players].sort((a, b) => b.chips - a.chips);
        sortedPlayers.forEach((p, index) => {
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
          console.log(`${medal} ${p.name}: $${p.chips}`);
        });
        console.log('\n⏳ Waiting 3 seconds before starting new hand...\n');
        
        await sleep(3000); // 延迟3秒让监控台看清结果
        await startNewHand();
        continue;
      }
      
      // 【关键修复】处理 WAITING 状态 - 自动触发开局
      if (gameState.stage === 'WAITING' || gameState.stage === 'waiting') {
        console.log('\n🎬 检测到游戏未开始，正在初始化并启动新局...');
        const started = await startNewHand();
        if (started) {
          console.log('✅ 新局启动成功，等待进入 PRE_FLOP 阶段...\n');
        } else {
          console.log('⚠️  启动新局失败，2秒后重试...\n');
          await sleep(2000);
        }
        continue;
      }
      
      // 【关键修复】只在活跃下注阶段才执行动作，拒绝在 SHOWDOWN 等非下注阶段行动
      const ACTIVE_BETTING_STAGES = ['PRE_FLOP', 'FLOP', 'TURN', 'RIVER'];
      if (!ACTIVE_BETTING_STAGES.includes(gameState.stage)) {
        console.log(`⏸️  Stage ${gameState.stage} is not a betting stage, waiting...`);
        await sleep(1000);
        continue;
      }
      
      const currentPlayer = gameState.currentPlayer;
      
      if (!currentPlayer) {
        console.log('⏳ Waiting for current player...');
        continue;
      }
      
      const player = gameState.players.find(p => p.id === currentPlayer);
      
      if (!player) {
        console.log('⚠️  Current player not found');
        continue;
      }
      
      // 显示当前状态
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🎮 Round ${roundCount + 1} | Stage: ${gameState.stage}`);
      console.log(`👤 Current: ${player.name} (${player.id})`);
      console.log(`💰 Pot: $${gameState.pot} | Bet: $${gameState.currentBet}`);
      console.log(`🃏 Community: ${gameState.communityCards.join(' ') || 'None'}`);
      console.log(`💵 Player Chips: $${player.chips} | Current Bet: $${player.currentBet}`);
      
      // 做出决策
      const decision = makeDecision(gameState, currentPlayer);
      
      if (!decision) {
        console.log('⚠️  Cannot make decision for this player, skipping...');
        // 等待一下再重试，避免快速循环
        await sleep(3000);
        continue;
      }
      
      console.log(`💡 Decision: ${decision.action}${decision.amount ? ` $${decision.amount}` : ''}`);
      
      // 执行动作
      const result = await performAction(currentPlayer, decision.action, decision.amount);
      
      if (result.success) {
        actionCount++;
        console.log(`✅ Action executed (Total: ${actionCount})`);
      } else {
        console.log(`❌ Action failed: ${result.error}`);
      }
      
    } catch (error) {
      console.error('❌ Error in game loop:', error.message);
      await sleep(5000); // 出错后等待5秒再重试
    }
  }
}

// 启动脚本
async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   MoltPlayground Auto-Play Script     ║');
  console.log('║   Continuous AI vs AI Poker Battle    ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('\n');
  
  try {
    // 确保牌桌存在并初始化
    await ensureTableExists();
    
    // 开始游戏循环
    await gameLoop();
  } catch (error) {
    console.error('\n💥 Fatal Error:', error);
    console.error('\nMake sure:');
    console.error('1. Backend server is running on http://localhost:3000');
    console.error('2. API endpoints are accessible\n');
    process.exit(1);
  }
}

main();
