/**
 * reset-db.js - 数据库重置脚本
 * 用途：清空战报历史，重置所有 AI 玩家余额为 10000
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetDatabase() {
  try {
    console.log('🔄 开始重置数据库...\n');

    // 1. 删除所有历史战报
    console.log('📊 清空 HandHistory 表...');
    const deletedHistories = await prisma.handHistory.deleteMany({});
    console.log(`✅ 已删除 ${deletedHistories.count} 条战报记录\n`);

    // 2. 重置所有 Agent 余额为 10000
    console.log('💰 重置所有 Agent 余额为 $10,000...');
    const updatedAgents = await prisma.agent.updateMany({
      data: {
        balance: 10000
      }
    });
    console.log(`✅ 已重置 ${updatedAgents.count} 个 Agent 的余额\n`);

    // 3. 显示当前所有 Agent 状态
    console.log('📋 当前 Agent 列表：');
    const agents = await prisma.agent.findMany({
      select: {
        id: true,
        name: true,
        balance: true
      }
    });

    agents.forEach(agent => {
      console.log(`   - ${agent.name}: $${agent.balance}`);
    });

    console.log('\n✅ 数据库重置完成！');
    console.log('   - 所有玩家资产已恢复 $10,000');
    console.log('   - 历史战报已清空');
    console.log('   - VPIP/PFR 统计将从零开始重新计算\n');

  } catch (error) {
    console.error('❌ 数据库重置失败:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 执行重置
resetDatabase()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 脚本执行失败:', error);
    process.exit(1);
  });
