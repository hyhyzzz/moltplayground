/**
 * routes.js - API 路由定义
 */

import express from 'express';
import { PrismaClient } from '@prisma/client';
import { RoomManager } from '../engine/RoomManager.js';
import { PlayerAction } from '../engine/GameStage.js';

const router = express.Router();
const roomManager = new RoomManager();
const prisma = new PrismaClient();

/**
 * 健康检查
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'MoltPlayground API is running' });
});

/**
 * 获取大厅所有房间列表
 * 返回赛区模板和当前活跃的房间实例
 */
router.get('/rooms', (req, res) => {
  try {
    const { tiers, activeRooms } = roomManager.getAllRoomsInfo();
    res.json({ 
      success: true, 
      tiers,           // 赛区模板
      activeRooms,     // 当前活跃的房间实例
      rooms: activeRooms  // 向后兼容
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 创建新牌桌
 * Body: { tableId, smallBlind?, bigBlind? }
 */
router.post('/table/create', (req, res) => {
  try {
    const { tableId, smallBlind = 10, bigBlind = 20 } = req.body;
    
    if (!tableId) {
      return res.status(400).json({ success: false, error: 'Missing tableId parameter' });
    }

    const table = gameManager.createTable(tableId, smallBlind, bigBlind);
    res.json({ success: true, table });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * 【智能匹配】玩家加入指定赛区
 * Body: { playerId, playerName }
 * 路径参数: tierId (例如 'beginner', 'advanced', 'highroller')
 * 返回: 系统实际分配的房间 ID
 */
router.post('/room/:tierId/join', async (req, res) => {
  try {
    const { tierId } = req.params;
    const { playerId, playerName } = req.body;
    
    if (!playerId || !playerName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing playerId or playerName parameter' 
      });
    }

    // 【验资】查询数据库，验证玩家是否存在
    let agent = await prisma.agent.findUnique({
      where: { id: playerId }
    });

    if (!agent) {
      return res.status(403).json({ 
        success: false, 
        error: `Player ID ${playerId} not registered in bank system, please call /api/register first` 
      });
    }

    // 【破产救济金】检查余额并处理救济金逻辑
    let reliefGranted = false;
    const RELIEF_FUND_AMOUNT = 1000;
    
    if (agent.balance <= 0) {
      // 如果玩家破产且尝试加入新手村，发放救济金
      if (tierId === 'beginner') {
        console.log(`💸 破产救济：${agent.name} 余额为 $0，发放 $${RELIEF_FUND_AMOUNT} 救济金`);
        
        // 更新数据库余额
        agent = await prisma.agent.update({
          where: { id: playerId },
          data: { balance: RELIEF_FUND_AMOUNT }
        });
        
        reliefGranted = true;
        console.log(`✅ 救济金发放成功：${agent.name} 新余额 $${agent.balance}`);
      } else {
        // 破产玩家尝试加入高级赛区，拒绝入座
        return res.status(403).json({ 
          success: false, 
          error: `Player ${agent.name} has insufficient balance (current: $${agent.balance}), cannot join high-stakes tier. Please visit Beginner tier to claim relief fund!` 
        });
      }
    }

    console.log(`💰 验资通过: ${agent.name} (ID: ${agent.id}, 余额: $${agent.balance})`);

    // 【智能匹配】使用 quickJoin 自动分配房间
    const result = await roomManager.quickJoin(tierId, playerId, playerName, agent.balance);
    
    // 【关键返回】返回系统实际分配的房间 ID
    const responseMessage = reliefGranted 
      ? `🎁 触发破产保护，系统发放 $${RELIEF_FUND_AMOUNT} 救济金！成功加入 [${result.roomName}]`
      : `成功加入 [${result.roomName}]`;
    
    res.json({ 
      success: true, 
      roomId: result.roomId,        // 【极其重要】系统实际分配的房间 ID
      roomName: result.roomName,
      tierId: result.tierId,
      playerCount: result.playerCount,
      maxPlayers: result.maxPlayers,
      reliefGranted,
      message: responseMessage
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * 玩家离开房间
 * Body: { playerId }
 */
router.post('/room/:roomId/leave', (req, res) => {
  try {
    const { roomId } = req.params;
    const { playerId } = req.body;
    
    if (!playerId) {
      return res.status(400).json({ success: false, error: 'Missing playerId parameter' });
    }

    const result = roomManager.leaveRoom(roomId, playerId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * 玩家执行动作
 * Body: { playerId, action, amount?, statement? }
 * action: FOLD, CHECK, CALL, RAISE
 * statement: 玩家公共宣言（可选）
 */
router.post('/room/:roomId/action', (req, res) => {
  try {
    const { roomId } = req.params;
    const { playerId, action, amount = 0, statement = '' } = req.body;
    
    if (!playerId || !action) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing playerId or action parameter' 
      });
    }

    if (!Object.values(PlayerAction).includes(action)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid action: ${action}. Valid actions: ${Object.values(PlayerAction).join(', ')}` 
      });
    }

    const result = roomManager.processPlayerAction(roomId, playerId, action, amount, statement);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * 获取房间状态 - 商业级信息隔离 (Zero-Trust Fog of War)
 * 
 * Query 参数:
 *   - playerName: 可选，指定请求者的玩家名字
 * 
 * 安全规则:
 *   规则 A (对局中隐藏): stage !== 'SHOWDOWN' && stage !== 'FINISHED'
 *     - 所有玩家的 hand 强制覆写为 ['?', '?']
 *     - 唯一例外: 如果传了 playerName，只保留该玩家自己的底牌
 *     - 即使是上帝视角（未传 playerName），也只能看到 ['?', '?']
 *   
 *   规则 B (摊牌时公开): stage === 'SHOWDOWN' || stage === 'FINISHED'
 *     - 解除遮罩，将参与最后比牌玩家的真实 hand 暴露
 *     - 弃牌玩家的底牌依然隐藏为 ['?', '?']
 */
router.get('/room/:roomId/state', (req, res) => {
  try {
    const { roomId } = req.params;
    const { playerName } = req.query;
    
    let state = roomManager.getRoomState(roomId);
    
    // 【自愈机制】优雅处理房间不存在的情况
    if (!state) {
      return res.status(404).json({ 
        success: false, 
        error: 'ROOM_NOT_FOUND', 
        message: 'Room does not exist or has been disbanded' 
      });
    }
    
    // 【Zero-Trust Fog of War】商业级信息隔离
    // 深拷贝状态，避免修改原始数据（防止循环引用崩溃）
    let sanitizedState;
    try {
      sanitizedState = JSON.parse(JSON.stringify(state));
    } catch (cloneError) {
      console.error('❌ 深拷贝失败（可能存在循环引用）:', cloneError.message);
      // 降级方案：手动拷贝关键字段
      sanitizedState = {
        tableId: state.tableId,
        stage: state.stage,
        pot: state.pot,
        currentBet: state.currentBet,
        communityCards: state.communityCards ? [...state.communityCards] : [],
        currentPlayer: state.currentPlayer,
        actionDeadline: state.actionDeadline,
        turnTimeout: state.turnTimeout,
        turnStartTime: state.turnStartTime,
        dealerPosition: state.dealerPosition,
        players: state.players ? state.players.map(p => ({ ...p })) : []
      };
    }
    
    // 检查阶段：只有 SHOWDOWN 或 FINISHED 才公开底牌
    const isShowdown = (sanitizedState.stage === 'SHOWDOWN' || sanitizedState.stage === 'FINISHED');
    
    // 极其严格的遮罩逻辑
    if (sanitizedState.players && Array.isArray(sanitizedState.players)) {
      // 【规则 A】对局中隐藏所有底牌
      if (!isShowdown) {
        sanitizedState.players = sanitizedState.players.map(player => {
          // 空值保护
          if (!player) return null;
          
          // 如果传了 playerName 且精准等于该玩家的 name，保留该玩家的底牌
          if (playerName && player.name === playerName) {
            return player; // 保留自己的底牌
          }
          // 其他所有情况（包括上帝视角），强制隐藏
          return {
            ...player,
            hand: ['?', '?']
          };
        }).filter(p => p !== null); // 过滤掉空值
        
        console.log(`🔒 [Fog of War] 对局中隐藏所有底牌 ${playerName ? `(保留 ${playerName} 自己的牌)` : '(上帝视角也看不到)'}`);
      }
      // 【规则 B】摊牌时公开未弃牌玩家的底牌
      else {
        sanitizedState.players = sanitizedState.players.map(player => {
          // 空值保护
          if (!player) return null;
          
          // 弃牌玩家的底牌依然隐藏
          if (player.folded) {
            return {
              ...player,
              hand: ['?', '?']
            };
          }
          // 未弃牌玩家的底牌公开
          return player;
        }).filter(p => p !== null); // 过滤掉空值
        
        console.log(`🎴 [Showdown] 摊牌阶段，公开未弃牌玩家的底牌`);
      }
    }
    
    res.json({ success: true, state: sanitizedState });
  } catch (error) {
    console.error('❌ [State API] 致命错误:', error.message, error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 开始新一局
 */
router.post('/room/:roomId/start', (req, res) => {
  try {
    const { roomId } = req.params;
    const result = roomManager.startRoomGame(roomId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * 设置牌桌超时时长
 * Body: { timeout }
 */
router.post('/table/:tableId/timeout', (req, res) => {
  try {
    const { tableId } = req.params;
    const { timeout } = req.body;
    
    if (!timeout || timeout < 1000) {
      return res.status(400).json({ 
        success: false, 
        error: 'Timeout duration must be at least 1000ms' 
      });
    }

    const result = gameManager.setTableTimeout(tableId, timeout);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * 【战绩记录中心】查询房间历史战报
 * GET /api/history/room/:roomId
 * 返回指定房间最近 50 条战报记录
 */
router.get('/history/room/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    console.log(`📊 查询房间 [${roomId}] 的战报记录，最多返回 ${limit} 条`);

    // 从数据库查询战报，按时间倒序
    const records = await prisma.handHistory.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    // 将 JSON 字符串字段解析为对象，并进行数据脱敏
    const parsedRecords = records.map(record => {
      const actions = JSON.parse(record.actions);
      const omniscientData = record.omniscientData || { players: {} };
      
      // 【数据脱敏】判断哪些玩家参与了摊牌（Showdown）
      // 只有到达 SHOWDOWN 阶段还未弃牌的玩家，才能看到底牌
      const showdownPlayers = new Set();
      let reachedShowdown = false;
      
      // 遍历动作记录，找出在 SHOWDOWN 前弃牌的玩家
      const foldedPlayers = new Set();
      for (const action of actions) {
        if (action.stage === 'SHOWDOWN') {
          reachedShowdown = true;
        }
        if (action.action === 'FOLD' && !reachedShowdown) {
          foldedPlayers.add(action.playerName);
        }
      }
      
      // 如果游戏到达了 SHOWDOWN 阶段，记录参与摊牌的玩家
      if (reachedShowdown) {
        for (const playerId in omniscientData.players) {
          const playerName = omniscientData.players[playerId].name;
          if (!foldedPlayers.has(playerName)) {
            showdownPlayers.add(playerId);
          }
        }
      }
      
      // 【公开视角】清洗 omniscientData，隐藏未参与摊牌玩家的底牌
      const publicOmniscientData = { players: {} };
      for (const playerId in omniscientData.players) {
        const playerData = omniscientData.players[playerId];
        publicOmniscientData.players[playerId] = {
          name: playerData.name,
          position: playerData.position,
          cards: showdownPlayers.has(playerId) ? playerData.cards : ['?', '?']
        };
      }
      
      return {
        id: record.id,
        roomId: record.roomId,
        potSize: record.potSize,
        communityCards: JSON.parse(record.communityCards),
        players: JSON.parse(record.players),
        actions: actions,
        omniscientData: publicOmniscientData, // 返回脱敏后的数据
        createdAt: record.createdAt
      };
    });

    console.log(`📊 成功返回 ${parsedRecords.length} 条战报记录`);

    res.json({
      success: true,
      roomId,
      count: parsedRecords.length,
      records: parsedRecords
    });

  } catch (error) {
    console.error('❌ 查询战报失败:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * 获取全局财富排行榜（含 AI 战力雷达标签）
 * 返回按资产余额降序排列的玩家列表，并计算 VPIP、PFR 和性格标签
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // 默认返回前 10 名

    // 1. 查询 Agent 表，按 balance 降序排列
    const agents = await prisma.agent.findMany({
      orderBy: {
        balance: 'desc'
      },
      take: limit,
      select: {
        id: true,
        name: true,
        balance: true
      }
    });

    // 2. 查询所有历史战报
    const handHistories = await prisma.handHistory.findMany({
      select: {
        id: true,
        players: true,
        actions: true
      }
    });

    // 3. 为每个玩家计算 VPIP、PFR 和性格标签
    const leaderboard = agents.map(agent => {
      const stats = calculatePlayerStats(agent.id, handHistories);
      const styleTag = determinePlayStyle(stats.vpip, stats.pfr);
      
      return {
        id: agent.id,
        name: agent.name,
        balance: agent.balance,
        hands: stats.hands,
        vpip: stats.vpip,
        pfr: stats.pfr,
        styleTag: styleTag.label,
        styleColor: styleTag.color
      };
    });

    res.json({
      success: true,
      leaderboard
    });

  } catch (error) {
    console.error('❌ 查询排行榜失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 计算玩家的 VPIP 和 PFR 统计数据
 * @param {string} playerId - 玩家 ID
 * @param {Array} handHistories - 所有历史战报
 * @returns {Object} { hands, vpip, pfr }
 */
function calculatePlayerStats(playerId, handHistories) {
  let totalHands = 0;
  let vpipHands = 0;  // 主动入池次数（PRE_FLOP 有 CALL 或 RAISE）
  let pfrHands = 0;   // 翻前加注次数（PRE_FLOP 有 RAISE）
  
  // 【硬核探针】打印第一条战报的 actions 样本
  if (handHistories.length > 0) {
    try {
      const sampleActions = typeof handHistories[0].actions === 'string' 
        ? JSON.parse(handHistories[0].actions) 
        : handHistories[0].actions;
      console.log('🛠️  [Debug] 数据库取出的单局 actions 样本:', JSON.stringify(sampleActions, null, 2));
    } catch (err) {
      console.error('❌ [Debug] 解析样本 actions 失败:', err.message);
    }
  }

  handHistories.forEach((hand, index) => {
    try {
      // 检查玩家是否参与了这局
      const players = typeof hand.players === 'string' ? JSON.parse(hand.players) : hand.players;
      const playerInHand = players.find(p => p.id === playerId);
      
      if (!playerInHand) {
        return; // 玩家未参与此局
      }

      totalHands++;

      // 【防爆保护】解析 actions JSON
      const actions = typeof hand.actions === 'string' ? JSON.parse(hand.actions) : hand.actions;
    
      
      // 【核心 Bug 修复】使用 playerName 而不是 playerId 进行匹配
      // 因为 currentHandActions 中存储的是 playerName，不是 playerId
      const preFlopActions = actions.filter(action => 
        action.stage === 'PRE_FLOP' && action.playerName === playerInHand.name
      );

      // 检查是否有 CALL 或 RAISE（VPIP）- 大小写不敏感
      const hasVoluntaryAction = preFlopActions.some(action => {
        const actionUpper = action.action ? action.action.toUpperCase() : '';
        return actionUpper === 'CALL' || actionUpper === 'RAISE';
      });
      
      if (hasVoluntaryAction) {
        vpipHands++;
      }

      // 检查是否有 RAISE（PFR）- 大小写不敏感
      const hasRaise = preFlopActions.some(action => {
        const actionUpper = action.action ? action.action.toUpperCase() : '';
        return actionUpper === 'RAISE';
      });
      
      if (hasRaise) {
        pfrHands++;
      }
    } catch (err) {
      console.error(`❌ [Debug] 处理第 ${index + 1} 条战报时出错:`, err.message);
    }
  });

  // 计算百分比（已有零除保护）
  const vpip = totalHands > 0 ? Math.round((vpipHands / totalHands) * 100) : 0;
  const pfr = totalHands > 0 ? Math.round((pfrHands / totalHands) * 100) : 0;

  const stats = {
    hands: totalHands,
    vpip,
    pfr
  };

  // 调试日志：输出统计结果
  console.log(`📊 战力统计 [${playerId}]: 总局数=${totalHands}, VPIP=${vpip}% (${vpipHands}/${totalHands}), PFR=${pfr}% (${pfrHands}/${totalHands})`);

  return stats;
}

/**
 * 根据 VPIP 和 PFR 判定玩家性格标签
 * @param {number} vpip - VPIP 百分比
 * @param {number} pfr - PFR 百分比
 * @returns {Object} { label, color }
 */
function determinePlayStyle(vpip, pfr) {
  // MANIAC: VPIP > 40 且 PFR > 20
  if (vpip > 40 && pfr > 20) {
    return { label: 'MANIAC', color: '#ef4444' }; // Red
  }
  
  // STATION: VPIP > 40 且 PFR <= 20
  if (vpip > 40 && pfr <= 20) {
    return { label: 'STATION', color: '#22c55e' }; // Green
  }
  
  // TAG (Tight-Aggressive): VPIP 15-40 且 PFR >= 10
  if (vpip >= 15 && vpip <= 40 && pfr >= 10) {
    return { label: 'TAG', color: '#f97316' }; // Orange
  }
  
  // NIT: VPIP < 15
  if (vpip < 15) {
    return { label: 'NIT', color: '#94a3b8' }; // Gray
  }
  
  // Unknown
  return { label: 'UNKNOWN', color: '#64748b' }; // Dark gray
}

export default router;
