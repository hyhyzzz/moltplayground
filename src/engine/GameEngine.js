/**
 * GameEngine.js - 德州扑克游戏引擎核心状态机
 */

import { Deck } from './Deck.js';
import { GameStage, PlayerAction, STAGE_TRANSITION } from './GameStage.js';
import PokerSolver from 'pokersolver';
import { PrismaClient } from '@prisma/client';

const Hand = PokerSolver.Hand;

const ACTION_TIMEOUT_MS = 90000; // 90秒行动超时（适配大模型延迟）

const prisma = new PrismaClient();

export class GameEngine {
  constructor(table, options = {}) {
    this.table = table;
    this.deck = new Deck();
    this.lastRaisePlayer = null;
    this.bettingRoundStartPlayer = null;
    this.currentHandActions = []; // 【战绩记录中心】存储本局所有动作
    this.handStartChips = {}; // 【战绩记录中心】记录每个玩家在本局开始时的筹码
    this.finalPot = 0; // 【财务守恒】记录本局最终底池（分配前的峰值）
    this.actionTimeouts = new Map();
    this.actionTimer = null; // Shot Clock 倒计时器
    this.actionDeadline = null; // 行动截止时间戳
    this.defaultTimeout = 30000; // 默认30秒超时
    this.onPlayerRemoved = options.onPlayerRemoved || null; // 【垃圾回收】玩家移除回调
  }

  /**
   * 开始新一局游戏
   * 【关键修复】每次新局开始前，庄家位置必须向后顺延一位
   */
  startNewHand() {
    // 【等位激活】将所有 WAITING 状态的玩家激活为 ACTIVE
    const waitingPlayers = this.table.players.filter(p => p.status === 'WAITING');
    if (waitingPlayers.length > 0) {
      console.log(`\n🎬 [等位激活] ${waitingPlayers.length} 名等位玩家正式入场：`);
      waitingPlayers.forEach(p => {
        p.status = 'ACTIVE';
        console.log(`   ✅ ${p.name} 从等位转为活跃状态`);
      });
    }
    
    // 【关键】只计算 ACTIVE 状态的玩家
    const activePlayers = this.table.players.filter(p => p.status === 'ACTIVE');
    if (activePlayers.length < 2) {
      console.error('❌ 至少需要2名活跃玩家才能开始游戏，跳过本局');
      return false; // 安全返回，不崩溃
    }

    // 【关键修复】先顺延庄家位置，跳过破产玩家和等位玩家
    let attempts = 0;
    do {
      this.table.dealerPosition = (this.table.dealerPosition + 1) % this.table.players.length;
      attempts++;
      if (attempts > this.table.players.length) {
        console.error('❌ 所有玩家都破产了，无法开始游戏，跳过本局');
        return false; // 安全返回，不崩溃
      }
    } while (this.table.players[this.table.dealerPosition].chips === 0 || this.table.players[this.table.dealerPosition].status === 'WAITING');
    
    console.log(`🎲 New hand starting, Dealer: ${this.table.players[this.table.dealerPosition].name}`);
    
    // 【战绩记录中心】初始化本局动作记录数组
    this.currentHandActions = [];
    
    // 【战绩记录中心】记录本局开始时每个玩家的初始筹码
    this.handStartChips = {};
    this.table.players.forEach(player => {
      this.handStartChips[player.id] = player.chips;
    });
    
    // 【全明牌上帝视角】初始化 omniscientData（稍后在发牌后填充）
    this.omniscientData = { players: {} };
    
    // 重置桌面和玩家状态
    this.table.resetForNewHand();
    
    // 【关键修复】重置并洗牌，确保有 52 张牌
    this.deck.reset();
    if (this.deck.remainingCards() !== 52) {
      console.error(`❌ 牌堆重置失败！剩余牌数: ${this.deck.remainingCards()}，跳过本局`);
      return false; // 安全返回，不崩溃
    }
    this.deck.shuffle();
    
    // 【关键修复】设置阶段为 PRE_FLOP
    this.table.stage = GameStage.PRE_FLOP;
    
    // 【关键修复】发底牌，确保每个玩家都有 2 张牌
    this.dealHoleCards();
    // 【等位过滤】验证 ACTIVE 状态的玩家都有底牌
    for (const player of activePlayers) {
      if (player.hand.length !== 2) {
        console.error(`❌ 发牌失败：${player.name} 有 ${player.hand.length} 张牌而不是 2 张，跳过本局`);
        return false; // 安全返回，不崩溃
      }
    }
    
    this.postBlinds(); // 自动扣除大小盲注
    
    // 【关键修复】设置第一个行动玩家
    const numActivePlayers = activePlayers.length;
    if (numActivePlayers === 2) {
      // 单挑局：庄家（小盲注）先行动
      this.bettingRoundStartPlayer = this.table.dealerPosition;
      this.table.currentPlayerIndex = this.table.dealerPosition;
      // 最后加注者是大盲注玩家
      const bbPlayer = activePlayers.find(p => p.id !== this.table.players[this.table.dealerPosition].id);
      this.lastRaisePlayer = this.table.players.findIndex(p => p.id === bbPlayer.id);
    } else {
      // 多人局：第一个行动玩家是大盲注左边的玩家（UTG 枪口位）
      // Dealer -> Small Blind -> Big Blind -> UTG (first to act)
      this.bettingRoundStartPlayer = (this.table.dealerPosition + 3) % this.table.players.length;
      this.table.currentPlayerIndex = this.bettingRoundStartPlayer;
      // 最后加注者是大盲注玩家
      this.lastRaisePlayer = (this.table.dealerPosition + 2) % this.table.players.length;
    }
    
    console.log(`✅ Hand started successfully: ${activePlayers.length} players, stage: ${this.table.stage}`);
    
    // 【Shot Clock】启动第一个玩家的行动倒计时
    this.startActionTimer();
    
    return this.getGameState();
  }

  /**
   * 发底牌（每人2张）
   * 【等位过滤】只给 ACTIVE 状态的玩家发牌
   */
  dealHoleCards() {
    for (let i = 0; i < 2; i++) {
      for (const player of this.table.players) {
        // 【关键】WAITING 状态的玩家不发牌
        if (player.status === 'ACTIVE' && !player.folded) {
          player.hand.push(this.deck.draw());
        }
      }
    }
    
    // 【全明牌上帝视角】记录所有玩家的初始底牌和位置
    this.table.players.forEach((player, index) => {
      if (player.status === 'ACTIVE' && player.hand.length === 2) {
        this.omniscientData.players[player.id] = {
          name: player.name,
          cards: [...player.hand], // 深拷贝底牌
          position: this.calculatePlayerPosition(index, this.table.dealerPosition, this.table.players.length)
        };
      }
    });
  }

  /**
   * 收取盲注（强制下注）
   * 【关键修复】自动扣除大小盲注，设置 currentBet，更新玩家的 currentBet
   * 【关键修复】单挑局（2人）特殊逻辑：庄家是小盲注，另一人是大盲注
   */
  postBlinds() {
    // 【关键修复】使用 activePlayers 而不是过时的全量玩家索引
    // 【等位过滤】只计算 ACTIVE 状态的玩家
    const activePlayers = this.table.players.filter(p => p.status === 'ACTIVE' && p.chips > 0 && !p.folded);
    const numActivePlayers = activePlayers.length;
    
    if (numActivePlayers < 2) {
      console.error('❌ 没有足够的活跃玩家来扣除盲注，跳过本局');
      return false; // 安全返回，不崩溃
    }
    
    let sbPlayer, bbPlayer;
    
    // 【关键修复】单挑局（2人）特殊逻辑
    if (numActivePlayers === 2) {
      // 单挑局：庄家是小盲注，另一人是大盲注
      const dealerPlayer = this.table.players[this.table.dealerPosition];
      sbPlayer = dealerPlayer;
      bbPlayer = activePlayers.find(p => p.id !== dealerPlayer.id);
      
      console.log(`🎲 Heads-up: Dealer ${sbPlayer.name} posts SB, ${bbPlayer.name} posts BB`);
    } else {
      // 多人局：正常逻辑
      const numPlayers = this.table.players.length;
      const smallBlindPos = (this.table.dealerPosition + 1) % numPlayers;
      const bigBlindPos = (this.table.dealerPosition + 2) % numPlayers;
      
      sbPlayer = this.table.players[smallBlindPos];
      bbPlayer = this.table.players[bigBlindPos];
    }
    
    console.log(`💰 Posting blinds: ${sbPlayer.name} (SB: $${this.table.smallBlind}), ${bbPlayer.name} (BB: $${this.table.bigBlind})`);
    
    // 扣除小盲注
    const sbAmount = sbPlayer.bet(this.table.smallBlind);
    this.table.pot += sbAmount;
    
    // 扣除大盲注
    const bbAmount = bbPlayer.bet(this.table.bigBlind);
    this.table.pot += bbAmount;
    
    // 【关键修复】强制设置桌面当前下注额为大盲注金额（或大盲玩家的实际下注额，如果ALL_IN）
    this.table.currentBet = Math.max(this.table.bigBlind, bbPlayer.currentBet);
    
    console.log(`💰 Pot after blinds: $${this.table.pot}, Current bet: $${this.table.currentBet}`);
    console.log(`💰 SB player bet: $${sbPlayer.currentBet}, BB player bet: $${bbPlayer.currentBet}`);
  }

  /**
   * 处理玩家行动
   * @param {string} playerId - 玩家ID
   * @param {PlayerAction} action - 行动类型
   * @param {number} raiseAmount - 加注金额（仅在RAISE时需要）
   * @param {string} statement - 玩家公共宣言（可选）
   */
  async processPlayerAction(playerId, action, raiseAmount = 0, statement = '') {
    // 【Shot Clock】立即清除倒计时器，玩家已在时限内行动
    this.clearActionTimer();
    
    // 【关键修复】动作门禁：只允许在活跃下注阶段接受玩家动作
    const ACTIVE_BETTING_STAGES = [GameStage.PRE_FLOP, GameStage.FLOP, GameStage.TURN, GameStage.RIVER];
    
    if (!ACTIVE_BETTING_STAGES.includes(this.table.stage)) {
      console.error(`❌ 无法在 ${this.table.stage} 阶段执行动作，只能在 PRE_FLOP/FLOP/TURN/RIVER 阶段下注`);
      return { action: null, gameState: this.getGameState() };
    }
    
    const currentPlayer = this.table.getCurrentPlayer();
    
    if (!currentPlayer || currentPlayer.id !== playerId) {
      console.error(`❌ 不是该玩家的回合: playerId=${playerId}, currentPlayer=${currentPlayer?.id}`);
      return { action: null, gameState: this.getGameState() };
    }

    if (currentPlayer.folded || currentPlayer.allIn) {
      console.error(`❌ 玩家已弃牌或全下，无法行动: ${currentPlayer.name}`);
      return { action: null, gameState: this.getGameState() };
    }

    this.clearPlayerTimeout(playerId);

    // 【公共频道】保存玩家宣言
    if (statement && statement.trim()) {
      currentPlayer.lastStatement = statement.trim();
      console.log(`💬 ${currentPlayer.name}: "${statement.trim()}"`);
    }

    // 【位置计算】获取玩家索引用于位置标签
    const playerIndex = this.table.players.findIndex(p => p.id === currentPlayer.id);

    let actionTaken = null;

    switch (action) {
      case PlayerAction.FOLD:
        currentPlayer.fold();
        actionTaken = { type: PlayerAction.FOLD, player: playerId };
        
        // 【战绩记录中心】记录玩家动作
        this.currentHandActions.push({
          stage: this.table.stage,
          playerName: currentPlayer.name,
          position: this.calculatePlayerPosition(playerIndex, this.table.dealerPosition, this.table.players.length),
          action: PlayerAction.FOLD,
          amount: 0,
          statement: statement || ''
        });
        
        // 【关键修复】立即检查是否只剩一个玩家（不战而胜）
        const winner = this.checkForWinner();
        if (winner) {
          console.log(`🏆 ${winner.name} wins by fold! Pot: $${this.table.pot}`);
          
          // 【财务守恒】记录最终底池（弃牌胜利）- 必须在分配前记录
          this.finalPot = this.table.pot;
          
          winner.winChips(this.table.pot);
          this.table.pot = 0;
          this.table.stage = GameStage.FINISHED;
          this.table.currentPlayerIndex = -1; // 清空当前玩家
          this.clearAllTimeouts();
          
          // 【战报保存】确保提前结束的对局也能生成战报
          await this.cleanupHand();
          
          return {
            action: actionTaken,
            gameState: this.getGameState()
          };
        }
        break;

      case PlayerAction.CHECK:
        if (currentPlayer.currentBet < this.table.currentBet) {
          console.error(`❌ ${currentPlayer.name} 当前有未跟注，无法过牌，自动转为 FOLD`);
          currentPlayer.fold();
          actionTaken = { type: PlayerAction.FOLD, player: playerId };
          this.currentHandActions.push({
            stage: this.table.stage,
            playerName: currentPlayer.name,
            action: PlayerAction.FOLD,
            amount: 0,
            statement: statement || ''
          });
          break;
        }
        actionTaken = { type: PlayerAction.CHECK, player: playerId };
        
        // 【战绩记录中心】记录玩家动作
        this.currentHandActions.push({
          stage: this.table.stage,
          playerName: currentPlayer.name,
          position: this.calculatePlayerPosition(playerIndex, this.table.dealerPosition, this.table.players.length),
          action: PlayerAction.CHECK,
          amount: 0,
          statement: statement || ''
        });
        break;

      case PlayerAction.CALL:
        const callAmount = this.table.currentBet - currentPlayer.currentBet;
        
        // 【筹码溢出修复】严格限制：不能跟注超过剩余筹码
        if (callAmount > currentPlayer.chips) {
          console.log(`⚠️  ${currentPlayer.name} 试图跟注 $${callAmount}，但只剩 $${currentPlayer.chips}，封顶为 ALL_IN`);
        }
        
        const actualCall = currentPlayer.bet(callAmount);
        this.table.pot += actualCall;
        
        // 【关键修复】如果CALL导致ALL_IN，更新桌面currentBet
        if (currentPlayer.allIn && currentPlayer.currentBet > this.table.currentBet) {
          this.table.currentBet = currentPlayer.currentBet;
        }
        
        actionTaken = { 
          type: currentPlayer.allIn ? PlayerAction.ALL_IN : PlayerAction.CALL, 
          player: playerId, 
          amount: actualCall 
        };
        
        // 【战绩记录中心】记录玩家动作
        this.currentHandActions.push({
          stage: this.table.stage,
          playerName: currentPlayer.name,
          position: this.calculatePlayerPosition(playerIndex, this.table.dealerPosition, this.table.players.length),
          action: currentPlayer.allIn ? PlayerAction.ALL_IN : PlayerAction.CALL,
          amount: actualCall,
          statement: statement || ''
        });
        break;

      case PlayerAction.RAISE:
        if (raiseAmount <= 0) {
          console.error(`❌ ${currentPlayer.name} 加注金额必须大于0，自动转为 FOLD`);
          currentPlayer.fold();
          actionTaken = { type: PlayerAction.FOLD, player: playerId };
          this.currentHandActions.push({
            stage: this.table.stage,
            playerName: currentPlayer.name,
            action: PlayerAction.FOLD,
            amount: 0,
            statement: statement || ''
          });
          break;
        }
        
        const totalRaise = this.table.currentBet - currentPlayer.currentBet + raiseAmount;
        
        // 【筹码溢出修复】严格限制：不能加注超过剩余筹码
        if (totalRaise > currentPlayer.chips) {
          console.log(`⚠️  ${currentPlayer.name} 试图加注 $${totalRaise}，但只剩 $${currentPlayer.chips}，封顶为 ALL_IN`);
        }
        
        const actualRaise = currentPlayer.bet(totalRaise);
        this.table.pot += actualRaise;
        
        // 【关键修复】确保桌面currentBet更新为玩家的新注额
        this.table.currentBet = currentPlayer.currentBet;
        this.lastRaisePlayer = this.table.currentPlayerIndex;
        
        actionTaken = { 
          type: currentPlayer.allIn ? PlayerAction.ALL_IN : PlayerAction.RAISE, 
          player: playerId, 
          amount: actualRaise 
        };
        
        // 【战绩记录中心】记录玩家动作
        this.currentHandActions.push({
          stage: this.table.stage,
          playerName: currentPlayer.name,
          position: this.calculatePlayerPosition(playerIndex, this.table.dealerPosition, this.table.players.length),
          action: currentPlayer.allIn ? PlayerAction.ALL_IN : PlayerAction.RAISE,
          amount: actualRaise,
          statement: statement || ''
        });
        break;

      case PlayerAction.ALL_IN:
      case 'ALL_IN':
        // 【ALL_IN 处理】将玩家所有筹码投入底池
        const allInAmount = currentPlayer.chips;
        
        if (allInAmount <= 0) {
          console.error(`❌ ${currentPlayer.name} 筹码为0，无法 ALL_IN，自动转为 FOLD`);
          currentPlayer.fold();
          actionTaken = { type: PlayerAction.FOLD, player: playerId };
          this.currentHandActions.push({
            stage: this.table.stage,
            playerName: currentPlayer.name,
            action: PlayerAction.FOLD,
            amount: 0,
            statement: statement || ''
          });
          break;
        }
        
        const actualAllIn = currentPlayer.bet(allInAmount);
        this.table.pot += actualAllIn;
        
        // 【关键修复】更新桌面 currentBet
        if (currentPlayer.currentBet > this.table.currentBet) {
          this.table.currentBet = currentPlayer.currentBet;
          this.lastRaisePlayer = this.table.currentPlayerIndex;
        }
        
        actionTaken = { 
          type: PlayerAction.ALL_IN, 
          player: playerId, 
          amount: actualAllIn 
        };
        
        // 【战绩记录中心】记录玩家动作
        this.currentHandActions.push({
          stage: this.table.stage,
          playerName: currentPlayer.name,
          action: PlayerAction.ALL_IN,
          amount: actualAllIn,
          statement: statement || ''
        });
        
        console.log(`💰 ${currentPlayer.name} ALL_IN $${actualAllIn}! 当前底池: $${this.table.pot}`);
        break;

      default:
        // 【严禁崩溃】未知动作默认处理为 FOLD，确保服务器不宕机
        console.error(`❌ 未知的动作类型: ${action}，玩家 ${currentPlayer.name} 自动 FOLD`);
        currentPlayer.fold();
        actionTaken = { type: PlayerAction.FOLD, player: playerId };
        
        this.currentHandActions.push({
          stage: this.table.stage,
          playerName: currentPlayer.name,
          action: PlayerAction.FOLD,
          amount: 0,
          statement: statement || ''
        });
    }

    // 【关键修复】在移动到下一个玩家之前，检查是否需要自动推进
    if (this.shouldAutoAdvance()) {
      console.log('⚡ Auto-advancing: No more players can act');
      await this.autoAdvanceToShowdown();
      return {
        action: actionTaken,
        gameState: this.getGameState()
      };
    }

    this.moveToNextPlayer();

    // 【关键修复】移动后再次检查，确保不会卡在全下玩家上
    if (this.shouldAutoAdvance()) {
      console.log('⚡ Auto-advancing after move: No more players can act');
      await this.autoAdvanceToShowdown();
      return {
        action: actionTaken,
        gameState: this.getGameState()
      };
    }

    if (await this.isBettingRoundComplete()) {
      await this.advanceStage();
    } else {
      this.startPlayerTimeout(this.table.getCurrentPlayer());
    }

    // 【Shot Clock】为下一个玩家启动倒计时
    this.startActionTimer();

    return {
      action: actionTaken,
      gameState: this.getGameState()
    };
  }

  /**
   * 检查是否有玩家获胜（只剩一个未弃牌的玩家）
   */
  checkForWinner() {
    // 【等位过滤】只计算 ACTIVE 状态的玩家
    const activePlayers = this.table.players.filter(p => p.status === 'ACTIVE' && !p.folded);
    
    if (activePlayers.length === 1) {
      return activePlayers[0];
    }
    
    return null;
  }

  /**
   * 清除所有超时计时器
   */
  clearAllTimeouts() {
    this.table.players.forEach(p => this.clearPlayerTimeout(p.id));
  }

  /**
   * 移动到下一个玩家（严格跳过已弃牌和全下的玩家）
   */
  moveToNextPlayer() {
    let attempts = 0;
    const maxAttempts = this.table.players.length;
    
    do {
      this.table.currentPlayerIndex = (this.table.currentPlayerIndex + 1) % this.table.players.length;
      attempts++;
      
      if (attempts >= maxAttempts) {
        console.warn('⚠️  Cannot find next active player, all players are folded or all-in');
        break;
      }
      
      const currentPlayer = this.table.players[this.table.currentPlayerIndex];
      
      // 严格检查：只有未弃牌且未全下的玩家才能行动
      if (!currentPlayer.folded && !currentPlayer.allIn) {
        break;
      }
    } while (true);
  }

  /**
   * 判断当前下注轮是否结束
   */
  async isBettingRoundComplete() {
    // 【等位过滤】只计算 ACTIVE 状态的玩家
    const activePlayers = this.table.players.filter(p => p.status === 'ACTIVE' && !p.folded && !p.allIn);
    
    // 如果没有活跃玩家（全部弃牌或全下），立即结束
    if (activePlayers.length === 0) {
      return true;
    }

    // 如果只有1个活跃玩家，立即结束
    if (activePlayers.length === 1) {
      return true;
    }

    // 检查所有活跃玩家的注码是否相等
    const allBetsEqual = activePlayers.every(p => p.currentBet === this.table.currentBet);
    
    if (!allBetsEqual) {
      return false;
    }

    // 所有活跃玩家注码相等，检查是否每个人都行动过
    if (this.lastRaisePlayer === -1) {
      return this.table.currentPlayerIndex === this.bettingRoundStartPlayer;
    }

    return this.table.currentPlayerIndex === this.lastRaisePlayer;

// 【关键修复】在移动到下一个玩家之前，检查是否需要自动推进
if (this.shouldAutoAdvance()) {
  console.log('⚡ Auto-advancing: No more players can act');
  await this.autoAdvanceToShowdown();
  return {
    action: actionTaken,
    gameState: this.getGameState()
  };
}

this.moveToNextPlayer();

// 【关键修复】移动后再次检查，确保不会卡在全下玩家上
if (this.shouldAutoAdvance()) {
  console.log('⚡ Auto-advancing after move: No more players can act');
  await this.autoAdvanceToShowdown();
  return {
    action: actionTaken,
    gameState: this.getGameState()
  };
}

if (await this.isBettingRoundComplete()) {
  await this.advanceStage();
} else {
  this.startPlayerTimeout(this.table.getCurrentPlayer());
}

// 【Shot Clock】为下一个玩家启动倒计时
this.startActionTimer();

return {
  action: actionTaken,
  gameState: this.getGameState()
};
}

/**
 * 检查是否有玩家获胜（只剩一个未弃牌的玩家）
 */
checkForWinner() {
  const activePlayers = this.table.players.filter(p => !p.folded);
  
  if (activePlayers.length === 1) {
    return activePlayers[0];
  }
  
  return null;
}

/**
 * 清除所有超时计时器
 */
clearAllTimeouts() {
  this.table.players.forEach(p => this.clearPlayerTimeout(p.id));
}

/**
 * 移动到下一个玩家（严格跳过已弃牌和全下的玩家）
 */
moveToNextPlayer() {
  let attempts = 0;
  const maxAttempts = this.table.players.length;
  
  do {
    this.table.currentPlayerIndex = (this.table.currentPlayerIndex + 1) % this.table.players.length;
    attempts++;
    
    if (attempts >= maxAttempts) {
      console.warn('⚠️  Cannot find next active player, all players are folded or all-in');
      break;
    }
    
    const currentPlayer = this.table.players[this.table.currentPlayerIndex];
    
    // 严格检查：只有未弃牌且未全下的玩家才能行动
    if (!currentPlayer.folded && !currentPlayer.allIn) {
      break;
    }
  } while (true);
}

/**
 * 判断当前下注轮是否结束
 */
isBettingRoundComplete() {
  const activePlayers = this.table.players.filter(p => !p.folded && !p.allIn);
  
  // 如果没有活跃玩家（全部弃牌或全下），立即结束
  if (activePlayers.length === 0) {
    return true;
  }

  // 如果只有1个活跃玩家，立即结束
  if (activePlayers.length === 1) {
    return true;
  }

  // 检查所有活跃玩家的注码是否相等
  const allBetsEqual = activePlayers.every(p => p.currentBet === this.table.currentBet);
  
  if (!allBetsEqual) {
    return false;
  }

  // 所有活跃玩家注码相等，检查是否每个人都行动过
  if (this.lastRaisePlayer === -1) {
    return this.table.currentPlayerIndex === this.bettingRoundStartPlayer;
  }

  return this.table.currentPlayerIndex === this.lastRaisePlayer;
}

/**
 * 推进到下一个游戏阶段
 */
async advanceStage() {
  const nextStage = STAGE_TRANSITION[this.table.stage];
  
  if (!nextStage) {
    console.error(`无效的阶段转换: ${this.table.stage}`);
    return;
  }
  
  this.table.stage = nextStage;

  this.table.players.forEach(player => {
    player.currentBet = 0;
  });
  this.table.currentBet = 0;
  this.lastRaisePlayer = -1;

  // 检查是否需要自动推进到摊牌
  const shouldFastForward = this.shouldFastForwardToShowdown();

  switch (nextStage) {
    case GameStage.FLOP:
      this.deck.draw();
      this.table.communityCards.push(...this.deck.drawMultiple(3));
      if (shouldFastForward) {
        console.log('⚡ Fast-forwarding: All players all-in, skipping to next stage');
        await this.advanceStage();
      } else {
        this.startNewBettingRound();
      }
      break;

    case GameStage.TURN:
      this.deck.draw();
      this.table.communityCards.push(this.deck.draw());
      if (shouldFastForward) {
        console.log('⚡ Fast-forwarding: All players all-in, skipping to next stage');
        await this.advanceStage();
      } else {
        this.startNewBettingRound();
      }
      break;

    case GameStage.RIVER:
      this.deck.draw();
      this.table.communityCards.push(this.deck.draw());
      if (shouldFastForward) {
        console.log('⚡ Fast-forwarding: All players all-in, going to showdown');
        await this.advanceStage();
      } else {
        this.startNewBettingRound();
      }
      break;

    case GameStage.SHOWDOWN:
      // 【关键修复】SHOWDOWN 是结算阶段，不能有行动玩家
      this.table.currentPlayerIndex = -1;
      this.clearAllTimeouts();
      this.performShowdown();
      // 立即推进到 FINISHED
      this.table.stage = GameStage.FINISHED;
      await this.cleanupHand();
      break;

    case GameStage.FINISHED:
      await this.cleanupHand();
      break;
  }
}

/**
 * 检查是否应该自动推进（没有玩家可以继续行动）
 */
shouldAutoAdvance() {
  // 【等位过滤】只计算 ACTIVE 状态的玩家
  const activePlayers = this.table.players.filter(p => p.status === 'ACTIVE' && !p.folded);
  
  // 如果只有1个或0个活跃玩家，游戏应该结束
  if (activePlayers.length <= 1) {
    return true;
  }
  
  // 检查能够行动的玩家数量（未弃牌且未全下）
  const playersCanAct = activePlayers.filter(p => !p.allIn);
  
  // 如果没有玩家可以行动，或只有1个玩家可以行动（其他都全下），需要自动推进
  if (playersCanAct.length <= 1) {
    return true;
  }
  
  return false;
}

/**
 * 检查是否应该快进到摊牌（所有未弃牌玩家都已全下）
 */
shouldFastForwardToShowdown() {
  // 【等位过滤】只计算 ACTIVE 状态的玩家
  const activePlayers = this.table.players.filter(p => p.status === 'ACTIVE' && !p.folded);
  
  // 如果只有1个或0个活跃玩家，不需要快进（游戏已经结束）
  if (activePlayers.length <= 1) {
    return false;
  }
  
  // 检查是否所有活跃玩家都已全下
  const allPlayersAllIn = activePlayers.every(p => p.allIn);
  
  return allPlayersAllIn;
}

/**
 * 自动推进到摊牌（发完所有公共牌并结算）
 */
async autoAdvanceToShowdown() {
  console.log('🚀 Auto-advancing to showdown...');
  
  // 再次检查是否有玩家获胜（可能在推进过程中有人弃牌）
  const winner = this.checkForWinner();
  if (winner) {
    console.log(`🏆 ${winner.name} wins! Pot: $${this.table.pot}`);
    
    // 【财务守恒】记录最终底池（全部全下）- 必须在分配前记录
    this.finalPot = this.table.pot;
    
    winner.winChips(this.table.pot);
    this.table.pot = 0;
    this.table.stage = GameStage.FINISHED;
    this.table.currentPlayerIndex = -1; // 清空当前玩家
    this.clearAllTimeouts();
    
    // 【战报保存】确保提前结束的对局也能生成战报
    await this.cleanupHand();
    return;
  }
  
  // 清除所有超时
  this.clearAllTimeouts();
  
  // 根据当前阶段，发完所有剩余的公共牌
  while (this.table.stage !== GameStage.SHOWDOWN && this.table.stage !== GameStage.FINISHED) {
    const nextStage = STAGE_TRANSITION[this.table.stage];
    
    if (!nextStage) {
      console.error('无效的阶段转换');
      break;
    }
    
    this.table.stage = nextStage;
    this.table.players.forEach(player => {
      player.currentBet = 0;
    });
    this.table.currentBet = 0;
    this.lastRaisePlayer = -1;
    
    switch (nextStage) {
      case GameStage.FLOP:
        if (this.table.communityCards.length === 0) {
          this.deck.draw(); // burn card
          this.table.communityCards.push(...this.deck.drawMultiple(3));
          console.log('⚡ Auto-dealt FLOP:', this.table.communityCards.slice(-3).join(' '));
        }
        break;
        
      case GameStage.TURN:
        if (this.table.communityCards.length === 3) {
          this.deck.draw(); // burn card
          this.table.communityCards.push(this.deck.draw());
          console.log('⚡ Auto-dealt TURN:', this.table.communityCards[3]);
        }
        break;
        
      case GameStage.RIVER:
        if (this.table.communityCards.length === 4) {
          this.deck.draw(); // burn card
          this.table.communityCards.push(this.deck.draw());
          console.log('⚡ Auto-dealt RIVER:', this.table.communityCards[4]);
        }
        break;
        
      case GameStage.SHOWDOWN:
        console.log('⚡ Performing showdown...');
        this.table.currentPlayerIndex = -1; // 清空行动玩家
        this.performShowdown();
        // 立即推进到 FINISHED
        this.table.stage = GameStage.FINISHED;
        this.cleanupHand();
        return;
        
      case GameStage.FINISHED:
        this.cleanupHand();
        return;
    }
  }
}

/**
 * 开始新的下注轮（找到第一个有效的行动玩家）
 */
async startNewBettingRound() {
  // 【关键修复】在开始新下注轮之前，先检查是否有玩家获胜
  const winner = this.checkForWinner();
  if (winner) {
    console.log(`🏆 ${winner.name} wins! Pot: $${this.table.pot}`);
    winner.winChips(this.table.pot);
    this.table.pot = 0;
    this.table.stage = GameStage.FINISHED;
    this.table.currentPlayerIndex = -1; // 清空当前玩家
    this.clearAllTimeouts();
    return;
  }
  
  // 检查是否需要自动推进到摊牌
  if (this.shouldAutoAdvance()) {
    console.log('⚡ Auto-advancing at start of betting round: No players can act');
    await this.autoAdvanceToShowdown();
    return;
  }
  
  // 从小盲位置开始寻找第一个有效玩家
  this.bettingRoundStartPlayer = (this.table.dealerPosition + 1) % this.table.players.length;
  this.table.currentPlayerIndex = this.bettingRoundStartPlayer;
  
  let attempts = 0;
  const maxAttempts = this.table.players.length;
  
  // 严格跳过已弃牌和全下的玩家
  while (attempts < maxAttempts) {
    const currentPlayer = this.table.players[this.table.currentPlayerIndex];
    
    // 找到第一个可以行动的玩家
    if (!currentPlayer.folded && !currentPlayer.allIn) {
      break;
    }
    
    this.table.currentPlayerIndex = (this.table.currentPlayerIndex + 1) % this.table.players.length;
    attempts++;
  }
  
  // 如果找不到可以行动的玩家，说明所有人都全下或弃牌了
  if (attempts >= maxAttempts) {
    console.log('⚡ No active players for betting, auto-advancing to showdown');
    await this.autoAdvanceToShowdown();
    return;
  }

  this.startPlayerTimeout(this.table.getCurrentPlayer());
  
  // 【Shot Clock】为新下注轮的第一个玩家启动倒计时
  this.startActionTimer();
}

/**
 * 计算边池（Side Pots）
   * 当多个玩家 All-In 时，需要根据每个玩家的总投入金额计算多个底池
   */
  calculateSidePots() {
    // 【等位过滤】只计算 ACTIVE 状态的玩家
    const activePlayers = this.table.players.filter(p => p.status === 'ACTIVE' && !p.folded);
    
    // 记录每个玩家的整局总投入
    const playerContributions = activePlayers.map(p => ({
      player: p,
      totalBet: p.totalBetThisHand,
      eligible: true
    }));
    
    // 按投入金额排序（从小到大）
    playerContributions.sort((a, b) => a.totalBet - b.totalBet);
    
    const pots = [];
    let remainingPlayers = [...playerContributions];
    
    while (remainingPlayers.length > 0 && remainingPlayers.some(p => p.totalBet > 0)) {
      const smallestBet = remainingPlayers[0].totalBet;
      
      if (smallestBet === 0) {
        remainingPlayers.shift();
        continue;
      }
      
      let potAmount = 0;
      const eligiblePlayers = [];
      
      // 计算这个底池的金额和合格玩家
      remainingPlayers.forEach(p => {
        potAmount += smallestBet;
        p.totalBet -= smallestBet;
        eligiblePlayers.push(p.player);
      });
      
      pots.push({
        amount: potAmount,
        eligiblePlayers: eligiblePlayers
      });
      
      // 移除已经投入为 0 的玩家
      remainingPlayers = remainingPlayers.filter(p => p.totalBet > 0);
    }
    
    return pots;
  }

  /**
   * 执行摊牌比大小（支持边池）
   * 注意：这个方法只负责比牌和分配筹码，不负责状态转换
   */
  performShowdown() {
    console.log('\n' + '='.repeat(60));
    console.log('🎲 摊牌时刻 (SHOWDOWN)');
    console.log('='.repeat(60));
    
    // 【财务守恒】在分配底池前，先记录最终底池值
    this.finalPot = this.table.pot;
    
    // 【等位过滤】只计算 ACTIVE 状态的玩家
    const activePlayers = this.table.players.filter(p => p.status === 'ACTIVE' && !p.folded);
    
    // 特殊情况：只有1个玩家，直接赢得所有底池
    if (activePlayers.length === 1) {
      console.log(`\n🏆 ${activePlayers[0].name} wins pot: $${this.table.pot}`);
      activePlayers[0].winChips(this.table.pot);
      this.table.pot = 0;
      console.log('='.repeat(60) + '\n');
      return;
    }
    
    // 【摊牌日志】显示完整的5张公共牌
    console.log(`\n🎴 公共牌 (Community Cards): ${this.table.communityCards.join(' ')}`);
    
    // 【摊牌日志】显示每个玩家的底牌
    console.log('\n👥 玩家底牌 (Player Hands):');
    activePlayers.forEach(player => {
      console.log(`   ${player.name}: ${player.hand.join(' ')} (筹码: $${player.chips})`);
    });

    // 计算所有玩家的手牌强度
    const hands = activePlayers.map(player => ({
      player,
      hand: Hand.solve([...player.hand, ...this.table.communityCards])
    }));

    // 计算边池
    const sidePots = this.calculateSidePots();
    
    console.log(`🎲 Showdown with ${sidePots.length} pot(s)`);
    
    // 【摊牌日志】显示底池分配
    console.log(`\n💰 底池分配 (Pot Distribution):`);
    console.log(`   总底池: $${this.table.pot}`);
    console.log(`   边池数量: ${sidePots.length}`);
    
    // 为每个底池找到赢家并分配筹码
    sidePots.forEach((pot, index) => {
      // 过滤出这个底池的合格玩家
      const eligibleHands = hands.filter(h => pot.eligiblePlayers.includes(h.player));
      
      if (eligibleHands.length === 0) {
        console.warn(`⚠️  No eligible players for pot ${index + 1}`);
        return;
      }
      
      // 找到赢家
      const winners = Hand.winners(eligibleHands.map(h => h.hand));
      const winningPlayers = eligibleHands.filter(h => winners.includes(h.hand)).map(h => h.player);
      
      // 获取赢家的牌型描述
      const winningHand = eligibleHands.find(h => winners.includes(h.hand))?.hand;
      const handDescription = winningHand ? winningHand.descr : 'Unknown';
      
      // 分配底池
      const potShare = Math.floor(pot.amount / winningPlayers.length);
      
      console.log(`\n   🏆 底池 #${index + 1} ($${pot.amount}):`);
      console.log(`      赢家: ${winningPlayers.map(p => p.name).join(', ')}`);
      console.log(`      牌型: ${handDescription}`);
      console.log(`      每人获得: $${potShare}`);
      
      winningPlayers.forEach(player => {
        player.winChips(potShare);
      });
      
      // 处理余数（如果有）
      const remainder = pot.amount % winningPlayers.length;
      if (remainder > 0) {
        console.log(`      余数 $${remainder} 分配给 ${winningPlayers[0].name}`);
        winningPlayers[0].winChips(remainder);
      }
    });
    
    this.table.pot = 0;
    
    // 【摊牌日志】显示最终筹码
    console.log(`\n💵 最终筹码 (Final Chips):`);
    this.table.players.forEach(player => {
      console.log(`   ${player.name}: $${player.chips}`);
    });
    
    console.log('\n✅ 摊牌完成 (Showdown Complete)');
    console.log('='.repeat(60) + '\n');
  }

  /**
   * 清理本局游戏
   * 【关键修复】不在这里顺延庄家，由 startNewHand 负责
   */
  async cleanupHand() {
    // 【银行系统】战后结算：将所有玩家的筹码同步回数据库
    await this.syncChipsToDatabase();
    
    // 【战绩记录中心】保存本局完整战报到数据库
    await this.saveHandHistory();
    
    // 【破产清道夫】检查并移除破产玩家
    this.removeBankruptPlayers();
    
    // 清除所有超时计时器
    this.actionTimeouts.forEach(timeout => clearTimeout(timeout));
    this.actionTimeouts.clear();
    
    // 清除 Shot Clock 倒计时器
    this.clearActionTimer();
    
    // 【自动连环开局】5 秒后自动开始下一局
    console.log('⏰ 5 秒后自动开始下一局...');
    setTimeout(() => {
      // 检查是否还有足够的玩家
      if (this.table.players.length >= 2) {
        console.log(`🔄 自动开始下一局 (当前 ${this.table.players.length} 名玩家)`);
        this.startNewHand();
      } else {
        console.log(`⏸️  玩家不足 (${this.table.players.length}/2)，退回等待状态`);
        this.table.stage = 'WAITING';
      }
    }, 5000);
  }

  /**
   * 【战绩记录中心】保存本局完整战报到数据库
   */
  async saveHandHistory() {
    try {
      // 如果没有记录到任何动作，说明这局可能异常，不保存
      if (!this.currentHandActions || this.currentHandActions.length === 0) {
        console.log('⚠️  本局无动作记录，跳过战报保存');
        return;
      }

      console.log('\n📊 战绩记录中心：打包本局战报...');

      // 计算每个玩家的净利润
      const playersData = this.table.players.map(player => {
        const startChips = this.handStartChips[player.id] || player.chips;
        const endChips = player.chips;
        const netProfit = endChips - startChips;

        return {
          id: player.id,
          name: player.name,
          startChips,
          endChips,
          netProfit
        };
      });

      // 准备战报数据
      const handHistoryData = {
        roomId: this.table.id, // 房间ID
        potSize: this.finalPot || 0, // 【财务守恒】使用分配前的最终底池值
        communityCards: JSON.stringify(this.table.communityCards || []),
        players: JSON.stringify(playersData),
        actions: JSON.stringify(this.currentHandActions),
        omniscientData: this.omniscientData || { players: {} } // 【全明牌上帝视角】所有玩家的初始底牌和位置
      };

      // 写入数据库
      await prisma.handHistory.create({
        data: handHistoryData
      });

      console.log(`📊 战报已保存：房间 [${this.table.id}], ${playersData.length} 名玩家, ${this.currentHandActions.length} 个动作`);
      console.log(`💰 本局最终底池: $${this.finalPot}`);
      console.log('📊 战绩记录中心：保存完成！\n');

    } catch (error) {
      console.error('❌ 保存战报失败:', error.message);
      // 不抛出错误，避免影响游戏流程
    }
  }

  /**
   * 【破产清道夫】移除筹码不足以支付大盲注的玩家
   * 在战后结算后调用，确保破产玩家被强制踢出房间
   * 【修复】豁免尚未参与任何一局的新入座玩家
   */
  removeBankruptPlayers() {
    const minChips = this.table.bigBlind;
    
    // 【关键修复】只检查已经参与过至少一局游戏的玩家
    // 新入座玩家的 buyIn 还未转化为 chips，不应被驱逐
    const bankruptPlayers = this.table.players.filter(p => {
      // 如果玩家从未参与过任何一局（handStartChips 中没有记录），豁免
      const hasPlayedBefore = this.handStartChips.hasOwnProperty(p.id);
      if (!hasPlayedBefore) {
        return false; // 新玩家豁免
      }
      
      // 已参与过游戏的玩家，检查筹码是否低于大盲注
      return p.chips < minChips;
    });
    
    if (bankruptPlayers.length > 0) {
      console.log('\n💸 破产清道夫启动...');
      
      bankruptPlayers.forEach(player => {
        console.log(`💀 [驱逐] 玩家 ${player.name} 破产，已移出房间 ${this.table.id} (筹码: $${player.chips} < 大盲注: $${minChips})`);
        
        // 广播系统事件（可以被前端或其他监听器捕获）
        this.broadcastSystemEvent({
          type: 'PLAYER_BANKRUPTCY',
          playerId: player.id,
          playerName: player.name,
          roomId: this.table.id,
          message: `玩家 ${player.name} 破产，已移出房间 ${this.table.id}`
        });
      });
      
      // 从玩家列表中移除破产玩家
      this.table.players = this.table.players.filter(p => {
        const hasPlayedBefore = this.handStartChips.hasOwnProperty(p.id);
        if (!hasPlayedBefore) return true; // 新玩家保留
        return p.chips >= minChips;
      });
      
      console.log(`💸 已清理 ${bankruptPlayers.length} 名破产玩家，当前剩余 ${this.table.players.length} 名玩家\n`);
      
      // 【垃圾回收】如果房间已空，通知 RoomManager 删除该房间
      if (this.table.players.length === 0 && this.onPlayerRemoved) {
        this.onPlayerRemoved(this.table.id);
      }
    }
  }

  /**
   * 广播系统事件（可扩展用于 WebSocket 或事件总线）
   */
  broadcastSystemEvent(event) {
    // 当前实现：仅记录到游戏状态
    // 未来可扩展：通过 WebSocket 推送给所有客户端
    if (!this.systemEvents) {
      this.systemEvents = [];
    }
    
    this.systemEvents.push({
      ...event,
      timestamp: Date.now()
    });
    
    // 保留最近 10 条系统事件
    if (this.systemEvents.length > 10) {
      this.systemEvents.shift();
    }
  }

  /**
   * 【银行系统】将所有玩家的筹码同步回数据库
   * 在每局结束后调用，确保筹码持久化
   */
  async syncChipsToDatabase() {
    try {
      console.log('\n💾 战后结算：同步筹码到数据库...');
      
      for (const player of this.table.players) {
        try {
          await prisma.agent.update({
            where: { id: player.id },
            data: { balance: player.chips }
          });
          console.log(`  ✅ ${player.name}: $${player.chips} 已保存`);
        } catch (error) {
          console.error(`  ⚠️  ${player.name} 筹码同步失败:`, error.message);
        }
      }
      
      console.log('💾 筹码同步完成！\n');
    } catch (error) {
      console.error('⚠️  数据库同步失败:', error);
    }
  }

  /**
   * 启动玩家行动超时计时器
   * @param {Player} player
   */
  startPlayerTimeout(player) {
    if (!player) return;

    const timeoutId = setTimeout(() => {
      console.log(`玩家 ${player.id} 超时，自动弃牌`);
      try {
        this.processPlayerAction(player.id, PlayerAction.FOLD);
      } catch (error) {
        console.error('处理超时弃牌时出错:', error);
      }
    }, this.defaultTimeout);

    this.actionTimeouts.set(player.id, timeoutId);
  }

  /**
   * 清除玩家超时计时器
   * @param {string} playerId
   */
  clearPlayerTimeout(playerId) {
    const timeoutId = this.actionTimeouts.get(playerId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.actionTimeouts.delete(playerId);
    }
  }

  /**
   * 设置超时时长
   * @param {number} milliseconds
   */
  setActionTimeout(milliseconds) {
    this.defaultTimeout = milliseconds;
  }

  /**
   * 启动 Shot Clock 倒计时器
   * 当前玩家必须在 15 秒内行动，否则自动强制执行 FOLD 或 CHECK
   */
  startActionTimer() {
    // 清除旧计时器
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }

    const currentPlayer = this.table.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.folded || currentPlayer.allIn) {
      this.actionDeadline = null;
      return;
    }

    // 设置截止时间
    this.actionDeadline = Date.now() + ACTION_TIMEOUT_MS;

    // 启动倒计时器
    this.actionTimer = setTimeout(() => {
      console.log(`⏰ Shot Clock 超时！玩家 ${currentPlayer.name} 未在 15 秒内行动`);
      
      try {
        // 计算需要跟注的金额
        const callAmount = this.table.currentBet - currentPlayer.currentBet;
        
        // 超时惩罚逻辑
        let forcedAction;
        let forcedStatement;
        
        if (callAmount > 0) {
          // 需要跟注 -> 强制 FOLD
          forcedAction = PlayerAction.FOLD;
          forcedStatement = '【系统警告】CPU过载，已强制超时弃牌！';
          console.log(`⚠️  强制执行 FOLD (需跟注 $${callAmount})`);
        } else {
          // 不需要跟注 -> 强制 CHECK
          forcedAction = PlayerAction.CHECK;
          forcedStatement = '【系统警告】CPU过载，已强制超时过牌！';
          console.log(`⚠️  强制执行 CHECK`);
        }

        // 执行强制动作
        this.processPlayerAction(currentPlayer.id, forcedAction, 0, forcedStatement);
      } catch (error) {
        console.error('⚠️  处理超时动作时出错:', error);
      }
    }, ACTION_TIMEOUT_MS);

    console.log(`⏱️  Shot Clock 已启动：${currentPlayer.name} 有 90 秒行动时间`);
  }

  /**
   * 清除 Shot Clock 倒计时器
   */
  clearActionTimer() {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    this.actionDeadline = null;
  }

  /**
   * 动态位置分配器 - 根据存活玩家数动态分配德扑位置
   * @param {number} playerIndex - 玩家在座位上的索引
   * @param {number} dealerIndex - 庄家位置索引
   * @param {number} totalPlayers - 总玩家数
   * @returns {string} 位置标签
   */
  calculatePlayerPosition(playerIndex, dealerIndex, totalPlayers) {
    // 计算相对于庄家的位置偏移
    const offset = (playerIndex - dealerIndex + totalPlayers) % totalPlayers;
    
    // 2人局（Heads-Up）特例：庄家同时是小盲
    if (totalPlayers === 2) {
      return offset === 0 ? 'BTN/SB' : 'BB';
    }
    
    // 3-9人局的位置映射（从BTN往前倒推：CO, HJ, MP, UTG）
    const positionMap = {
      3: ['BTN', 'SB', 'BB'],
      4: ['CO', 'BTN', 'SB', 'BB'],
      5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
      6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
      7: ['UTG', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
      8: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
      9: ['UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB']
    };
    
    // 如果玩家数超过9人或小于2人，返回座位号
    if (totalPlayers < 2 || totalPlayers > 9) {
      return `SEAT ${offset + 1}`;
    }
    
    return positionMap[totalPlayers]?.[offset] || `SEAT ${offset + 1}`;
  }

  /**
   * 获取当前游戏状态（用于返回给Agent）
   */
  getGameState() {
    const currentPlayer = this.table.getCurrentPlayer();
    
    return {
      tableId: this.table.id,
      stage: this.table.stage,
      pot: this.table.pot,
      currentBet: this.table.currentBet,
      communityCards: this.table.communityCards,
      currentPlayer: currentPlayer ? currentPlayer.id : null,
      actionDeadline: this.actionDeadline, // Shot Clock 截止时间戳
      turnTimeout: ACTION_TIMEOUT_MS, // 超时时长（90000ms）
      turnStartTime: this.actionDeadline ? this.actionDeadline - ACTION_TIMEOUT_MS : null, // 回合开始时间
      players: this.table.players.map((p, index) => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        currentBet: p.currentBet,
        totalBetThisHand: p.totalBetThisHand,
        folded: p.folded,
        allIn: p.allIn,
        hand: p.hand,
        lastStatement: p.lastStatement || '',
        position: this.calculatePlayerPosition(index, this.table.dealerPosition, this.table.players.length)
      })),
      dealerPosition: this.table.dealerPosition
    };
  }

  /**
   * 获取玩家视角的游戏状态（隐藏其他玩家手牌）
   * @param {string} playerId
   */
  getPlayerView(playerId) {
    const state = this.getGameState();
    
    state.players = state.players.map(p => {
      if (p.id !== playerId) {
        return {
          ...p,
          hand: p.folded ? [] : ['**', '**']
        };
      }
      return p;
    });
    
    return state;
  }
}
