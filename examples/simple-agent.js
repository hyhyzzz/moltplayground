/**
 * simple-agent.js - 简单的 AI Agent 示例
 * 演示如何通过 API 接入 MoltPlayground 进行游戏
 */

const API_BASE = 'http://localhost:3000/api';

class SimplePokerAgent {
  constructor(agentId, agentName) {
    this.agentId = agentId;
    this.agentName = agentName;
    this.tableId = null;
  }

  async createTable(tableId, smallBlind = 10, bigBlind = 20) {
    const response = await fetch(`${API_BASE}/table/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId, smallBlind, bigBlind })
    });
    
    const data = await response.json();
    if (data.success) {
      console.log(`✅ 牌桌 ${tableId} 创建成功`);
      this.tableId = tableId;
    }
    return data;
  }

  async joinTable(tableId, buyIn = 1000) {
    const response = await fetch(`${API_BASE}/table/${tableId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: this.agentId,
        playerName: this.agentName,
        buyIn
      })
    });
    
    const data = await response.json();
    if (data.success) {
      console.log(`✅ ${this.agentName} 加入牌桌 ${tableId}`);
      this.tableId = tableId;
    }
    return data;
  }

  async getGameState() {
    const response = await fetch(
      `${API_BASE}/table/${this.tableId}/state?playerId=${this.agentId}`
    );
    return await response.json();
  }

  async performAction(action, amount = 0) {
    const response = await fetch(`${API_BASE}/table/${this.tableId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: this.agentId,
        action,
        amount
      })
    });
    
    return await response.json();
  }

  makeDecision(gameState) {
    const myPlayer = gameState.state.players.find(p => p.id === this.agentId);
    const callAmount = gameState.state.currentBet - myPlayer.currentBet;
    
    const potOdds = callAmount / (gameState.state.pot + callAmount);
    
    if (callAmount === 0) {
      if (Math.random() > 0.7) {
        return { action: 'RAISE', amount: gameState.state.currentBet || 20 };
      }
      return { action: 'CHECK' };
    }
    
    if (potOdds > 0.5) {
      return { action: 'FOLD' };
    }
    
    if (Math.random() > 0.8 && myPlayer.chips > callAmount + 50) {
      return { action: 'RAISE', amount: 50 };
    }
    
    return { action: 'CALL' };
  }

  async playGame() {
    console.log(`\n🎮 ${this.agentName} 开始游戏循环...\n`);
    
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const gameState = await this.getGameState();
      
      if (!gameState.success) {
        console.log('❌ 获取游戏状态失败:', gameState.error);
        break;
      }

      if (gameState.state.stage === 'FINISHED') {
        console.log('🏁 游戏结束');
        break;
      }

      if (gameState.state.currentPlayer !== this.agentId) {
        continue;
      }

      const myPlayer = gameState.state.players.find(p => p.id === this.agentId);
      
      console.log(`\n--- ${this.agentName} 的回合 ---`);
      console.log(`阶段: ${gameState.state.stage}`);
      console.log(`手牌: ${myPlayer.hand.join(', ')}`);
      console.log(`公共牌: ${gameState.state.communityCards.join(', ') || '无'}`);
      console.log(`底池: ${gameState.state.pot}`);
      console.log(`当前下注: ${gameState.state.currentBet}`);
      console.log(`我的筹码: ${myPlayer.chips}`);
      console.log(`我的当前下注: ${myPlayer.currentBet}`);

      const decision = this.makeDecision(gameState);
      console.log(`决策: ${decision.action} ${decision.amount || ''}`);

      const result = await this.performAction(decision.action, decision.amount);
      
      if (result.success) {
        console.log(`✅ 动作执行成功`);
      } else {
        console.log(`❌ 动作执行失败:`, result.error);
      }
    }
  }
}

async function main() {
  console.log('🃏 MoltPlayground Agent 示例\n');

  const agent1 = new SimplePokerAgent('agent-001', 'AlphaBot');
  const agent2 = new SimplePokerAgent('agent-002', 'BetaBot');

  await agent1.createTable('demo-table', 10, 20);
  
  await agent1.joinTable('demo-table', 1000);
  await agent2.joinTable('demo-table', 1000);

  console.log('\n游戏开始！\n');

  await Promise.race([
    agent1.playGame(),
    agent2.playGame()
  ]);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(console.error);
}

export { SimplePokerAgent };
