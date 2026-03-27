/**
 * RoomManager.js - 动态副本与智能匹配系统
 * 支持海量 Agent 高并发接入，动态创建房间实例，智能匹配，自动回收空房
 */

import { Table } from '../models/Table.js';
import { GameEngine } from './GameEngine.js';

// 【赛区模板】定义三个等级的配置模板
const TIER_TEMPLATES = {
  beginner: {
    tierId: 'beginner',
    name: 'Beginner',
    blinds: [5, 10],
    minBuyIn: 0,
    maxPlayers: 9,
    description: 'Beginner-friendly, no entry barrier'
  },
  advanced: {
    tierId: 'advanced',
    name: 'Advanced',
    blinds: [25, 50],
    minBuyIn: 5000,
    maxPlayers: 9,
    description: 'Intermediate player arena'
  },
  highroller: {
    tierId: 'highroller',
    name: 'High Roller',
    blinds: [50, 100],
    minBuyIn: 10000,
    maxPlayers: 9,
    description: 'Elite high-stakes arena'
  }
};

export class RoomManager {
  constructor() {
    this.rooms = new Map(); // 动态房间实例池
    this.roomCounter = new Map(); // 每个赛区的房间计数器
    
    // 初始化计数器
    Object.keys(TIER_TEMPLATES).forEach(tierId => {
      this.roomCounter.set(tierId, 0);
    });
    
    console.log('🏛️  动态副本系统已启动，支持智能匹配与自动扩容');
    console.log('📋 可用赛区:');
    Object.values(TIER_TEMPLATES).forEach(tier => {
      console.log(`   ${tier.name} - 盲注 ${tier.blinds[0]}/${tier.blinds[1]}, 最低 $${tier.minBuyIn}, 最多 ${tier.maxPlayers} 人`);
    });
  }

  /**
   * 【智能匹配】快速加入指定赛区
   * 自动寻找有空位的房间，如果没有则创建新房间
   */
  async quickJoin(tierId, playerId, playerName, balance) {
    const tier = TIER_TEMPLATES[tierId];
    if (!tier) {
      throw new Error(`赛区 ${tierId} 不存在`);
    }

    // 验资：检查余额是否满足最低入场要求
    if (balance < tier.minBuyIn) {
      throw new Error(
        `资金不足！[${tier.name}] 要求最低 $${tier.minBuyIn}，您当前余额 $${balance}。请前往低级别赛区。`
      );
    }

    // 【智能匹配】遍历当前所有房间，寻找属于该赛区且有空位的房间
    let targetRoom = null;
    for (const [roomId, room] of this.rooms) {
      if (room.tierId === tierId && room.table.players.length < tier.maxPlayers) {
        // 检查玩家是否已在该房间中
        const existingPlayer = room.table.players.find(p => p.id === playerId);
        if (!existingPlayer) {
          targetRoom = room;
          break;
        }
      }
    }

    // 如果没有找到合适的房间，动态创建一个新房间
    if (!targetRoom) {
      const counter = this.roomCounter.get(tierId);
      const newRoomId = `${tierId}_${Date.now()}_${counter}`;
      this.roomCounter.set(tierId, counter + 1);
      
      targetRoom = this.createRoom({
        roomId: newRoomId,
        tierId: tierId,
        name: `${tier.name} #${counter + 1}`,
        smallBlind: tier.blinds[0],
        bigBlind: tier.blinds[1],
        minBuyIn: tier.minBuyIn,
        maxPlayers: tier.maxPlayers,
        description: tier.description
      });
      
      console.log(`🆕 动态创建新房间: [${targetRoom.name}] (${newRoomId})`);
    }

    // 加入房间
    const { Player } = await import('../models/Player.js');
    const player = new Player(playerId, playerName, balance);
    
    const added = targetRoom.table.addPlayer(player);
    if (!added) {
      throw new Error(`房间 [${targetRoom.name}] 已满，无法加入`);
    }

    console.log(`🚪 ${playerName} 进入 [${targetRoom.name}] (余额: $${balance}, 当前 ${targetRoom.table.players.length}/${tier.maxPlayers} 人)`);

    // 【自动开局】如果房间有 2 人及以上且处于等待状态，自动发牌
    if (targetRoom.table.players.length >= 2 && targetRoom.table.stage === 'WAITING') {
      console.log(`🎲 [${targetRoom.name}] 人数达到 ${targetRoom.table.players.length} 人，自动开局！`);
      targetRoom.engine.startNewHand();
    }

    return {
      roomId: targetRoom.roomId,
      roomName: targetRoom.name,
      tierId: targetRoom.tierId,
      playerCount: targetRoom.table.players.length,
      maxPlayers: tier.maxPlayers
    };
  }

  /**
   * 创建一个新房间（内部方法）
   */
  createRoom({ roomId, tierId, name, smallBlind, bigBlind, minBuyIn, maxPlayers, description }) {
    if (this.rooms.has(roomId)) {
      throw new Error(`房间 ${roomId} 已存在`);
    }

    const table = new Table(roomId, smallBlind, bigBlind);
    
    // 【垃圾回收】传递回调函数，当房间为空时自动删除
    const engine = new GameEngine(table, {
      onPlayerRemoved: (tableId) => {
        this.garbageCollect(tableId);
      }
    });

    const room = {
      roomId,
      tierId,
      name,
      smallBlind,
      bigBlind,
      minBuyIn,
      maxPlayers,
      description,
      table,
      engine,
      createdAt: new Date()
    };

    this.rooms.set(roomId, room);
    return room;
  }

  /**
   * 获取指定房间
   * 【自愈机制】不再抛出异常，返回 null 让调用方优雅处理
   */
  getRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.log(`⚠️  [自愈机制] 房间 ${roomId} 不存在或已解散`);
      return null;
    }
    return room;
  }

  /**
   * 获取所有房间信息（用于大厅展示）
   * 返回赛区模板和当前活跃的房间实例
   */
  getAllRoomsInfo() {
    // 赛区模板信息
    const tiers = Object.values(TIER_TEMPLATES).map(tier => ({
      tierId: tier.tierId,
      name: tier.name,
      blinds: tier.blinds,
      minBuyIn: tier.minBuyIn,
      maxPlayers: tier.maxPlayers,
      description: tier.description
    }));

    // 当前活跃的房间实例
    const activeRooms = [];
    this.rooms.forEach((room, roomId) => {
      activeRooms.push({
        roomId: room.roomId,
        tierId: room.tierId,
        name: room.name,
        smallBlind: room.smallBlind,
        bigBlind: room.bigBlind,
        minBuyIn: room.minBuyIn,
        maxPlayers: room.maxPlayers,
        description: room.description,
        playerCount: room.table.players.length,
        createdAt: room.createdAt,
        players: room.table.players.map(p => ({
          id: p.id,
          name: p.name,
          chips: p.chips
        }))
      });
    });

    return {
      tiers,
      activeRooms: activeRooms.sort((a, b) => a.minBuyIn - b.minBuyIn)
    };
  }

  /**
   * 【已废弃】玩家加入指定房间（保留用于向后兼容）
   * 推荐使用 quickJoin(tierId, ...) 进行智能匹配
   */
  async joinRoom(roomId, playerId, playerName, balance) {
    const room = this.getRoom(roomId);

    // 验资：检查余额是否满足最低入场要求
    if (balance < room.minBuyIn) {
      throw new Error(
        `资金不足！[${room.name}] 要求最低 $${room.minBuyIn}，您当前余额 $${balance}。请前往低级别房间。`
      );
    }

    // 检查玩家是否已在房间中
    const existingPlayer = room.table.players.find(p => p.id === playerId);
    if (existingPlayer) {
      throw new Error(`您已在 [${room.name}] 房间中`);
    }

    const { Player } = await import('../models/Player.js');
    const player = new Player(playerId, playerName, balance);
    
    const added = room.table.addPlayer(player);
    if (!added) {
      throw new Error(`房间 [${room.name}] 已满，无法加入`);
    }

    console.log(`🚪 ${playerName} 进入 [${room.name}] (余额: $${balance})`);

    // 【自动开局】如果房间有 2 人及以上且处于等待状态，自动发牌
    if (room.table.players.length >= 2 && room.table.stage === 'WAITING') {
      console.log(`🎲 [${room.name}] 人数达到 ${room.table.players.length} 人，自动开局！`);
      room.engine.startNewHand();
    }

    return {
      roomId: room.roomId,
      roomName: room.name,
      playerCount: room.table.players.length
    };
  }

  /**
   * 玩家离开房间
   */
  leaveRoom(roomId, playerId) {
    const room = this.getRoom(roomId);
    room.engine.removePlayer(playerId);

    console.log(`🚪 玩家 ${playerId} 离开 [${room.name}]`);

    // 【垃圾回收】如果房间人数降为 0，删除该房间实例
    this.garbageCollect(roomId);

    return {
      roomId: room.roomId,
      roomName: room.name,
      playerCount: room.table.players.length
    };
  }

  /**
   * 【垃圾回收】检查并删除空房间
   */
  garbageCollect(roomId) {
    const room = this.rooms.get(roomId);
    if (room && room.table.players.length === 0) {
      console.log(`🗑️  [垃圾回收] 房间 [${room.name}] (${roomId}) 已空，释放内存`);
      this.rooms.delete(roomId);
    }
  }

  /**
   * 获取房间游戏状态
   * 【自愈机制】如果房间不存在，返回 null
   */
  getRoomState(roomId) {
    const room = this.getRoom(roomId);
    if (!room) {
      return null;
    }
    return room.engine.getGameState();
  }

  /**
   * 开始房间游戏
   */
  startRoomGame(roomId) {
    const room = this.getRoom(roomId);
    return room.engine.startNewHand();
  }

  /**
   * 处理玩家行动
   */
  processPlayerAction(roomId, playerId, action, raiseAmount = 0, statement = '') {
    const room = this.getRoom(roomId);
    return room.engine.processPlayerAction(playerId, action, raiseAmount, statement);
  }
}
