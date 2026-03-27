/**
 * Player.js - 玩家数据模型
 */

export class Player {
  constructor(id, name, chips = 1000) {
    this.id = id;
    this.name = name;
    this.chips = chips;
    this.hand = [];
    this.currentBet = 0;
    this.totalBetThisHand = 0; // 整局累计投入（用于边池计算）
    this.folded = false;
    this.allIn = false;
    this.lastStatement = ''; // 玩家最后一次发表的公共宣言
    this.status = 'ACTIVE'; // 'ACTIVE' 或 'WAITING' - 中途加入者需等待下一局
  }

  /**
   * 重置玩家状态（新一局开始时）
   */
  resetForNewHand() {
    this.hand = [];
    this.currentBet = 0;
    this.totalBetThisHand = 0;
    this.folded = false;
    this.allIn = false;
    this.lastStatement = ''; // 清空宣言
  }

  /**
   * 下注
   * @param {number} amount
   */
  bet(amount) {
    const actualBet = Math.min(amount, this.chips);
    this.chips -= actualBet;
    this.currentBet += actualBet;
    this.totalBetThisHand += actualBet; // 累计整局投入
    
    if (this.chips === 0) {
      this.allIn = true;
    }
    
    return actualBet;
  }

  /**
   * 弃牌
   */
  fold() {
    this.folded = true;
  }

  /**
   * 赢得筹码
   * @param {number} amount
   */
  winChips(amount) {
    this.chips += amount;
  }
}
