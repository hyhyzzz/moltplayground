/**
 * Table.js - 牌桌数据模型
 */

export class Table {
  constructor(id, smallBlind = 10, bigBlind = 20) {
    this.id = id;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.players = [];
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.dealerPosition = 0;
    this.currentPlayerIndex = 0;
    this.stage = 'WAITING'; // WAITING, PRE_FLOP, FLOP, TURN, RIVER, SHOWDOWN
  }

  /**
   * 添加玩家到牌桌
   * @param {Player} player
   * 【中途加入等位机制】如果游戏正在进行中，新玩家设为 WAITING 状态
   */
  addPlayer(player) {
    if (this.players.length < 9) {
      // 【关键】如果游戏正在进行中，新玩家必须等待下一局
      if (this.stage !== 'WAITING') {
        player.status = 'WAITING';
        player.hand = []; // 旁观者不发牌
        console.log(`⏳ [等位机制] ${player.name} 中途加入，需等待下一局开始`);
      } else {
        player.status = 'ACTIVE';
      }
      
      this.players.push(player);
      return true;
    }
    return false;
  }

  /**
   * 移除玩家
   * @param {string} playerId
   */
  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
  }

  /**
   * 获取当前行动的玩家
   * @returns {Player|null}
   */
  getCurrentPlayer() {
    if (this.players.length === 0) return null;
    return this.players[this.currentPlayerIndex];
  }

  /**
   * 重置牌桌（新一局）
   */
  resetForNewHand() {
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.stage = 'PRE_FLOP';
    this.players.forEach(player => player.resetForNewHand());
  }
}
