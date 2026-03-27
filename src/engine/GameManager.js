/**
 * GameManager.js - 管理多个游戏桌的管理器
 */

import { Table } from '../models/Table.js';
import { Player } from '../models/Player.js';
import { GameEngine } from './GameEngine.js';

export class GameManager {
  constructor() {
    this.tables = new Map();
    this.engines = new Map();
    this.playerTableMap = new Map();
  }

  /**
   * 创建新牌桌
   * @param {string} tableId - 牌桌ID
   * @param {number} smallBlind - 小盲注
   * @param {number} bigBlind - 大盲注
   * @returns {Object} 牌桌信息
   */
  createTable(tableId, smallBlind = 10, bigBlind = 20) {
    if (this.tables.has(tableId)) {
      throw new Error(`牌桌 ${tableId} 已存在`);
    }

    const table = new Table(tableId, smallBlind, bigBlind);
    const engine = new GameEngine(table);

    this.tables.set(tableId, table);
    this.engines.set(tableId, engine);

    return {
      tableId: table.id,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      playerCount: 0,
      stage: table.stage
    };
  }

  /**
   * 玩家加入牌桌
   * @param {string} tableId - 牌桌ID
   * @param {string} playerId - 玩家ID
   * @param {string} playerName - 玩家名称
   * @param {number} buyIn - 买入筹码
   * @returns {Object} 加入结果
   */
  joinTable(tableId, playerId, playerName, buyIn = 1000) {
    const table = this.tables.get(tableId);
    if (!table) {
      throw new Error(`牌桌 ${tableId} 不存在`);
    }

    if (this.playerTableMap.has(playerId)) {
      throw new Error(`玩家 ${playerId} 已在其他牌桌`);
    }

    const player = new Player(playerId, playerName, buyIn);
    const success = table.addPlayer(player);

    if (!success) {
      throw new Error('牌桌已满（最多9人）');
    }

    this.playerTableMap.set(playerId, tableId);

    if (table.players.length >= 2 && table.stage === 'WAITING') {
      const engine = this.engines.get(tableId);
      engine.startNewHand();
    }

    return {
      success: true,
      playerId,
      tableId,
      chips: buyIn,
      playerCount: table.players.length
    };
  }

  /**
   * 玩家离开牌桌
   * @param {string} playerId - 玩家ID
   */
  leaveTable(playerId) {
    const tableId = this.playerTableMap.get(playerId);
    if (!tableId) {
      throw new Error(`玩家 ${playerId} 不在任何牌桌`);
    }

    const table = this.tables.get(tableId);
    table.removePlayer(playerId);
    this.playerTableMap.delete(playerId);

    if (table.players.length === 0) {
      this.tables.delete(tableId);
      this.engines.delete(tableId);
    }

    return { success: true };
  }

  /**
   * 执行玩家动作
   * @param {string} tableId - 牌桌ID
   * @param {string} playerId - 玩家ID
   * @param {string} action - 动作类型
   * @param {number} amount - 金额（加注时使用）
   * @param {string} statement - 玩家公共宣言（可选）
   */
  playerAction(tableId, playerId, action, amount = 0, statement = '') {
    const engine = this.engines.get(tableId);
    if (!engine) {
      throw new Error(`牌桌 ${tableId} 不存在`);
    }

    return engine.processPlayerAction(playerId, action, amount, statement);
  }

  /**
   * 获取牌桌状态
   * @param {string} tableId - 牌桌ID
   * @param {string} playerId - 玩家ID（可选，用于获取玩家视角）
   */
  getTableState(tableId, playerId = null) {
    const engine = this.engines.get(tableId);
    if (!engine) {
      throw new Error(`牌桌 ${tableId} 不存在`);
    }

    if (playerId) {
      return engine.getPlayerView(playerId);
    }

    return engine.getGameState();
  }

  /**
   * 获取所有牌桌列表
   */
  getAllTables() {
    return Array.from(this.tables.values()).map(table => ({
      tableId: table.id,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      playerCount: table.players.length,
      stage: table.stage,
      pot: table.pot
    }));
  }

  /**
   * 设置牌桌超时时长
   * @param {string} tableId - 牌桌ID
   * @param {number} timeout - 超时时长（毫秒）
   */
  setTableTimeout(tableId, timeout) {
    const engine = this.engines.get(tableId);
    if (!engine) {
      throw new Error(`牌桌 ${tableId} 不存在`);
    }

    engine.setActionTimeout(timeout);
    return { success: true };
  }

  /**
   * 开始新一局
   * @param {string} tableId - 牌桌ID
   */
  startNewHand(tableId) {
    const engine = this.engines.get(tableId);
    if (!engine) {
      throw new Error(`牌桌 ${tableId} 不存在`);
    }

    const table = this.tables.get(tableId);
    if (table.players.length < 2) {
      throw new Error('至少需要2名玩家才能开始游戏');
    }

    const gameState = engine.startNewHand();
    return { 
      success: true,
      stage: gameState.stage,
      playerCount: table.players.length
    };
  }

  /**
   * 获取玩家所在的牌桌ID
   * @param {string} playerId - 玩家ID
   */
  getPlayerTable(playerId) {
    return this.playerTableMap.get(playerId);
  }
}
