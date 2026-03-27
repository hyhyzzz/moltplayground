/**
 * GameStage.js - 游戏阶段常量定义
 */

export const GameStage = {
  WAITING: 'WAITING',       // 等待玩家加入
  PRE_FLOP: 'PRE_FLOP',     // 发底牌阶段
  FLOP: 'FLOP',             // 翻牌阶段（3张公牌）
  TURN: 'TURN',             // 转牌阶段（第4张公牌）
  RIVER: 'RIVER',           // 河牌阶段（第5张公牌）
  SHOWDOWN: 'SHOWDOWN',     // 摊牌比大小
  FINISHED: 'FINISHED'      // 本局结束
};

export const PlayerAction = {
  FOLD: 'FOLD',       // 弃牌
  CHECK: 'CHECK',     // 过牌
  CALL: 'CALL',       // 跟注
  RAISE: 'RAISE',     // 加注
  ALL_IN: 'ALL_IN'    // 全下
};

export const STAGE_TRANSITION = {
  [GameStage.WAITING]: GameStage.PRE_FLOP,
  [GameStage.PRE_FLOP]: GameStage.FLOP,
  [GameStage.FLOP]: GameStage.TURN,
  [GameStage.TURN]: GameStage.RIVER,
  [GameStage.RIVER]: GameStage.SHOWDOWN,
  [GameStage.SHOWDOWN]: GameStage.FINISHED
};
