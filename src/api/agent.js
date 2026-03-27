/**
 * agent.js - Agent 账号注册与筹码管理路由
 */

import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * POST /api/register
 * 注册或获取 Agent 账号
 * Body: { "name": "AlphaBot" }
 */
router.post('/register', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing valid name parameter' 
      });
    }

    // 尝试查找已存在的 Agent
    let agent = await prisma.agent.findUnique({
      where: { name: name.trim() }
    });

    // 如果不存在，创建新 Agent
    if (!agent) {
      agent = await prisma.agent.create({
        data: {
          name: name.trim()
        }
      });
      console.log(`✅ 新 Agent 注册成功: ${agent.name} (ID: ${agent.id}, 初始筹码: ${agent.balance})`);
    } else {
      console.log(`ℹ️  Agent 已存在: ${agent.name} (ID: ${agent.id}, 当前余额: ${agent.balance})`);
    }

    res.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        balance: agent.balance,
        createdAt: agent.createdAt
      }
    });
  } catch (error) {
    console.error('注册 Agent 时出错:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/agent/:id
 * 查询 Agent 的当前余额
 */
router.get('/agent/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    let agent = await prisma.agent.findUnique({
      where: { id }
    });

    if (!agent) {
      return res.status(404).json({ 
        success: false, 
        error: `Agent ID ${id} does not exist` 
      });
    }

    // 【自动救济金】检查是否需要发放救济金
    let reliefTriggered = false;
    const RELIEF_AMOUNT = 1000;
    const RELIEF_COOLDOWN_HOURS = 24;
    
    if (agent.balance < RELIEF_AMOUNT) {
      const now = new Date();
      const canReceiveRelief = !agent.lastReliefAt || 
        (now - new Date(agent.lastReliefAt)) > RELIEF_COOLDOWN_HOURS * 60 * 60 * 1000;
      
      if (canReceiveRelief) {
        console.log(`🎁 [自动救济] ${agent.name} 余额不足 $${RELIEF_AMOUNT}，发放救济金...`);
        
        agent = await prisma.agent.update({
          where: { id },
          data: { 
            balance: RELIEF_AMOUNT,
            lastReliefAt: now
          }
        });
        
        reliefTriggered = true;
        console.log(`✅ [自动救济] ${agent.name} 已领取 $${RELIEF_AMOUNT} 救济金`);
      } else {
        const nextReliefTime = new Date(new Date(agent.lastReliefAt).getTime() + RELIEF_COOLDOWN_HOURS * 60 * 60 * 1000);
        const hoursRemaining = Math.ceil((nextReliefTime - now) / (60 * 60 * 1000));
        console.log(`⏳ [救济冷却] ${agent.name} 救济金冷却中，还需等待 ${hoursRemaining} 小时`);
      }
    }

    res.json({
      success: true,
      reliefTriggered,
      agent: {
        id: agent.id,
        name: agent.name,
        balance: agent.balance,
        createdAt: agent.createdAt,
        lastReliefAt: agent.lastReliefAt
      }
    });
  } catch (error) {
    console.error('查询 Agent 时出错:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/agents
 * 获取所有 Agent 列表
 */
router.get('/agents', async (req, res) => {
  try {
    const agents = await prisma.agent.findMany({
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({
      success: true,
      agents: agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        balance: agent.balance,
        createdAt: agent.createdAt
      }))
    });
  } catch (error) {
    console.error('查询 Agent 列表时出错:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * 优雅关闭 Prisma 连接
 */
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default router;
