/**
 * api-simulation.js - 真实 API 调用模拟脚本
 * 通过 HTTP 请求创建牌桌、加入玩家、模拟游戏动作
 */

const API_BASE = 'http://localhost:3000/api';

// 延迟函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 创建牌桌
async function createTable() {
  console.log('📋 Creating table: default-table...');
  
  const response = await fetch(`${API_BASE}/table/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId: 'default-table',
      smallBlind: 10,
      bigBlind: 20
    })
  });
  
  const data = await response.json();
  
  if (data.success) {
    console.log('✅ Table created successfully');
  } else {
    console.log('⚠️  Table might already exist:', data.error);
  }
  
  return data;
}

// 玩家加入牌桌
async function joinPlayer(playerId, playerName, buyIn = 1000) {
  console.log(`👤 ${playerName} joining table...`);
  
  const response = await fetch(`${API_BASE}/table/default-table/join`, {
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
  } else {
    console.log(`❌ Failed to join: ${data.error}`);
  }
  
  return data;
}

// 获取游戏状态
async function getGameState() {
  const response = await fetch(`${API_BASE}/table/default-table/state`);
  const data = await response.json();
  return data.success ? data.state : null;
}

// 执行玩家动作
async function performAction(playerId, action, amount = 0) {
  const response = await fetch(`${API_BASE}/table/default-table/action`, {
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
}

// 智能决策（简单策略）
function makeDecision(gameState, playerId) {
  const player = gameState.players.find(p => p.id === playerId);
  if (!player) return null;
  
  const callAmount = gameState.currentBet - player.currentBet;
  
  // 如果不需要跟注
  if (callAmount === 0) {
    // 30% 概率加注
    if (Math.random() > 0.7) {
      return { action: 'RAISE', amount: 30 };
    }
    return { action: 'CHECK' };
  }
  
  // 需要跟注的情况
  const potOdds = callAmount / (gameState.pot + callAmount);
  
  // 底池赔率太差，40% 概率弃牌
  if (potOdds > 0.4 && Math.random() > 0.6) {
    return { action: 'FOLD' };
  }
  
  // 20% 概率加注
  if (Math.random() > 0.8 && player.chips > callAmount + 50) {
    return { action: 'RAISE', amount: 50 };
  }
  
  // 否则跟注
  return { action: 'CALL' };
}

// 游戏循环
async function gameLoop() {
  console.log('\n🎮 Starting game simulation loop...\n');
  
  let roundCount = 0;
  
  while (true) {
    await sleep(3000); // 每 3 秒检查一次
    
    try {
      const gameState = await getGameState();
      
      if (!gameState) {
        console.log('⚠️  No game state available');
        continue;
      }
      
      // 检查游戏是否结束
      if (gameState.stage === 'FINISHED') {
        console.log('\n🏁 Game finished! Starting new round...\n');
        roundCount++;
        await sleep(2000);
        continue;
      }
      
      const currentPlayer = gameState.currentPlayer;
      
      if (!currentPlayer) {
        continue;
      }
      
      // 只处理我们的 AI 玩家
      if (!currentPlayer.startsWith('agent-')) {
        continue;
      }
      
      const player = gameState.players.find(p => p.id === currentPlayer);
      
      console.log(`\n--- Round ${roundCount + 1} | Stage: ${gameState.stage} ---`);
      console.log(`Current Player: ${player.name} (${player.id})`);
      console.log(`Pot: $${gameState.pot} | Current Bet: $${gameState.currentBet}`);
      console.log(`Community Cards: ${gameState.communityCards.join(', ') || 'None'}`);
      
      // 做出决策
      const decision = makeDecision(gameState, currentPlayer);
      
      if (!decision) {
        console.log('⚠️  Could not make decision');
        continue;
      }
      
      console.log(`💡 Decision: ${decision.action} ${decision.amount ? `$${decision.amount}` : ''}`);
      
      // 执行动作
      const result = await performAction(currentPlayer, decision.action, decision.amount);
      
      if (result.success) {
        console.log(`✅ Action executed successfully`);
      } else {
        console.log(`❌ Action failed: ${result.error}`);
      }
      
    } catch (error) {
      console.error('❌ Error in game loop:', error.message);
      await sleep(5000);
    }
  }
}

// 主函数
async function main() {
  console.log('🃏 MoltPlayground API Simulation\n');
  console.log('Connecting to:', API_BASE);
  console.log('');
  
  try {
    // 1. 创建牌桌
    await createTable();
    await sleep(500);
    
    // 2. 玩家加入
    await joinPlayer('agent-1', 'AlphaBot', 1000);
    await sleep(500);
    
    await joinPlayer('agent-2', 'BetaBot', 1000);
    await sleep(500);
    
    await joinPlayer('agent-3', 'GammaBot', 1000);
    await sleep(1000);
    
    console.log('\n✅ Setup complete! Game should have started.\n');
    console.log('🔄 Starting automated gameplay...\n');
    
    // 3. 开始游戏循环
    await gameLoop();
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error('\nMake sure the backend server is running on http://localhost:3000');
    process.exit(1);
  }
}

// 运行
main();
