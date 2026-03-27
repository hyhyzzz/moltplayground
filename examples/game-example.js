/**
 * game-example.js - 游戏引擎使用示例
 * 演示如何使用 GameEngine 进行一局完整的德州扑克游戏
 */

import { Table } from '../src/models/Table.js';
import { Player } from '../src/models/Player.js';
import { GameEngine } from '../src/engine/GameEngine.js';
import { PlayerAction } from '../src/engine/GameStage.js';

const table = new Table('table-001', 10, 20);

const player1 = new Player('agent-1', 'AlphaPoker', 1000);
const player2 = new Player('agent-2', 'BetaBot', 1000);
const player3 = new Player('agent-3', 'GammaAI', 1000);

table.addPlayer(player1);
table.addPlayer(player2);
table.addPlayer(player3);

const engine = new GameEngine(table);

engine.setActionTimeout(30000);

console.log('🎮 开始新一局游戏...\n');
const initialState = engine.startNewHand();

console.log('初始状态:');
console.log(`阶段: ${initialState.stage}`);
console.log(`底池: ${initialState.pot}`);
console.log(`当前下注: ${initialState.currentBet}`);
console.log(`当前玩家: ${initialState.currentPlayer}\n`);

initialState.players.forEach(p => {
  console.log(`${p.name} (${p.id}): 筹码=${p.chips}, 手牌=${p.hand.join(',')}, 当前下注=${p.currentBet}`);
});

console.log('\n--- PRE-FLOP 下注轮 ---');
let result1 = engine.processPlayerAction('agent-1', PlayerAction.CALL);
console.log(`${result1.action.player} ${result1.action.type} ${result1.action.amount || ''}`);

let result2 = engine.processPlayerAction('agent-2', PlayerAction.RAISE, 40);
console.log(`${result2.action.player} ${result2.action.type} ${result2.action.amount}`);

let result3 = engine.processPlayerAction('agent-3', PlayerAction.CALL);
console.log(`${result3.action.player} ${result3.action.type} ${result3.action.amount || ''}`);

let result4 = engine.processPlayerAction('agent-1', PlayerAction.CALL);
console.log(`${result4.action.player} ${result4.action.type} ${result4.action.amount || ''}`);

console.log(`\n当前阶段: ${result4.gameState.stage}`);
console.log(`公共牌: ${result4.gameState.communityCards.join(', ')}`);
console.log(`底池: ${result4.gameState.pot}\n`);

console.log('✅ 游戏引擎运行正常！');
console.log('\n💡 提示: 在实际使用中，Agent 会通过 API 调用 processPlayerAction 来执行动作');
