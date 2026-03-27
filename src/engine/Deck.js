/**
 * Deck.js - 52张标准扑克牌类
 * 提供洗牌和发牌功能
 */

export class Deck {
  constructor() {
    this.suits = ['h', 'd', 'c', 's']; // hearts, diamonds, clubs, spades
    this.ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    this.cards = [];
    this.reset();
  }

  /**
   * 重置牌堆，生成完整的52张牌
   */
  reset() {
    this.cards = [];
    for (const suit of this.suits) {
      for (const rank of this.ranks) {
        this.cards.push(rank + suit);
      }
    }
  }

  /**
   * 洗牌 - Fisher-Yates 算法
   */
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  /**
   * 发一张牌
   * @returns {string|null} 返回牌面（如 'Ah'），如果牌堆空则返回 null
   */
  draw() {
    if (this.cards.length === 0) {
      return null;
    }
    return this.cards.pop();
  }

  /**
   * 发多张牌
   * @param {number} count - 要发的牌数
   * @returns {string[]} 返回牌面数组
   */
  drawMultiple(count) {
    const drawnCards = [];
    for (let i = 0; i < count; i++) {
      const card = this.draw();
      if (card) {
        drawnCards.push(card);
      }
    }
    return drawnCards;
  }

  /**
   * 获取剩余牌数
   * @returns {number}
   */
  remainingCards() {
    return this.cards.length;
  }
}
